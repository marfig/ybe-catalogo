import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

import { construirProductos, serializar, PUBLICABLES } from '../construir.mjs';
import {
  ESTADOS,
  PARAMS,
  SQL,
  consultarFilas,
  ejecutorD1,
  endpointD1,
  leerConfigD1,
} from '../consultar.mjs';

/**
 * Tests de la capa de consultas del volcado (SPEC-etapa2 §5.5).
 *
 * `consultar.mjs` es la unica pieza del volcado que necesita una base, asi que se
 * prueba contra la MIGRACION REAL en una base en memoria con `node:sqlite` — no
 * contra un doble. D1 es SQLite: el SQL que pasa aca es el que va a correr en
 * produccion, y eso es lo que un mock no puede darnos.
 *
 * De `ejecutorD1()` no se prueba el transporte — eso es un fetch — pero SI su
 * manejo de respuestas: D1 devuelve los errores de SQL con HTTP 200 y
 * `success: false`, y leer eso como resultado vacio vaciaria `productos.json`, o
 * sea borraria el catalogo publicado. Se inyecta un `buscar` falso.
 */

const MIGRACION = readFileSync('db/migrations/0001_esquema_inicial.sql', 'utf8');
const AHORA = '2026-08-04T12:00:00Z';

function base() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(MIGRACION);
  return db;
}

/** Ejecutor sobre node:sqlite, la contraparte offline de `ejecutorD1()`. */
const ejecutorSqlite = (db) => (sql, params = []) => db.prepare(sql).all(...params);

let secuencia = 0;
const unico = () => ++secuencia;

/**
 * hash16 derivado del codigo, NO del orden de insercion.
 *
 * Un contador de insercion haria que el mismo producto logico tenga distinto hash
 * segun cuando se cargo, y el test de "el orden no cambia la salida" compararia
 * dos bases con datos DISTINTOS. El hash es dato, no orden.
 */
function hashDe(codigo) {
  let h = 0n;
  for (const c of codigo) h = (h * 131n + BigInt(c.codePointAt(0))) % (1n << 64n);
  return h.toString(16).padStart(16, '0');
}

/**
 * Inserta un producto publicable completo: una variante, una imagen y una
 * categoria. Devuelve los ids para poder ensuciar casos puntuales.
 */
function insertarCompleto(db, campos = {}) {
  const n = unico();
  const codigo = campos.codigo ?? `CG${1000 + n}`;
  const p = {
    codigo,
    proveedor: 'chenson',
    slug: `producto-${n}`,
    nombre: `Producto ${n}`,
    descripcion: null,
    precio: 150000,
    destacado: 0,
    estado: 'publicado',
    color: 'Azul',
    colorHex: null,
    activoVariante: 1,
    hash16: hashDe(codigo),
    anchos: '[300,600]',
    categoria: 'carteras',
    ...campos,
  };

  const productoId = db
    .prepare(
      `INSERT INTO productos
         (codigo, proveedor, slug, nombre, descripcion, precio, destacado, estado, creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
    )
    .get(
      p.codigo,
      p.proveedor,
      p.slug,
      p.nombre,
      p.descripcion,
      p.precio,
      p.destacado,
      p.estado,
      AHORA,
      AHORA
    ).id;

  const varianteId = db
    .prepare(
      `INSERT INTO variantes (producto_id, sku, color, color_hex, activo, orden)
       VALUES (?, ?, ?, ?, ?, 0) RETURNING id`
    )
    .get(productoId, `${p.codigo}-01`, p.color, p.colorHex, p.activoVariante).id;

  const imagenId = db
    .prepare(
      `INSERT INTO imagenes (hash16, anchos, ancho_origen, alto_origen, bytes_origen, creado_en)
       VALUES (?, ?, 600, 600, 1000, ?) RETURNING id`
    )
    .get(p.hash16, p.anchos, AHORA).id;

  db.prepare(`INSERT INTO variante_imagenes (variante_id, imagen_id, orden) VALUES (?, ?, 0)`).run(
    varianteId,
    imagenId
  );

  db.prepare(
    `INSERT INTO producto_categorias (producto_id, categoria_slug, orden) VALUES (?, ?, 0)`
  ).run(productoId, p.categoria);

  return { productoId, varianteId, imagenId, ...p };
}

// --------------------------------------------------------------------------
// La lista de estados NO se duplica
// --------------------------------------------------------------------------

test('ESTADOS deriva de PUBLICABLES de construir.mjs, no de una copia', () => {
  // Es el test que impide la divergencia silenciosa: si alguien agrega un estado
  // publicable en construir.mjs y el SQL sigue filtrando por los viejos, el
  // volcado dejaria de fuera productos sin que nada falle.
  assert.deepEqual(new Set(ESTADOS), PUBLICABLES);
  assert.equal(PARAMS.length, PUBLICABLES.size);
});

test('cada consulta tiene tantos placeholders como estados publicables', () => {
  for (const [nombre, sql] of Object.entries(SQL)) {
    const huecos = (sql.match(/\?/g) ?? []).length;
    assert.equal(huecos, PUBLICABLES.size, `${nombre} tiene ${huecos} placeholders`);
  }
});

// --------------------------------------------------------------------------
// Forma de las filas: es el contrato con construirProductos()
// --------------------------------------------------------------------------

test('consultarFilas: devuelve las cuatro colecciones que espera construirProductos', async () => {
  const db = base();
  insertarCompleto(db);

  const filas = await consultarFilas(ejecutorSqlite(db));

  assert.deepEqual(Object.keys(filas).sort(), ['categorias', 'imagenes', 'productos', 'variantes']);
  assert.equal(filas.productos.length, 1);
  assert.equal(filas.variantes.length, 1);
  assert.equal(filas.imagenes.length, 1);
  assert.equal(filas.categorias.length, 1);
});

test('consultarFilas: las columnas son exactamente las que construirProductos lee', async () => {
  const db = base();
  insertarCompleto(db);
  const filas = await consultarFilas(ejecutorSqlite(db));

  // Si una columna se cae del SELECT, construirProductos no falla: emite un JSON
  // con el campo ausente y el error aparece recien en `astro build` o, peor, en
  // produccion. De ahi que el contrato se afirme aca, columna por columna.
  assert.deepEqual(Object.keys(filas.productos[0]).sort(), [
    'actualizado_en',
    'codigo',
    'descripcion',
    'destacado',
    'estado',
    'id',
    'nombre',
    'precio',
    'proveedor',
    'slug',
  ]);
  assert.deepEqual(Object.keys(filas.variantes[0]).sort(), [
    'activo',
    'color',
    'color_hex',
    'id',
    'producto_id',
    'sku',
  ]);
  assert.deepEqual(Object.keys(filas.imagenes[0]).sort(), [
    'anchos',
    'hash16',
    'orden',
    'variante_id',
  ]);
  assert.deepEqual(Object.keys(filas.categorias[0]).sort(), [
    'categoria_slug',
    'orden',
    'producto_id',
  ]);
});

// --------------------------------------------------------------------------
// El filtro de estado tiene que ser CONSISTENTE en las cuatro consultas
// --------------------------------------------------------------------------

test('consultarFilas: excluye los productos importados', async () => {
  const db = base();
  insertarCompleto(db, { estado: 'publicado', slug: 'visible' });
  insertarCompleto(db, { estado: 'importado', slug: null });

  const filas = await consultarFilas(ejecutorSqlite(db));
  assert.equal(filas.productos.length, 1);
  assert.equal(filas.productos[0].slug, 'visible');
});

test('consultarFilas: tampoco trae las variantes, imagenes ni categorias de un importado', async () => {
  // El filtro tiene que ser consistente en las cuatro consultas. Si los hijos
  // vinieran sin su padre, construirProductos los veria como huerfanos y cortaria
  // el volcado con un error de corrupcion referencial que NO existe.
  const db = base();
  insertarCompleto(db, { estado: 'importado', slug: null });

  const filas = await consultarFilas(ejecutorSqlite(db));
  assert.deepEqual(filas, { productos: [], variantes: [], imagenes: [], categorias: [] });
});

test('consultarFilas: incluye aprobado, publicado y eliminado', async () => {
  const db = base();
  for (const estado of ['aprobado', 'publicado', 'eliminado']) {
    insertarCompleto(db, { estado, slug: `slug-${estado}` });
  }

  const filas = await consultarFilas(ejecutorSqlite(db));
  assert.deepEqual(
    filas.productos.map((p) => p.estado).sort(),
    ['aprobado', 'eliminado', 'publicado']
  );
});

// --------------------------------------------------------------------------
// El join de imagenes pasa por variante_imagenes
// --------------------------------------------------------------------------

test('consultarFilas: las imagenes llegan con variante_id, no con imagen_id', async () => {
  const db = base();
  const { varianteId, hash16 } = insertarCompleto(db);

  const filas = await consultarFilas(ejecutorSqlite(db));
  assert.equal(filas.imagenes[0].variante_id, varianteId);
  assert.equal(filas.imagenes[0].hash16, hash16);
  assert.equal(filas.imagenes[0].anchos, '[300,600]');
});

test('consultarFilas: una imagen compartida por dos variantes aparece una vez por variante', async () => {
  // El dedupe de SPEC §6.8 es en R2 (una sola subida), NO en el JSON: las dos
  // variantes tienen que mostrar la foto.
  const db = base();
  const a = insertarCompleto(db);
  const b = insertarCompleto(db);
  db.prepare(`INSERT INTO variante_imagenes (variante_id, imagen_id, orden) VALUES (?, ?, 1)`).run(
    b.varianteId,
    a.imagenId
  );

  const filas = await consultarFilas(ejecutorSqlite(db));
  const compartida = filas.imagenes.filter((i) => i.hash16 === a.hash16);
  assert.equal(compartida.length, 2);
  assert.deepEqual(
    compartida.map((i) => i.variante_id).sort((x, y) => x - y),
    [a.varianteId, b.varianteId].sort((x, y) => x - y)
  );
});

// --------------------------------------------------------------------------
// El criterio de salida de la fase 2.2: el volcado es idempotente
// --------------------------------------------------------------------------

test('pipeline completo: consultar -> construir -> serializar produce el JSON esperado', async () => {
  const db = base();
  insertarCompleto(db, {
    codigo: 'CG85527',
    slug: 'cartera-de-fiesta',
    nombre: 'Cartera de fiesta',
    precio: 185000,
    color: 'Negro',
    categoria: 'carteras',
  });

  const productos = construirProductos(await consultarFilas(ejecutorSqlite(db)));

  assert.equal(productos.length, 1);
  assert.equal(productos[0].id, 'cartera-de-fiesta');
  assert.equal(productos[0].nombre, 'Cartera de fiesta');
  assert.equal(productos[0].precio, 185000);
  assert.deepEqual(productos[0].categorias, ['carteras']);
  assert.equal(productos[0].variantes.length, 1);
  assert.equal(productos[0].variantes[0].color, 'Negro');
  assert.equal(productos[0].variantes[0].imagenes.length, 1);
  assert.deepEqual(productos[0].origen, { proveedor: 'chenson', ref: 'CG85527' });
  assert.equal(productos[0].actualizado, '2026-08-04');
});

test('pipeline completo: dos volcados de la misma base dan bytes identicos', async () => {
  // Es el criterio de salida de la fase 2.2 (SPEC-etapa2 §5.5): sin esto un build
  // sin cambios generaria un commit vacio en cada publicacion.
  const db = base();
  for (let i = 0; i < 5; i++) insertarCompleto(db);

  const ejecutar = ejecutorSqlite(db);
  const uno = serializar(construirProductos(await consultarFilas(ejecutar)));
  const dos = serializar(construirProductos(await consultarFilas(ejecutar)));

  assert.equal(uno, dos);
});

test('pipeline completo: el orden de insercion NO cambia la salida', async () => {
  // El ORDER BY del SQL no alcanza como garantia: los ids los asigna la base en
  // orden de insercion, asi que dos bases con los mismos datos cargados en otro
  // orden tienen que producir el MISMO JSON.
  const datos = [
    { codigo: 'CZ1', slug: 'zapato', nombre: 'Zapato', color: 'Rojo' },
    { codigo: 'CA2', slug: 'apple', nombre: 'Apple', color: 'Azul' },
    { codigo: 'CM3', slug: 'mochila', nombre: 'Mochila', color: 'Verde' },
  ];

  const volcar = async (orden) => {
    const db = base();
    for (const d of orden) insertarCompleto(db, d);
    return serializar(construirProductos(await consultarFilas(ejecutorSqlite(db))));
  };

  const directo = await volcar(datos);
  const invertido = await volcar([...datos].reverse());
  assert.equal(directo, invertido);
});

// --------------------------------------------------------------------------
// leerConfigD1 — mismo criterio que leerConfigR2
// --------------------------------------------------------------------------

test('leerConfigD1: devuelve la config con las tres variables', () => {
  const config = leerConfigD1({
    CLOUDFLARE_ACCOUNT_ID: 'cuenta',
    D1_DATABASE_ID: 'base',
    CLOUDFLARE_API_TOKEN: 'token',
  });
  assert.deepEqual(config, { accountId: 'cuenta', databaseId: 'base', token: 'token' });
});

test('leerConfigD1: lista TODAS las que faltan', () => {
  assert.throws(
    () => leerConfigD1({ CLOUDFLARE_ACCOUNT_ID: 'cuenta' }),
    (error) => {
      const lista = error.message.match(/faltan: ([^.]+)\./)[1];
      assert.deepEqual(lista.split(', '), ['D1_DATABASE_ID', 'CLOUDFLARE_API_TOKEN']);
      return true;
    }
  );
});

// --------------------------------------------------------------------------
// ejecutorD1 — un error de D1 NO puede leerse como catalogo vacio
// --------------------------------------------------------------------------

const CONFIG = { accountId: 'cuenta', databaseId: 'base', token: 'secreto' };

/** `buscar` falso: devuelve el cuerpo dado con el estado dado. */
function buscarFalso(cuerpo, estado = 200) {
  const llamadas = [];
  const buscar = async (url, opciones) => {
    llamadas.push({ url, opciones });
    return {
      ok: estado >= 200 && estado < 300,
      status: estado,
      json: async () => cuerpo,
    };
  };
  return { buscar, llamadas };
}

test('endpointD1: endpoint de consulta de la API HTTP', () => {
  assert.equal(
    endpointD1(CONFIG),
    'https://api.cloudflare.com/client/v4/accounts/cuenta/d1/database/base/query'
  );
});

test('ejecutorD1: manda el bearer, el sql y los params', async () => {
  const { buscar, llamadas } = buscarFalso({ success: true, result: [{ results: [{ id: 1 }] }] });
  const filas = await ejecutorD1(CONFIG, buscar)('SELECT 1', ['aprobado']);

  assert.deepEqual(filas, [{ id: 1 }]);
  assert.equal(llamadas[0].opciones.headers.Authorization, 'Bearer secreto');
  assert.deepEqual(JSON.parse(llamadas[0].opciones.body), {
    sql: 'SELECT 1',
    params: ['aprobado'],
  });
});

test('ejecutorD1: un success:false con HTTP 200 REVIENTA, no devuelve vacio', async () => {
  // El caso mas peligroso de todos: D1 reporta los errores de SQL con HTTP 200.
  // Devolver [] aca haria que el volcado escriba un productos.json vacio y la
  // publicacion borre el catalogo entero sin un solo error.
  const { buscar } = buscarFalso({
    success: false,
    errors: [{ code: 7500, message: 'no such column: nombre' }],
    result: [],
  });
  await assert.rejects(
    () => ejecutorD1(CONFIG, buscar)('SELECT nombre FROM productos'),
    /7500 no such column: nombre/
  );
});

test('ejecutorD1: un HTTP de error revienta con el codigo y el detalle', async () => {
  const { buscar } = buscarFalso({ errors: [{ code: 10000, message: 'token invalido' }] }, 403);
  await assert.rejects(() => ejecutorD1(CONFIG, buscar)('SELECT 1'), /HTTP 403.*10000 token invalido/);
});

test('ejecutorD1: un cuerpo sin errores igual da un mensaje utilizable', async () => {
  const { buscar } = buscarFalso(null, 500);
  await assert.rejects(() => ejecutorD1(CONFIG, buscar)('SELECT 1'), /HTTP 500.*sin detalle/);
});

test('ejecutorD1: mas de un resultado para una sola sentencia revienta', async () => {
  // Si esto pasa, la respuesta no es la que creemos y quedarse con la primera
  // seria adivinar.
  const { buscar } = buscarFalso({
    success: true,
    result: [{ results: [{ id: 1 }] }, { results: [{ id: 2 }] }],
  });
  await assert.rejects(() => ejecutorD1(CONFIG, buscar)('SELECT 1'), /devolvio 2 resultados/);
});

test('ejecutorD1: un resultado sin filas devuelve arreglo vacio, no undefined', async () => {
  // Una tabla legitimamente vacia SI es un resultado valido: el que revienta es el
  // error de D1, no la ausencia de filas.
  const { buscar } = buscarFalso({ success: true, result: [{ success: true }] });
  assert.deepEqual(await ejecutorD1(CONFIG, buscar)('SELECT 1'), []);
});
