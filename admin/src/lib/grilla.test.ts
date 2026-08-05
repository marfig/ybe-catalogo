import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

import { FILTROS, contarPorEstado, listarProductos, type Ejecutar } from './grilla.ts';

/**
 * Tests de la consulta de la grilla (SPEC-etapa2 §10.3).
 *
 * Contra la MIGRACION REAL en `node:sqlite`, con el mismo patron de ejecutor que el
 * volcado: D1 es SQLite, asi que el SQL que pasa estos tests es el que corre en
 * produccion. Un doble no daria esa garantia.
 */

/**
 * Ruta resuelta contra ESTE archivo, no contra el cwd.
 *
 * Con una ruta relativa al cwd, el test pasa corriendo `npm test` desde `admin/` y
 * falla desde la raiz del repo — que es justo desde donde corre la suite completa.
 */
const MIGRACION = readFileSync(
  new URL('../../../db/migrations/0001_esquema_inicial.sql', import.meta.url),
  'utf8'
);
const AHORA = '2026-08-05T12:00:00Z';

function base() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(MIGRACION);
  return db;
}

/**
 * `node:sqlite` es sincrono y D1 no. El ejecutor se declara ASINCRONO para que la
 * firma sea la misma en los dos lados: si el tipo fuera sincrono, la version de
 * produccion no encajaria y la diferencia aparecería recien al desplegar.
 */
const ejecutor =
  (db: DatabaseSync): Ejecutar =>
  async (sql, params = []) =>
    db.prepare(sql).all(...(params as never[])) as never;

/**
 * `id` de un INSERT ... RETURNING.
 *
 * `.get()` puede devolver `undefined`, y un `!` ahi convertiria un fixture que no
 * inserto nada en un `undefined` que revienta tres lineas mas abajo sin decir por
 * que. Mejor fallar en el lugar y con el motivo.
 */
function idDe(fila: Record<string, unknown> | undefined, que: string): number {
  if (fila === undefined || typeof fila.id !== 'number') {
    throw new Error(`El INSERT de ${que} no devolvio id. Revisar el fixture.`);
  }
  return fila.id;
}

let n = 0;

interface Alta {
  codigo?: string;
  nombre?: string | null;
  estado?: string;
  slug?: string | null;
  precio?: number | null;
  categorias?: string[];
  /** Una entrada por variante: cuantas imagenes tiene. */
  variantes?: number[];
  colores?: string[];
}

function alta(db: DatabaseSync, a: Alta = {}) {
  n++;
  const codigo = a.codigo ?? `CG${1000 + n}`;
  const estado = a.estado ?? 'importado';
  const slug = a.slug !== undefined ? a.slug : estado === 'importado' ? null : `slug-${n}`;

  const productoId = idDe(
    db
      .prepare(
        `INSERT INTO productos (codigo, proveedor, slug, nombre, precio, estado, categoria_origen, creado_en, actualizado_en)
         VALUES (?, 'chenson', ?, ?, ?, ?, ?, ?, ?) RETURNING id`
      )
      .get(
        codigo,
        slug,
        a.nombre !== undefined ? a.nombre : `Producto ${n}`,
        a.precio !== undefined ? a.precio : 100000,
        estado,
        'CARTERA | DE FIESTA',
        AHORA,
        AHORA
      ),
    `el producto ${codigo}`
  );

  (a.categorias ?? ['carteras']).forEach((slugCat, orden) => {
    db.prepare(
      `INSERT INTO producto_categorias (producto_id, categoria_slug, orden) VALUES (?, ?, ?)`
    ).run(productoId, slugCat, orden);
  });

  (a.variantes ?? [1]).forEach((cuantasFotos, i) => {
    const varianteId = idDe(
      db
        .prepare(
          `INSERT INTO variantes (producto_id, sku, color, orden) VALUES (?, ?, ?, ?) RETURNING id`
        )
        .get(productoId, `${codigo}-${i}`, a.colores?.[i] ?? `Color${i}`, i),
      `la variante ${i} de ${codigo}`
    );

    for (let f = 0; f < cuantasFotos; f++) {
      const hash = `${codigo}${i}${f}`.padEnd(16, '0').slice(0, 16).toLowerCase();
      const imagenId = idDe(
        db
          .prepare(
            `INSERT INTO imagenes (hash16, anchos, ancho_origen, alto_origen, bytes_origen, creado_en)
             VALUES (?, '[300,600]', 600, 600, 1000, ?) RETURNING id`
          )
          .get(hash, AHORA),
        `la imagen ${hash}`
      );
      db.prepare(
        `INSERT INTO variante_imagenes (variante_id, imagen_id, orden) VALUES (?, ?, ?)`
      ).run(varianteId, imagenId, f);
    }
  });

  return { productoId, codigo };
}

// --------------------------------------------------------------------------
// Filtro por estado. "Sin completar" es el default: la cola de trabajo.
// --------------------------------------------------------------------------

test('FILTROS declara sin-completar como el primero, que es el default', () => {
  assert.equal(FILTROS[0].valor, 'sin-completar');
});

test('sin-completar trae solo los importados: la cola de trabajo pendiente', async () => {
  const db = base();
  alta(db, { estado: 'importado' });
  alta(db, { estado: 'aprobado' });
  alta(db, { estado: 'publicado' });

  const filas = await listarProductos(ejecutor(db), { estado: 'sin-completar' });
  assert.equal(filas.length, 1);
  assert.equal(filas[0].estado, 'importado');
});

test('LOS ELIMINADOS NO APARECEN salvo que se elija ese filtro', async () => {
  // Es la solucion al ruido del inventario muerto (§10.3, §12): se filtra, no se
  // borra. Si aparecieran en "todos", el filtro no serviria para nada.
  const db = base();
  alta(db, { estado: 'publicado' });
  alta(db, { estado: 'eliminado' });

  const todos = await listarProductos(ejecutor(db), { estado: 'todos' });
  assert.equal(todos.length, 1);
  assert.equal(todos[0].estado, 'publicado');

  const eliminados = await listarProductos(ejecutor(db), { estado: 'eliminado' });
  assert.equal(eliminados.length, 1);
  assert.equal(eliminados[0].estado, 'eliminado');
});

test('un estado desconocido RECHAZA en vez de traer todo', async () => {
  // Un filtro invalido que degradara a "sin WHERE" mostraria los eliminados, que
  // es justo lo que no debe pasar.
  const db = base();
  await assert.rejects(
    () => listarProductos(ejecutor(db), { estado: 'inventado' as never }),
    /estado/i
  );
});

// --------------------------------------------------------------------------
// Busqueda por codigo o nombre
// --------------------------------------------------------------------------

test('busca por codigo, que es lo que esa persona tiene a mano', async () => {
  const db = base();
  alta(db, { codigo: 'CG85527', estado: 'publicado' });
  alta(db, { codigo: 'CG84101', estado: 'publicado' });

  const filas = await listarProductos(ejecutor(db), { estado: 'todos', busqueda: '85527' });
  assert.equal(filas.length, 1);
  assert.equal(filas[0].codigo, 'CG85527');
});

test('busca por nombre, sin distinguir mayusculas en ASCII', async () => {
  const db = base();
  alta(db, { nombre: 'Cartera de fiesta', estado: 'publicado' });
  alta(db, { nombre: 'Mochila urbana', estado: 'publicado' });

  for (const termino of ['cartera', 'CARTERA', 'Cartera']) {
    const filas = await listarProductos(ejecutor(db), { estado: 'todos', busqueda: termino });
    assert.equal(filas.length, 1, `fallo con "${termino}"`);
  }
});

test('la busqueda escapa los comodines de LIKE', async () => {
  // Sin escapar, un "%" tipeado por accidente traeria TODO y se leeria como que la
  // busqueda no filtra.
  const db = base();
  alta(db, { codigo: 'CG100', estado: 'publicado' });
  alta(db, { codigo: 'CG200', estado: 'publicado' });

  for (const comodin of ['%', '_']) {
    const filas = await listarProductos(ejecutor(db), { estado: 'todos', busqueda: comodin });
    assert.equal(filas.length, 0, `"${comodin}" no deberia matchear nada`);
  }
});

test('una busqueda vacia o de espacios no filtra', async () => {
  const db = base();
  alta(db, { estado: 'publicado' });
  for (const busqueda of ['', '   ', undefined]) {
    const filas = await listarProductos(ejecutor(db), { estado: 'todos', busqueda });
    assert.equal(filas.length, 1);
  }
});

// --------------------------------------------------------------------------
// Los agregados que la grilla muestra
// --------------------------------------------------------------------------

test('cuenta colores y fotos, y elige la miniatura de la primera variante', async () => {
  const db = base();
  alta(db, {
    codigo: 'CG777',
    estado: 'publicado',
    variantes: [2, 1],
    colores: ['Azul', 'Negro'],
  });

  const [fila] = await listarProductos(ejecutor(db), { estado: 'todos' });
  assert.equal(fila.variantes, 2, '2 colores');
  assert.equal(fila.imagenes, 3, '3 fotos en total');
  // La miniatura sale de la variante que el sitio muestra por defecto (orden 0) y
  // de su primera foto: la grilla y la ficha publica tienen que coincidir.
  assert.equal(fila.miniatura, 'cg77700'.padEnd(16, '0'));
});

test('un producto sin fotos trae miniatura en null, no revienta', async () => {
  const db = base();
  alta(db, { estado: 'importado', variantes: [0] });
  const [fila] = await listarProductos(ejecutor(db), { estado: 'sin-completar' });
  assert.equal(fila.miniatura, null);
  assert.equal(fila.imagenes, 0);
});

test('un producto sin variantes tampoco revienta', async () => {
  const db = base();
  alta(db, { estado: 'importado', variantes: [] });
  const [fila] = await listarProductos(ejecutor(db), { estado: 'sin-completar' });
  assert.equal(fila.variantes, 0);
  assert.equal(fila.imagenes, 0);
  assert.equal(fila.miniatura, null);
});

test('las categorias vienen en su orden, NO alfabetico', async () => {
  // categorias[0] es el breadcrumb (§5.1). Reordenarlas cambiaria la navegacion.
  const db = base();
  alta(db, { estado: 'publicado', categorias: ['mochilas', 'notebook', 'escolar'] });
  const [fila] = await listarProductos(ejecutor(db), { estado: 'todos' });
  assert.deepEqual(fila.categorias, ['mochilas', 'notebook', 'escolar']);
});

test('un producto sin categorias trae un arreglo vacio', async () => {
  const db = base();
  alta(db, { estado: 'importado', categorias: [] });
  const [fila] = await listarProductos(ejecutor(db), { estado: 'sin-completar' });
  assert.deepEqual(fila.categorias, []);
});

test('las categorias no se cruzan entre productos', async () => {
  // La segunda consulta trae las categorias de TODOS los productos de la pagina de
  // una vez; agruparlas mal mezclaria las de uno con las del otro.
  const db = base();
  alta(db, { codigo: 'CG1', estado: 'publicado', categorias: ['carteras'] });
  alta(db, { codigo: 'CG2', estado: 'publicado', categorias: ['mochilas', 'escolar'] });

  const filas = await listarProductos(ejecutor(db), { estado: 'todos' });
  assert.deepEqual(filas.find((f) => f.codigo === 'CG1')!.categorias, ['carteras']);
  assert.deepEqual(filas.find((f) => f.codigo === 'CG2')!.categorias, ['mochilas', 'escolar']);
});

// --------------------------------------------------------------------------
// Orden, paginado y conteos
// --------------------------------------------------------------------------

test('el orden es por codigo: estable y es lo que se tiene a mano', async () => {
  const db = base();
  alta(db, { codigo: 'CG300', estado: 'publicado' });
  alta(db, { codigo: 'CG100', estado: 'publicado' });
  alta(db, { codigo: 'CG200', estado: 'publicado' });

  const filas = await listarProductos(ejecutor(db), { estado: 'todos' });
  assert.deepEqual(
    filas.map((f) => f.codigo),
    ['CG100', 'CG200', 'CG300']
  );
});

test('el paginado no repite ni saltea filas', async () => {
  const db = base();
  for (const c of ['CG1', 'CG2', 'CG3', 'CG4']) alta(db, { codigo: c, estado: 'publicado' });

  const p1 = await listarProductos(ejecutor(db), { estado: 'todos', limite: 2, desplazamiento: 0 });
  const p2 = await listarProductos(ejecutor(db), { estado: 'todos', limite: 2, desplazamiento: 2 });
  assert.deepEqual(
    [...p1, ...p2].map((f) => f.codigo),
    ['CG1', 'CG2', 'CG3', 'CG4']
  );
});

test('contarPorEstado cuenta TODOS los estados, incluido eliminado', async () => {
  // El contador del filtro tiene que poder mostrar cuantos eliminados hay: es como
  // se llega a la papelera. Lo que se oculta es el contenido, no su existencia.
  const db = base();
  alta(db, { estado: 'importado' });
  alta(db, { estado: 'importado' });
  alta(db, { estado: 'publicado' });
  alta(db, { estado: 'eliminado' });

  const conteo = await contarPorEstado(ejecutor(db));
  assert.equal(conteo.importado, 2);
  assert.equal(conteo.publicado, 1);
  assert.equal(conteo.eliminado, 1);
  assert.equal(conteo.aprobado, 0, 'un estado sin filas cuenta 0, no falta');
});

test('contarPorEstado respeta la busqueda', async () => {
  const db = base();
  alta(db, { codigo: 'CG111', estado: 'importado' });
  alta(db, { codigo: 'CG222', estado: 'importado' });
  const conteo = await contarPorEstado(ejecutor(db), '111');
  assert.equal(conteo.importado, 1);
});
