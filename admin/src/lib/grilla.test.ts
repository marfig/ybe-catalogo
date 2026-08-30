import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

import {
  FILTROS,
  ORIGENES,
  ORIGEN_POR_DEFECTO,
  contarPorEstado,
  interpretarOrigen,
  listarProductos,
  type Ejecutar,
} from './grilla.ts';

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
const MIGRACIONES = [
  '0001_esquema_inicial.sql',
  '0002_codigo_insensible_a_mayusculas.sql',
  '0003_aviso_cambio_en_origen.sql',
  '0004_papelera.sql',
  '0005_barrido_de_bajas.sql',
].map((n) => readFileSync(new URL(`../../../db/migrations/${n}`, import.meta.url), 'utf8'));

const AHORA = '2026-08-05T12:00:00Z';

function base() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const m of MIGRACIONES) db.exec(m);
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

/** Los codigos de una lista de filas, en su orden. */
const codigos = (filas: Array<{ codigo: string }>): string[] => filas.map((f) => f.codigo);

interface Alta {
  codigo?: string;
  nombre?: string | null;
  descripcion?: string | null;
  estado?: string;
  slug?: string | null;
  precio?: number | null;
  destacado?: boolean;
  categorias?: string[];
  /** Una entrada por variante: cuantas imagenes tiene. */
  variantes?: number[];
  colores?: string[];
  /** Desde cuando el proveedor dejo de publicarlo. */
  ausenteDesde?: string | null;
  /** De donde salio: `chenson`, `catalogo-viejo` o `manual`. */
  proveedor?: string;
}

function alta(db: DatabaseSync, a: Alta = {}) {
  n++;
  const codigo = a.codigo ?? `CG${1000 + n}`;
  const estado = a.estado ?? 'importado';
  const slug = a.slug !== undefined ? a.slug : estado === 'importado' ? null : `slug-${n}`;

  const productoId = idDe(
    db
      .prepare(
        `INSERT INTO productos (codigo, proveedor, slug, nombre, descripcion, precio, destacado, estado, categoria_origen, ausente_desde, creado_en, actualizado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
      )
      .get(
        codigo,
        a.proveedor ?? 'chenson',
        slug,
        a.nombre !== undefined ? a.nombre : `Producto ${n}`,
        a.descripcion !== undefined ? a.descripcion : null,
        a.precio !== undefined ? a.precio : 100000,
        a.destacado ? 1 : 0,
        estado,
        'CARTERA | DE FIESTA',
        a.ausenteDesde ?? null,
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
// Filtro por estado. "Por aprobar" es el default: la cola de trabajo.
// --------------------------------------------------------------------------

test('FILTROS declara por-aprobar como el primero, que es el default', () => {
  assert.equal(FILTROS[0].valor, 'por-aprobar');
});

test('por-aprobar trae solo los importados: la cola de trabajo pendiente', async () => {
  const db = base();
  alta(db, { estado: 'importado' });
  alta(db, { estado: 'aprobado' });
  alta(db, { estado: 'publicado' });

  const filas = await listarProductos(ejecutor(db), { estado: 'por-aprobar' });
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

test('dados-de-baja cruza los estados: no es uno de ellos', async () => {
  /**
   * Un producto puede estar publicado y dado de baja en el origen AL MISMO TIEMPO. Si
   * la baja fuera un estado habria que elegir uno de los dos, y el que se pierde es el
   * que dice si el producto se ve en el sitio.
   */
  const db = base();
  alta(db, { codigo: 'CG900', estado: 'publicado', ausenteDesde: AHORA });
  alta(db, { codigo: 'CG901', estado: 'importado', ausenteDesde: AHORA });
  alta(db, { codigo: 'CG902', estado: 'publicado' });

  const filas = await listarProductos(ejecutor(db), { estado: 'dados-de-baja' });
  assert.deepEqual(
    filas.map((f) => f.codigo),
    ['CG900', 'CG901']
  );
});

test('una baja que ya está en la papelera no es trabajo pendiente', async () => {
  const db = base();
  alta(db, { codigo: 'CG903', estado: 'eliminado', ausenteDesde: AHORA });
  alta(db, { codigo: 'CG904', estado: 'publicado', ausenteDesde: AHORA });

  const filas = await listarProductos(ejecutor(db), { estado: 'dados-de-baja' });
  assert.deepEqual(
    filas.map((f) => f.codigo),
    ['CG904']
  );
});

test('la fila trae desde cuándo está dado de baja', async () => {
  // Sin la fecha la grilla no puede decir "hace tres dias", que es el dato con el que
  // alguien decide si ya es hora de sacarlo.
  const db = base();
  alta(db, { codigo: 'CG905', estado: 'publicado', ausenteDesde: AHORA });
  alta(db, { codigo: 'CG906', estado: 'publicado' });

  const filas = await listarProductos(ejecutor(db), { estado: 'todos' });
  assert.equal(filas.find((f) => f.codigo === 'CG905')?.ausente_desde, AHORA);
  assert.equal(filas.find((f) => f.codigo === 'CG906')?.ausente_desde, null);
});

// --------------------------------------------------------------------------
// Descripcion y destacado: se editan EN la grilla, asi que tienen que venir en la fila
// --------------------------------------------------------------------------

test('la fila trae la descripcion, que se edita en la grilla', async () => {
  // Sin este campo el textarea se rinde siempre vacio, y guardar borraria en silencio
  // la descripcion de todos los productos de la pagina.
  const db = base();
  alta(db, { codigo: 'CG907', descripcion: 'Cartera rigida con strass.' });
  alta(db, { codigo: 'CG908', descripcion: null });

  const filas = await listarProductos(ejecutor(db), { estado: 'todos' });
  assert.equal(filas.find((f) => f.codigo === 'CG907')?.descripcion, 'Cartera rigida con strass.');
  assert.equal(filas.find((f) => f.codigo === 'CG908')?.descripcion, null);
});

test('la fila no trae `destacado`: la columna quedo congelada y fuera de la grilla', async () => {
  // Sigue existiendo en D1 con su valor viejo. Que no llegue hasta aca es lo que la
  // mantiene congelada: sin campo en la fila no hay casilla, y sin casilla no hay
  // POST que la pueda apagar de rebote.
  const db = base();
  alta(db, { codigo: 'CG909', destacado: true });

  const filas = await listarProductos(ejecutor(db), { estado: 'todos' });
  assert.ok(!('destacado' in filas.find((f) => f.codigo === 'CG909')!));
});

test('el conteo de bajas no se suma al de estados', async () => {
  /**
   * Son dos ejes: el mismo producto esta en `publicado` Y en `dadosDeBaja`. Si la baja
   * saliera del mismo GROUP BY, el total del desplegable seria mayor que el catalogo.
   */
  const db = base();
  alta(db, { codigo: 'CG907', estado: 'publicado', ausenteDesde: AHORA });
  alta(db, { codigo: 'CG908', estado: 'publicado' });

  const conteo = await contarPorEstado(ejecutor(db));
  assert.equal(conteo.publicado, 2);
  assert.equal(conteo.dadosDeBaja, 1);
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
  const [fila] = await listarProductos(ejecutor(db), { estado: 'por-aprobar' });
  assert.equal(fila.miniatura, null);
  assert.equal(fila.imagenes, 0);
});

test('un producto sin variantes tampoco revienta', async () => {
  const db = base();
  alta(db, { estado: 'importado', variantes: [] });
  const [fila] = await listarProductos(ejecutor(db), { estado: 'por-aprobar' });
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
  const [fila] = await listarProductos(ejecutor(db), { estado: 'por-aprobar' });
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

// --------------------------------------------------------------------------
// Filtro por categoria
// --------------------------------------------------------------------------

test('filtra por categoria en CUALQUIER posicion, no solo la principal', async () => {
  // Las transversales —escolar, dama— son secundarias en casi todos los productos que
  // las tienen. Un filtro que solo mirara `categorias[0]` no encontraria ninguno, que
  // es justo el caso para el que sirve filtrar.
  const db = base();
  alta(db, { codigo: 'CG920', categorias: ['mochilas', 'escolar'] });
  alta(db, { codigo: 'CG921', categorias: ['escolar'] });
  alta(db, { codigo: 'CG922', categorias: ['carteras'] });

  const filas = await listarProductos(ejecutor(db), { estado: 'todos', categoria: 'escolar' });
  assert.deepEqual(filas.map((f) => f.codigo).sort(), ['CG920', 'CG921']);
});

test('un producto con la categoria repetida no sale duplicado', async () => {
  // El JOIN es lo que duplicaria: si el producto matchea dos veces, aparece dos veces.
  const db = base();
  alta(db, { codigo: 'CG923', categorias: ['escolar', 'mochilas'] });

  const filas = await listarProductos(ejecutor(db), { estado: 'todos', categoria: 'escolar' });
  assert.equal(filas.length, 1);
});

test('sin-categoria trae los que no tienen NINGUNA: la cola de curaduria', async () => {
  const db = base();
  alta(db, { codigo: 'CG924', categorias: [] });
  alta(db, { codigo: 'CG925', categorias: ['carteras'] });

  const filas = await listarProductos(ejecutor(db), {
    estado: 'todos',
    categoria: 'sin-categoria',
  });
  assert.deepEqual(filas.map((f) => f.codigo), ['CG924']);
});

test('sin categoria pedida no filtra nada', async () => {
  const db = base();
  alta(db, { codigo: 'CG926', categorias: [] });
  alta(db, { codigo: 'CG927', categorias: ['carteras'] });

  for (const categoria of [undefined, '']) {
    const filas = await listarProductos(ejecutor(db), { estado: 'todos', categoria });
    assert.equal(filas.length, 2, `categoria=${JSON.stringify(categoria)}`);
  }
});

test('la categoria se combina con el estado y con la busqueda', async () => {
  // Los tres filtros son independientes y tienen que poder apilarse: es la diferencia
  // entre "buscar" y "acotar la cola de trabajo".
  const db = base();
  alta(db, { codigo: 'CG930', estado: 'importado', categorias: ['escolar'] });
  alta(db, { codigo: 'CG931', estado: 'publicado', categorias: ['escolar'] });
  alta(db, { codigo: 'CG932', estado: 'importado', categorias: ['carteras'] });

  const porEstado = await listarProductos(ejecutor(db), {
    estado: 'por-aprobar',
    categoria: 'escolar',
  });
  assert.deepEqual(porEstado.map((f) => f.codigo), ['CG930']);

  const conBusqueda = await listarProductos(ejecutor(db), {
    estado: 'todos',
    categoria: 'escolar',
    busqueda: 'CG931',
  });
  assert.deepEqual(conBusqueda.map((f) => f.codigo), ['CG931']);
});

test('las categorias de la fila vienen COMPLETAS aunque se filtre por una', async () => {
  // El filtro acota QUE filas se traen, no que se ve de cada una. Si el JOIN recortara
  // las categorias, la columna de la grilla mostraria una curaduria que no es la real y
  // guardar la pisaria.
  const db = base();
  alta(db, { codigo: 'CG933', categorias: ['mochilas', 'escolar', 'dama'] });

  const [fila] = await listarProductos(ejecutor(db), {
    estado: 'todos',
    categoria: 'escolar',
  });
  assert.deepEqual(fila.categorias, ['mochilas', 'escolar', 'dama']);
});

test('contarPorEstado respeta la categoria: el desplegable no puede contradecir la lista', async () => {
  const db = base();
  alta(db, { codigo: 'CG940', estado: 'importado', categorias: ['escolar'] });
  alta(db, { codigo: 'CG941', estado: 'publicado', categorias: ['escolar'] });
  alta(db, { codigo: 'CG942', estado: 'importado', categorias: ['carteras'] });

  const conteo = await contarPorEstado(ejecutor(db), { categoria: 'escolar' });
  assert.equal(conteo.importado, 1);
  assert.equal(conteo.publicado, 1);
});

test('contarPorEstado respeta la busqueda', async () => {
  const db = base();
  alta(db, { codigo: 'CG111', estado: 'importado' });
  alta(db, { codigo: 'CG222', estado: 'importado' });
  const conteo = await contarPorEstado(ejecutor(db), { busqueda: '111' });
  assert.equal(conteo.importado, 1);
});

// --- El origen: no mezclar dos colas de trabajo distintas ---

test('filtra por origen: los lanzamientos y el catalogo viejo, aparte', async () => {
  /**
   * POR QUE EXISTE ESTE FILTRO. Los dos origenes no son dos etiquetas: son DOS TRABAJOS
   * distintos en la misma cola. Un producto de lanzamientos llega con estructura y sin
   * nada escrito —hay que ponerle nombre, precio y descripcion—; uno del catalogo viejo
   * llega con todo eso ya puesto y lo unico que le falta es la categoria. Mezclados en
   * «Por aprobar» obligan a decidir fila por fila que tipo de trabajo toca, y eso no se
   * ve mirando la fila.
   */
  const db = base();
  alta(db, { codigo: 'CG700', proveedor: 'chenson' });
  alta(db, { codigo: '8732209', proveedor: 'catalogo-viejo' });
  alta(db, { codigo: 'AMANO1', proveedor: 'manual' });

  assert.deepEqual(codigos(await listarProductos(ejecutor(db), { origen: 'chenson' })), ['CG700']);
  assert.deepEqual(codigos(await listarProductos(ejecutor(db), { origen: 'catalogo-viejo' })), [
    '8732209',
  ]);
  assert.deepEqual(codigos(await listarProductos(ejecutor(db), { origen: 'manual' })), ['AMANO1']);
});

test('sin origen pedido no filtra nada', async () => {
  // El default es ver todo: el filtro acota cuando alguien lo pide, no por su cuenta.
  const db = base();
  alta(db, { codigo: 'CG701', proveedor: 'chenson' });
  alta(db, { codigo: '8732210', proveedor: 'catalogo-viejo' });

  assert.equal((await listarProductos(ejecutor(db), {})).length, 2);
  assert.equal((await listarProductos(ejecutor(db), { origen: '' })).length, 2);
  assert.equal((await listarProductos(ejecutor(db), { origen: '   ' })).length, 2);
});

test('un origen que no existe no trae nada, y no lo esconde trayendo todo', async () => {
  /**
   * Mismo trato que una categoria desconocida: se filtra de verdad y la lista sale
   * vacia. Degradar a «sin filtro» mostraria el catalogo entero y se leeria como que el
   * filtro no hace nada — que es peor que una lista vacia, porque no se nota.
   */
  const db = base();
  alta(db, { codigo: 'CG702', proveedor: 'chenson' });

  assert.equal((await listarProductos(ejecutor(db), { origen: 'no-existe' })).length, 0);
});

test('el origen se combina con el estado, la categoria y la busqueda', async () => {
  const db = base();
  alta(db, { codigo: 'CG710', proveedor: 'chenson', estado: 'importado', categorias: ['escolar'] });
  alta(db, {
    codigo: '8732211',
    proveedor: 'catalogo-viejo',
    estado: 'importado',
    categorias: ['escolar'],
  });
  alta(db, {
    codigo: '8732212',
    proveedor: 'catalogo-viejo',
    estado: 'publicado',
    categorias: ['escolar'],
  });
  alta(db, {
    codigo: '8732213',
    proveedor: 'catalogo-viejo',
    estado: 'importado',
    categorias: ['carteras'],
  });

  assert.deepEqual(
    codigos(
      await listarProductos(ejecutor(db), {
        origen: 'catalogo-viejo',
        estado: 'por-aprobar',
        categoria: 'escolar',
      })
    ),
    ['8732211']
  );

  assert.deepEqual(
    codigos(
      await listarProductos(ejecutor(db), { origen: 'catalogo-viejo', busqueda: '8732213' })
    ),
    ['8732213']
  );
});

test('contarPorEstado respeta el origen: el desplegable no puede contradecir la lista', async () => {
  /**
   * LA MISMA REGLA QUE YA VALIA PARA LA CATEGORIA, y por eso el filtro nuevo tuvo que
   * entrar tambien acá: si la lista se acota por origen y el conteo no, el desplegable
   * de estado ofrece «Por aprobar (40)» y al elegirlo aparecen dos. El contador y la
   * lista dirian cosas distintas sobre la misma pantalla.
   */
  const db = base();
  alta(db, { codigo: 'CG720', proveedor: 'chenson', estado: 'importado' });
  alta(db, { codigo: 'CG721', proveedor: 'chenson', estado: 'importado' });
  alta(db, { codigo: '8732220', proveedor: 'catalogo-viejo', estado: 'importado' });
  alta(db, { codigo: '8732221', proveedor: 'catalogo-viejo', estado: 'publicado' });

  const soloViejo = await contarPorEstado(ejecutor(db), { origen: 'catalogo-viejo' });
  assert.equal(soloViejo.importado, 1);
  assert.equal(soloViejo.publicado, 1);

  const todos = await contarPorEstado(ejecutor(db), {});
  assert.equal(todos.importado, 3);
});

test('las bajas del proveedor tambien se cuentan dentro del origen elegido', async () => {
  /**
   * El contador de «Ya no está en el proveedor» sale de su propia consulta, así que el
   * acote nuevo tenía que aplicarse en las DOS. Y vale la pena mirarlo: un producto del
   * catálogo viejo no deberia poder aparecer ahi nunca —`cola.ts` no lo barre, así que
   * nadie le escribe `ausente_desde`— pero si alguna vez aparece, el filtro tiene que
   * poder mostrarlo en su origen y no en el de al lado.
   */
  const db = base();
  alta(db, { codigo: 'CG730', proveedor: 'chenson', estado: 'publicado', ausenteDesde: AHORA });
  alta(db, { codigo: '8732230', proveedor: 'catalogo-viejo', estado: 'publicado' });

  assert.equal((await contarPorEstado(ejecutor(db), { origen: 'chenson' })).dadosDeBaja, 1);
  assert.equal((await contarPorEstado(ejecutor(db), { origen: 'catalogo-viejo' })).dadosDeBaja, 0);
});

test('ORIGENES nombra el TRABAJO y no el valor de la columna', async () => {
  /**
   * `chenson`, `catalogo-viejo` y `manual` son vocabulario del esquema: no le dicen nada
   * a quien opera. La lista de opciones tiene que decir qué cola es cada una, igual que
   * `FILTROS` se llama «Por aprobar» y no «importado».
   *
   * Y cubre los TRES valores que el esquema puede tener: si mañana entra un origen nuevo
   * sin agregarse acá, quedaría invisible en el desplegable y sus productos no se podrían
   * aislar desde la pantalla.
   */
  assert.deepEqual(
    ORIGENES.map((o) => o.valor),
    ['chenson', 'catalogo-viejo', 'manual']
  );
  for (const o of ORIGENES) {
    assert.ok(o.etiqueta.length > 0, o.valor);
    assert.notEqual(o.etiqueta, o.valor);
  }
});

test('el origen por defecto es lanzamientos, y «Todos» le puede ganar', async () => {
  /**
   * LA DISTINCION QUE SOSTIENE TODO EL FILTRO: no es lo mismo que el parametro FALTE que
   * que venga VACIO.
   *
   *   falta   -> alguien entro a `/productos` y no dijo nada: se asume lanzamientos, que es
   *              la cola en la que se trabaja todos los dias.
   *   vacio   -> alguien eligio «Todos» en el desplegable y el formulario mando `origen=`.
   *
   * Si las dos se trataran igual, elegir «Todos» volveria a caer en el default y la opcion
   * seria IMPOSIBLE de usar: se elige, se aprieta Filtrar, y la pantalla vuelve a
   * lanzamientos sin decir por que. Es la misma familia de trampa que `Number(null)` siendo
   * 0 en `interpretarPostDeBarrido`.
   */
  assert.equal(interpretarOrigen(null), 'chenson');
  assert.equal(interpretarOrigen(null), ORIGEN_POR_DEFECTO);
  assert.equal(interpretarOrigen(''), '');
});

test('un origen pedido y valido se respeta', async () => {
  assert.equal(interpretarOrigen('catalogo-viejo'), 'catalogo-viejo');
  assert.equal(interpretarOrigen('manual'), 'manual');
  assert.equal(interpretarOrigen('chenson'), 'chenson');
});

test('un origen que no existe muestra todo, no el default', async () => {
  /**
   * Un valor tipeado a mano en la barra es una intencion que no se pudo honrar. Mostrar todo
   * no esconde nada; caer al default filtraria en silencio sobre algo que nadie pidio.
   */
  assert.equal(interpretarOrigen('no-existe'), '');
  assert.equal(interpretarOrigen('CHENSON'), '');
});
