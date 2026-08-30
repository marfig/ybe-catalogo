import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

import { ejecutarAccion, esAccion, necesitaSeleccion } from './acciones.ts';
import type { CambioFila } from './guardar.ts';
import { loteSqlite } from './d1.ts';
import type { Ejecutar } from './grilla.ts';

/**
 * Tests del ORDEN de las acciones de la grilla (SPEC-etapa2 §10.3).
 *
 * Lo que se prueba acá no es qué hace cada acción — eso ya está en `guardar.test.ts` y
 * `transiciones.test.ts` — sino que **toda acción que escribe parte de lo que hay en
 * pantalla y no de lo que quedó en la base**.
 *
 * El caso que motivó este módulo: se tipea nombre y precio en un producto recién
 * scrapeado, se tilda su casilla y se aprieta «Aprobar». Antes, `guardarFilas` no
 * corría, `aprobar` leía la base vieja y respondía «falta nombre» sobre un nombre que
 * estaba a la vista. Y el redirect borraba lo tipeado.
 */

/**
 * TODAS las migraciones y no solo el esquema inicial: `no-es-baja` opera sobre
 * `ausente_desde`, que entra en la 0005. Con una sola, esa accion no se puede probar.
 */
const MIGRACIONES = [
  '0001_esquema_inicial.sql',
  '0002_codigo_insensible_a_mayusculas.sql',
  '0003_aviso_cambio_en_origen.sql',
  '0004_papelera.sql',
  '0005_barrido_de_bajas.sql',
].map((n) => readFileSync(new URL(`../../../db/migrations/${n}`, import.meta.url), 'utf8'));
const ANTES = '2026-08-01T10:00:00Z';
const AHORA = '2026-08-05T16:00:00Z';
const CATEGORIAS = new Set(['carteras', 'mochilas', 'escolar', 'dama']);

function base() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const m of MIGRACIONES) db.exec(m);
  return db;
}

const ejecutor =
  (db: DatabaseSync): Ejecutar =>
  async (sql, params = []) =>
    db.prepare(sql).all(...(params as never[])) as never;

interface Alta {
  codigo?: string;
  nombre?: string | null;
  precio?: number | null;
  estado?: string;
  slug?: string | null;
  categorias?: string[];
  /** Si tiene una variante de color. Sin variante no se puede aprobar. */
  conVariante?: boolean;
}

function alta(db: DatabaseSync, a: Alta = {}): number {
  const codigo = a.codigo ?? 'CG1000';
  const estado = a.estado ?? 'importado';
  const fila = db
    .prepare(
      `INSERT INTO productos (codigo, proveedor, slug, nombre, precio, estado, creado_en, actualizado_en)
       VALUES (?, 'chenson', ?, ?, ?, ?, ?, ?) RETURNING id`
    )
    .get(
      codigo,
      a.slug !== undefined ? a.slug : null,
      // El default es el marcador de "sin nombre" del importador: nombre == codigo
      // (SPEC.md §6.6). Es el estado real de un producto recien scrapeado.
      a.nombre !== undefined ? a.nombre : codigo,
      a.precio !== undefined ? a.precio : null,
      estado,
      ANTES,
      ANTES
    ) as { id: number };

  (a.categorias ?? []).forEach((c, orden) => {
    db.prepare(
      `INSERT INTO producto_categorias (producto_id, categoria_slug, orden) VALUES (?, ?, ?)`
    ).run(fila.id, c, orden);
  });

  if (a.conVariante !== false) {
    db.prepare(
      `INSERT INTO variantes (producto_id, sku, color, orden) VALUES (?, ?, 'Negro', 0)`
    ).run(fila.id, `${codigo}-N`);
  }
  return fila.id;
}

const leer = (db: DatabaseSync, id: number) =>
  db
    .prepare(`SELECT nombre, precio, estado, slug, actualizado_en FROM productos WHERE id = ?`)
    .get(id) as {
    nombre: string | null;
    precio: number | null;
    estado: string;
    slug: string | null;
    actualizado_en: string;
  };

const cats = (db: DatabaseSync, id: number) =>
  db
    .prepare(`SELECT categoria_slug FROM producto_categorias WHERE producto_id = ? ORDER BY orden`)
    .all(id)
    .map((f) => (f as { categoria_slug: string }).categoria_slug);

const cambio = (c: Partial<CambioFila> & { id: number }): CambioFila => ({
  nombre: 'Cartera de fiesta',
  descripcion: null,
  precio: 195000,
  categoriaPrincipal: 'carteras',
  ...c,
});

const opciones = { categoriasValidas: CATEGORIAS, ahora: AHORA };

/**
 * Las opciones con el ejecutor de lote de esta base.
 *
 * `loteSqlite` no es un doble: es la implementacion de `d1.ts` que cumple el mismo
 * contrato que `batch()` de D1, asi que estos tests ejercitan el camino de escritura real.
 */
const con = (db: DatabaseSync) => ({ ...opciones, lote: loteSqlite(db) });

// --------------------------------------------------------------------------
// esAccion: la puerta de entrada
// --------------------------------------------------------------------------

test('esAccion acepta las acciones conocidas y RECHAZA cualquier otra cosa', () => {
  assert.equal(esAccion('guardar'), true);
  assert.equal(esAccion('aprobar'), true);
  assert.equal(esAccion('aprobar-completos'), true);
  assert.equal(esAccion('categorias'), true);
  assert.equal(esAccion('publicar'), false);
  assert.equal(esAccion(''), false);
  assert.equal(esAccion(null), false);
  // Un `File` es lo que devuelve FormData.get de un campo de archivo: no es accion.
  assert.equal(esAccion({}), false);
});

test('necesitaSeleccion: solo las dos acciones que operan sobre lo tildado', () => {
  assert.equal(necesitaSeleccion('aprobar'), true);
  assert.equal(necesitaSeleccion('categorias'), true);
  assert.equal(necesitaSeleccion('guardar'), false);
  // El que importa: si diera true, el aviso de "no tildaste nada" saltaria justo en la
  // accion hecha para no tildar nada.
  assert.equal(necesitaSeleccion('aprobar-completos'), false);
});

// --------------------------------------------------------------------------
// EL CASO QUE MOTIVÓ EL MÓDULO
// --------------------------------------------------------------------------

test('APROBAR guarda primero: lo tipeado en pantalla es lo que se valida', async () => {
  // Producto recien scrapeado: nombre == codigo (el marcador de "sin nombre"), sin
  // precio y sin categoria. En la base NO se puede aprobar. En pantalla, con el nombre
  // y la categoria ya tipeados, SI.
  const db = base();
  const id = alta(db, { codigo: 'CG2000', categorias: [] });

  const rs = await ejecutarAccion(
    ejecutor(db),
    {
      accion: 'aprobar',
      cambios: [cambio({ id, nombre: 'Cartera de fiesta', categoriaPrincipal: 'carteras' })],
      seleccionados: [id],
      permitirSinFoto: true,
    },
    con(db)
  );

  const fila = leer(db, id);
  assert.equal(fila.nombre, 'Cartera de fiesta', 'lo tipeado tiene que haberse guardado');
  assert.equal(fila.estado, 'aprobado', 'y con eso guardado, la aprobacion procede');
  assert.equal(fila.slug, 'cartera-de-fiesta');
  assert.deepEqual(cats(db, id), ['carteras']);

  const suyo = rs.find((r) => r.id === id)!;
  assert.equal('desenlace' in suyo && suyo.desenlace, 'hecho');
});

test('sin el guardado previo el mismo caso fallaria: la base sola no alcanza', async () => {
  // El control del test anterior. Se manda la fila SIN cambios tipeados, o sea lo que
  // `aprobar` veia antes: el marcador de sin nombre y ninguna categoria.
  const db = base();
  const id = alta(db, { codigo: 'CG2001', categorias: [] });

  const rs = await ejecutarAccion(
    ejecutor(db),
    {
      accion: 'aprobar',
      cambios: [cambio({ id, nombre: 'CG2001', categoriaPrincipal: null })],
      seleccionados: [id],
      permitirSinFoto: true,
    },
    con(db)
  );

  assert.equal(leer(db, id).estado, 'importado');
  const suyo = rs.find((r) => r.id === id)!;
  assert.equal('desenlace' in suyo && suyo.desenlace, 'fallo');
  assert.match(suyo.motivo!, /sin nombre/);
  assert.match(suyo.motivo!, /sin categoría/);
});

// --------------------------------------------------------------------------
// Una fila que no se pudo guardar no se puede aprobar
// --------------------------------------------------------------------------

test('una fila que fallo al guardar NO se aprueba: se actuaria sobre datos viejos', async () => {
  const db = base();
  // Vaciar el nombre de un PUBLICADO se rechaza en el guardado. Aunque este producto
  // igual se omitiria por su estado, lo que se prueba es que ni se intenta.
  const id = alta(db, { codigo: 'CG2002', estado: 'publicado', slug: 's', nombre: 'No me borres' });

  const rs = await ejecutarAccion(
    ejecutor(db),
    {
      accion: 'aprobar',
      cambios: [cambio({ id, nombre: '   ' })],
      seleccionados: [id],
      permitirSinFoto: true,
    },
    con(db)
  );

  assert.equal(leer(db, id).nombre, 'No me borres');
  // Un solo resultado para esa fila, y es el del guardado: no se acumula un segundo
  // veredicto de la aprobacion sobre el mismo producto.
  const suyos = rs.filter((r) => r.id === id);
  assert.equal(suyos.length, 1);
  assert.equal('ok' in suyos[0] && suyos[0].ok, false);
});

test('el fallo al guardar se reporta AUNQUE la fila no estuviera tildada', async () => {
  // Si no se reportara, quien opera creeria que su tipeo en esa fila se guardo. Es
  // perdida silenciosa de trabajo, que es peor que un error a la vista.
  const db = base();
  const tildado = alta(db, { codigo: 'CG1', categorias: ['carteras'], nombre: 'Listo' });
  const otro = alta(db, { codigo: 'CG2', estado: 'publicado', slug: 's2', nombre: 'No me borres' });

  const rs = await ejecutarAccion(
    ejecutor(db),
    {
      accion: 'aprobar',
      cambios: [cambio({ id: tildado, nombre: 'Listo' }), cambio({ id: otro, nombre: '' })],
      seleccionados: [tildado],
      permitirSinFoto: true,
    },
    con(db)
  );

  assert.equal(leer(db, tildado).estado, 'aprobado', 'el tildado se aprueba igual');
  const suyo = rs.find((r) => r.id === otro)!;
  assert.equal('ok' in suyo && suyo.ok, false);
  assert.match(suyo.motivo!, /nombre/i);
});

// --------------------------------------------------------------------------
// aprobar-completos: sin seleccion, aprueba lo que quedo listo
// --------------------------------------------------------------------------

test('aprobar-completos aprueba los listos e IGNORA la seleccion', async () => {
  const db = base();
  const listo = alta(db, { codigo: 'CG6001', categorias: ['carteras'], nombre: 'Cartera' });
  const otroListo = alta(db, { codigo: 'CG6002', categorias: ['mochilas'], nombre: 'Mochila' });
  const incompleto = alta(db, { codigo: 'CG6003', categorias: [] });

  const rs = await ejecutarAccion(
    ejecutor(db),
    {
      accion: 'aprobar-completos',
      cambios: [
        cambio({ id: listo, nombre: 'Cartera', categoriaPrincipal: 'carteras' }),
        cambio({ id: otroListo, nombre: 'Mochila', categoriaPrincipal: 'mochilas' }),
        // Sin nombre y sin categoria: sigue incompleto despues de guardar.
        cambio({ id: incompleto, nombre: '', categoriaPrincipal: null }),
      ],
      // Vacia a proposito: esta accion no mira las casillas.
      seleccionados: [],
      permitirSinFoto: true,
    },
    con(db)
  );

  assert.equal(leer(db, listo).estado, 'aprobado');
  assert.equal(leer(db, otroListo).estado, 'aprobado');
  assert.equal(leer(db, incompleto).estado, 'importado');

  const desenlaces = new Map(
    rs.filter((r) => 'desenlace' in r).map((r) => [r.id, (r as { desenlace: string }).desenlace])
  );
  assert.equal(desenlaces.get(listo), 'hecho');
  assert.equal(desenlaces.get(otroListo), 'hecho');
});

test('un incompleto sale OMITIDO, no como fallo: nadie afirmo que estuviera listo', async () => {
  // Es la razon de ser de la accion. Con 50 filas y 12 listas, 38 fallos que nadie
  // provoco ahogan el unico dato que se esperaba.
  const db = base();
  const incompleto = alta(db, { codigo: 'CG6004', categorias: [] });

  const rs = await ejecutarAccion(
    ejecutor(db),
    {
      accion: 'aprobar-completos',
      cambios: [cambio({ id: incompleto, nombre: '', categoriaPrincipal: null })],
      seleccionados: [],
      permitirSinFoto: true,
    },
    con(db)
  );

  const suyo = rs.find((r) => r.id === incompleto)!;
  assert.equal('desenlace' in suyo && suyo.desenlace, 'omitido');
  // El motivo se conserva: omitido no significa mudo.
  assert.match(suyo.motivo!, /sin nombre/);
});

test('el mismo incompleto TILDADO a mano sigue siendo un fallo', async () => {
  // El control del test anterior. Tildarlo es afirmar que deberia aprobarse, y ahi si
  // hay algo que corregir. La validacion no cambia: cambia quien eligio.
  const db = base();
  const incompleto = alta(db, { codigo: 'CG6005', categorias: [] });

  const rs = await ejecutarAccion(
    ejecutor(db),
    {
      accion: 'aprobar',
      cambios: [cambio({ id: incompleto, nombre: '', categoriaPrincipal: null })],
      seleccionados: [incompleto],
      permitirSinFoto: true,
    },
    con(db)
  );

  const suyo = rs.find((r) => r.id === incompleto)!;
  assert.equal('desenlace' in suyo && suyo.desenlace, 'fallo');
});

test('aprobar-completos valida sobre LO TIPEADO: lo que acabas de completar entra', async () => {
  // El caso que hace que esta accion valga la pena. La fila se rindio incompleta, se
  // tipearon nombre y categoria, y con un solo boton queda aprobada. Con pre-seleccion
  // por JavaScript esto era imposible: el JS tildaria segun el estado viejo.
  const db = base();
  const id = alta(db, { codigo: 'CG6006', categorias: [] });

  await ejecutarAccion(
    ejecutor(db),
    {
      accion: 'aprobar-completos',
      cambios: [cambio({ id, nombre: 'Recien tipeada', categoriaPrincipal: 'dama' })],
      seleccionados: [],
      permitirSinFoto: true,
    },
    con(db)
  );

  const fila = leer(db, id);
  assert.equal(fila.estado, 'aprobado');
  assert.equal(fila.slug, 'recien-tipeada');
});

test('aprobar-completos no toca los que ya pasaron: siguen omitidos por su estado', async () => {
  const db = base();
  const publicado = alta(db, {
    codigo: 'CG6007',
    estado: 'publicado',
    slug: 'ya-esta',
    nombre: 'En la calle',
    categorias: ['carteras'],
  });

  const rs = await ejecutarAccion(
    ejecutor(db),
    {
      accion: 'aprobar-completos',
      cambios: [cambio({ id: publicado, nombre: 'En la calle' })],
      seleccionados: [],
      permitirSinFoto: true,
    },
    con(db)
  );

  assert.equal(leer(db, publicado).estado, 'publicado');
  const suyo = rs.find((r) => r.id === publicado)!;
  assert.equal('desenlace' in suyo && suyo.desenlace, 'omitido');
  assert.match(suyo.motivo!, /en el catálogo/);
});

test('aprobar-completos respeta el pedido de aprobar sin foto', async () => {
  // Sin la confirmacion, un producto sin fotos NO esta completo. Con ella, si. La
  // accion tiene que honrar esa casilla igual que "Aprobar".
  const db = base();
  const sinFoto = alta(db, { codigo: 'CG6008', categorias: ['carteras'], nombre: 'Sin foto' });

  const rs = await ejecutarAccion(
    ejecutor(db),
    {
      accion: 'aprobar-completos',
      cambios: [cambio({ id: sinFoto, nombre: 'Sin foto' })],
      seleccionados: [],
      permitirSinFoto: false,
    },
    con(db)
  );

  assert.equal(leer(db, sinFoto).estado, 'importado');
  const suyo = rs.find((r) => r.id === sinFoto)!;
  assert.equal('desenlace' in suyo && suyo.desenlace, 'omitido');
  assert.match(suyo.motivo!, /sin fotos/);
});

test('una fila que fallo al guardar queda afuera tambien de aprobar-completos', async () => {
  const db = base();
  const malo = alta(db, { codigo: 'CG6009', estado: 'publicado', slug: 's9', nombre: 'No me borres' });
  const bueno = alta(db, { codigo: 'CG6010', categorias: ['carteras'], nombre: 'Buena' });

  const rs = await ejecutarAccion(
    ejecutor(db),
    {
      accion: 'aprobar-completos',
      cambios: [cambio({ id: malo, nombre: '' }), cambio({ id: bueno, nombre: 'Buena' })],
      seleccionados: [],
      permitirSinFoto: true,
    },
    con(db)
  );

  assert.equal(leer(db, malo).nombre, 'No me borres');
  assert.equal(leer(db, bueno).estado, 'aprobado');
  // Un solo veredicto para la fila que fallo, y es el del guardado.
  const suyos = rs.filter((r) => r.id === malo);
  assert.equal(suyos.length, 1);
  assert.equal('ok' in suyos[0] && suyos[0].ok, false);
});

// --------------------------------------------------------------------------
// Guardar sola
// --------------------------------------------------------------------------

test('guardar devuelve los resultados del guardado y no transiciona nada', async () => {
  const db = base();
  const id = alta(db, { codigo: 'CG3000', categorias: ['carteras'], nombre: 'Antes' });

  const rs = await ejecutarAccion(
    ejecutor(db),
    { accion: 'guardar', cambios: [cambio({ id, nombre: 'Despues' })], seleccionados: [id] },
    con(db)
  );

  const fila = leer(db, id);
  assert.equal(fila.nombre, 'Despues');
  assert.equal(fila.estado, 'importado', 'guardar NO mueve el estado');
  assert.equal(fila.slug, null, 'ni crea el slug');
  assert.equal(rs.length, 1);
  assert.equal('ok' in rs[0] && rs[0].ok, true);
});

// --------------------------------------------------------------------------
// Categorias en lote
// --------------------------------------------------------------------------

test('categorias tambien guarda primero: la principal tipeada no se pierde', async () => {
  const db = base();
  const id = alta(db, { codigo: 'CG4000', categorias: [] });

  await ejecutarAccion(
    ejecutor(db),
    {
      accion: 'categorias',
      cambios: [cambio({ id, categoriaPrincipal: 'mochilas' })],
      seleccionados: [id],
      secundarias: ['escolar'],
    },
    con(db)
  );

  // La principal salio del select de la fila; la secundaria del lote. El orden importa:
  // categorias[0] es el breadcrumb (§5.1).
  assert.deepEqual(cats(db, id), ['mochilas', 'escolar']);
});

test('categorias sin ninguna elegida LANZA, y lo tipeado ya quedo guardado', async () => {
  // `asignarCategorias` valida antes de tocar la base, asi que las categorias no quedan
  // a medias. Lo tipeado SI se guardo, y eso es deliberado: perder el tipeo por una
  // eleccion vacia en otro control seria castigar el trabajo equivocado.
  const db = base();
  const id = alta(db, { codigo: 'CG4001', categorias: ['carteras'], nombre: 'Antes' });

  await assert.rejects(
    ejecutarAccion(
      ejecutor(db),
      {
        accion: 'categorias',
        cambios: [cambio({ id, nombre: 'Despues' })],
        seleccionados: [id],
        secundarias: [],
      },
      con(db)
    ),
    /categoría/i
  );

  assert.equal(leer(db, id).nombre, 'Despues');
});

// --------------------------------------------------------------------------
// Sin seleccion
// --------------------------------------------------------------------------

test('aprobar sin nada tildado igual GUARDA lo tipeado', async () => {
  // Olvidarse de tildar es un error normal. Que ademas borre lo que se tipeo, no.
  const db = base();
  const id = alta(db, { codigo: 'CG5000', categorias: ['carteras'], nombre: 'Antes' });

  const rs = await ejecutarAccion(
    ejecutor(db),
    { accion: 'aprobar', cambios: [cambio({ id, nombre: 'Despues' })], seleccionados: [] },
    con(db)
  );

  assert.equal(leer(db, id).nombre, 'Despues');
  assert.equal(leer(db, id).estado, 'importado', 'sin seleccion no se aprueba nada');
  assert.equal(rs.length, 0, 'una fila guardada sin problemas no tiene nada que reportar');
});

test('una pagina sin filas no escribe ni revienta', async () => {
  const db = base();
  const rs = await ejecutarAccion(
    ejecutor(db),
    { accion: 'guardar', cambios: [], seleccionados: [] },
    con(db)
  );
  assert.deepEqual(rs, []);
});

// --------------------------------------------------------------------------
// no-es-baja
// --------------------------------------------------------------------------

/** Marca un producto como dado de baja en el origen, como lo dejaria el barrido. */
function marcarBaja(db: DatabaseSync, id: number): void {
  db.prepare(`UPDATE productos SET ausente_desde = ? WHERE id = ?`).run(ANTES, id);
}

test('esAccion acepta no-es-baja', () => {
  assert.equal(esAccion('no-es-baja'), true);
});

test('no-es-baja opera sobre lo tildado', () => {
  // Es una correccion producto por producto: nadie quiere «sacale la marca a los 300».
  assert.equal(necesitaSeleccion('no-es-baja'), true);
});

test('no-es-baja saca la marca de los tildados', async () => {
  const db = base();
  const id = alta(db, { codigo: 'CG3001' });
  marcarBaja(db, id);

  const rs = await ejecutarAccion(
    ejecutor(db),
    { accion: 'no-es-baja', cambios: [cambio({ id })], seleccionados: [id] },
    con(db)
  );

  assert.equal(rs.length, 1);
  assert.equal((rs[0] as { desenlace: string }).desenlace, 'hecho');
  const [fila] = await ejecutor(db)<{ ausente_desde: string | null }>(
    'SELECT ausente_desde FROM productos WHERE id = ?',
    [id]
  );
  assert.equal(fila.ausente_desde, null);
});

test('no-es-baja guarda PRIMERO lo tipeado, como toda accion que escribe', async () => {
  /*
   * La regla del modulo. Alguien corrige el nombre en la grilla, tilda el producto y
   * aprieta «No es una baja»: sin el guardado previo, el redirect 303 recarga desde la
   * base y lo tipeado se pierde sin aviso — el bug que justifica este archivo.
   */
  const db = base();
  const id = alta(db, { codigo: 'CG3002', nombre: 'Viejo' });
  marcarBaja(db, id);

  await ejecutarAccion(
    ejecutor(db),
    { accion: 'no-es-baja', cambios: [cambio({ id, nombre: 'Nombre corregido' })], seleccionados: [id] },
    con(db)
  );

  const [fila] = await ejecutor(db)<{ nombre: string; ausente_desde: string | null }>(
    'SELECT nombre, ausente_desde FROM productos WHERE id = ?',
    [id]
  );
  assert.equal(fila.nombre, 'Nombre corregido');
  assert.equal(fila.ausente_desde, null);
});
