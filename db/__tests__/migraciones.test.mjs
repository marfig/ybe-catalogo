import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * Tests de la CARPETA de migraciones, aplicada entera y en orden.
 *
 * `esquema.test.mjs` aplica solo `0001` a proposito: verifica los invariantes
 * del esquema inicial contra el archivo que los declara. Pero produccion no
 * corre `0001`: corre `wrangler d1 migrations apply`, que aplica todos los
 * archivos en orden alfabetico. Entre las dos cosas habia un hueco — las
 * migraciones 0002 a 0006 no tenian ninguna prueba.
 *
 * Este archivo cubre ese hueco y prueba lo que las otras no pueden:
 *
 *   1. Que la SECUENCIA completa aplique limpia. Un ALTER que choca con un
 *      indice creado dos archivos antes solo se ve corriendo la cadena.
 *   2. Que cada migracion siga en pie DESPUES de las que vinieron detras.
 *   3. Que un backfill se aplique a las filas que ya estaban, que es el unico
 *      caso donde el ORDEN de aplicacion cambia el resultado.
 *
 * No duplica los invariantes de `0001`: esos ya tienen dueno.
 */

const DIRECTORIO = 'db/migrations';

// Ordenadas por nombre, que es exactamente el criterio de wrangler. Se leen del
// disco y no de una lista escrita a mano: una migracion nueva entra sola a
// estas pruebas, sin que nadie se acuerde de agregarla.
const MIGRACIONES = readdirSync(DIRECTORIO)
  .filter((n) => n.endsWith('.sql'))
  .sort();

/** Aplica las primeras `cuantas` migraciones sobre una base nueva en memoria. */
function aplicar(cuantas = MIGRACIONES.length) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const nombre of MIGRACIONES.slice(0, cuantas)) {
    db.exec(readFileSync(`${DIRECTORIO}/${nombre}`, 'utf8'));
  }
  return db;
}

const AHORA = '2026-08-31T12:00:00Z';

function columnas(db, tabla) {
  return db
    .prepare(`SELECT name FROM pragma_table_info(?) ORDER BY name`)
    .all(tabla)
    .map((r) => r.name);
}

function indices(db) {
  return db
    .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'`)
    .all()
    .map((r) => r.name);
}

function insertarImagen(db, hash16 = 'aaaaaaaaaaaaaaaa') {
  return db
    .prepare(
      `INSERT INTO imagenes (hash16, anchos, ancho_origen, alto_origen, bytes_origen, creado_en)
       VALUES (?, '[300,600]', 600, 600, 1, ?) RETURNING id`
    )
    .get(hash16, AHORA).id;
}

// --------------------------------------------------------------------------
// La cadena completa
// --------------------------------------------------------------------------

test('la numeracion de las migraciones es contigua y sin repetidos', () => {
  // Dos archivos con el mismo numero aplican los dos, en un orden que decide el
  // resto del nombre. Un numero salteado suele ser una migracion que quedo sin
  // commitear. Las dos cosas se ven aca y no en produccion.
  const numeros = MIGRACIONES.map((n) => Number(n.slice(0, 4)));
  const esperados = numeros.map((_, i) => i + 1);
  assert.deepEqual(numeros, esperados);
});

test('la carpeta entera aplica en orden sin error', () => {
  assert.doesNotThrow(() => aplicar());
});

test('aplicar la cadena deja las 9 tablas del esquema acumulado', () => {
  const db = aplicar();
  const tablas = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all()
    .map((r) => r.name);

  assert.deepEqual(tablas, [
    'imagenes',
    'pedidos_especiales',
    'producto_categorias',
    'productos',
    'publicaciones',
    'scrape_errores',
    'scrapes',
    'variante_imagenes',
    'variantes',
  ]);
});

test('cada migracion aplica sobre el estado que dejo la anterior', () => {
  // Aplica los prefijos 0001, 0001-0002, 0001-0002-0003... Si una migracion
  // depende de algo que todavia no existe, falla en su propio paso y el nombre
  // del archivo aparece en el error.
  for (let n = 1; n <= MIGRACIONES.length; n++) {
    assert.doesNotThrow(() => aplicar(n), `fallo al aplicar hasta ${MIGRACIONES[n - 1]}`);
  }
});

// --------------------------------------------------------------------------
// 0002 — el codigo es insensible a mayusculas
// --------------------------------------------------------------------------

test('0002: el mismo codigo en otra caja es rechazado', () => {
  // El UNIQUE de la columna no alcanza: SQLite compara TEXT con collation
  // BINARY. Sin el indice sobre upper(codigo) las dos filas entran.
  const db = aplicar();
  const ins = db.prepare(
    `INSERT INTO productos (codigo, proveedor, slug, nombre, estado, creado_en, actualizado_en)
     VALUES (?, 'chenson', ?, 'Cartera', 'publicado', ?, ?)`
  );
  ins.run('CG85527', 'cartera-a', AHORA, AHORA);
  assert.throws(() => ins.run('cg85527', 'cartera-b', AHORA, AHORA), /UNIQUE|constraint/i);
});

// --------------------------------------------------------------------------
// 0003 a 0005 — las columnas de marca del admin
// --------------------------------------------------------------------------

test('0003-0005: productos acumula las cinco columnas de seguimiento', () => {
  const db = aplicar();
  const cols = columnas(db, 'productos');
  for (const col of [
    'cambio_en_origen', // 0003
    'eliminado_en', // 0004
    'eliminado_por', // 0004
    'revisado_en_origen', // 0005
    'ausente_desde', // 0005
  ]) {
    assert.ok(cols.includes(col), `falta la columna ${col}`);
  }
});

test('0003-0005: las cinco columnas nacen en NULL', () => {
  // NULL es el estado "sin novedad" del que dependen las consultas del admin.
  // Un DEFAULT distinto marcaria todo el catalogo existente de golpe.
  const db = aplicar();
  db.prepare(
    `INSERT INTO productos (codigo, proveedor, slug, nombre, estado, creado_en, actualizado_en)
     VALUES ('CG1', 'chenson', 'una-cartera', 'Cartera', 'publicado', ?, ?)`
  ).run(AHORA, AHORA);

  const fila = db
    .prepare(
      `SELECT cambio_en_origen, eliminado_en, eliminado_por, revisado_en_origen, ausente_desde
       FROM productos WHERE codigo='CG1'`
    )
    .get();

  assert.deepEqual(Object.values(fila), [null, null, null, null, null]);
});

test('0003 y 0005: los indices parciales existen', () => {
  // Parciales a proposito: indexan solo las filas con aviso, que son pocas.
  const nombres = indices(aplicar());
  assert.ok(nombres.includes('idx_productos_cambio_en_origen'));
  assert.ok(nombres.includes('idx_productos_ausente_desde'));
});

test('0005: el tipo de scrape se rellena en los scrapes que ya existian', () => {
  // El unico caso de esta carpeta donde el ORDEN cambia el resultado. Un scrape
  // guardado antes de 0005 tiene que quedar como 'importacion', no como NULL:
  // la columna es NOT NULL y el barrido filtra por ella.
  const db = aplicar(4); // hasta 0004, o sea antes de que exista `tipo`
  db.prepare(
    `INSERT INTO scrapes (url, estado, iniciado_en) VALUES ('https://ejemplo/1', 'terminado', ?)`
  ).run(AHORA);

  db.exec(readFileSync(`${DIRECTORIO}/${MIGRACIONES[4]}`, 'utf8'));

  assert.equal(db.prepare(`SELECT tipo FROM scrapes`).get().tipo, 'importacion');
});

// --------------------------------------------------------------------------
// 0006 — pedidos especiales
// --------------------------------------------------------------------------

function insertarPedido(db, campos = {}) {
  const p = {
    slug: 'bolsas-de-tela',
    nombre: 'Bolsas de tela',
    descripcion: 'Por cantidad, precio a convenir.',
    ...campos,
  };
  return db
    .prepare(
      `INSERT INTO pedidos_especiales (slug, nombre, descripcion, imagen_id, creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`
    )
    .get(p.slug, p.nombre, p.descripcion, p.imagen_id, AHORA, AHORA).id;
}

test('0006: el slug de un pedido especial es unico', () => {
  // Dos filas con el mismo slug generan la misma pagina y una pisa a la otra en
  // el build, sin error.
  const db = aplicar();
  const img = insertarImagen(db);
  insertarPedido(db, { imagen_id: img });
  assert.throws(() => insertarPedido(db, { imagen_id: img, nombre: 'Otro' }), /UNIQUE|constraint/i);
});

test('0006: un pedido especial sin descripcion es rechazado', () => {
  // Al reves que en productos: aca la descripcion ES la ficha.
  const db = aplicar();
  const img = insertarImagen(db);
  assert.throws(
    () => insertarPedido(db, { imagen_id: img, descripcion: null }),
    /NOT NULL|constraint/i
  );
});

test('0006: un pedido especial sin imagen es rechazado', () => {
  const db = aplicar();
  assert.throws(() => insertarPedido(db, { imagen_id: null }), /NOT NULL|constraint/i);
});

test('0006: borrar una imagen en uso falla, no vacia la ficha', () => {
  // Sin ON DELETE CASCADE a proposito (§12.3): la recoleccion de huerfanas tiene
  // que ver esta referencia como cualquier otra.
  const db = aplicar();
  const img = insertarImagen(db);
  insertarPedido(db, { imagen_id: img });
  assert.throws(
    () => db.prepare(`DELETE FROM imagenes WHERE id=?`).run(img),
    /FOREIGN KEY|constraint/i
  );
});

test('0006: el orden por defecto manda la ficha al final', () => {
  const db = aplicar();
  const id = insertarPedido(db, { imagen_id: insertarImagen(db) });
  assert.equal(db.prepare(`SELECT orden FROM pedidos_especiales WHERE id=?`).get(id).orden, 999);
});
