import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

/**
 * Tests del esquema de D1 (SPEC-etapa2 §5.1).
 *
 * D1 es SQLite, asi que la migracion se aplica sobre una base en memoria con
 * `node:sqlite` y se verifican las restricciones sin crear nada en la nube y sin
 * credenciales.
 *
 * No se testea que SQLite funcione: se testea que NUESTRO esquema declare bien
 * las restricciones que sostienen los invariantes. Un CHECK con un typo no da
 * error al crear la tabla — deja pasar estados imposibles en silencio, y eso es
 * justo lo que estas pruebas bloquean.
 */

const MIGRACION = readFileSync('db/migrations/0001_esquema_inicial.sql', 'utf8');

function base() {
  const db = new DatabaseSync(':memory:');
  // D1 aplica las foreign keys; en node:sqlite hay que pedirlo explicitamente
  // para que el test valide lo mismo que va a pasar en produccion.
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(MIGRACION);
  return db;
}

const AHORA = '2026-08-03T12:00:00Z';

/** Inserta un producto. Por defecto en un estado valido y publicable. */
function insertarProducto(db, campos = {}) {
  const p = {
    codigo: 'CG85527',
    proveedor: 'chenson',
    slug: 'cartera-de-fiesta',
    nombre: 'Cartera de fiesta',
    estado: 'publicado',
    ...campos,
  };
  return db
    .prepare(
      `INSERT INTO productos (codigo, proveedor, slug, nombre, estado, creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`
    )
    .get(p.codigo, p.proveedor, p.slug, p.nombre, p.estado, AHORA, AHORA).id;
}

// --------------------------------------------------------------------------
// La migracion se aplica
// --------------------------------------------------------------------------

test('la migracion crea las 8 tablas del esquema', () => {
  const db = base();
  const tablas = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all()
    .map((r) => r.name);

  assert.deepEqual(tablas, [
    'imagenes',
    'producto_categorias',
    'productos',
    'publicaciones',
    'scrape_errores',
    'scrapes',
    'variante_imagenes',
    'variantes',
  ]);
});

test('la migracion es aplicable dos veces sobre bases distintas', () => {
  // Detecta dependencias de orden o estado global entre sentencias.
  assert.doesNotThrow(() => {
    base();
    base();
  });
});

// --------------------------------------------------------------------------
// El invariante estado/slug (SPEC-etapa2 §5.2)
// --------------------------------------------------------------------------

test('un producto importado puede no tener slug', () => {
  // La URL nace al aprobar. Antes de eso no hay nada que preservar.
  const db = base();
  assert.doesNotThrow(() => insertarProducto(db, { estado: 'importado', slug: null }));
});

test('un producto aprobado SIN slug es rechazado por la base', () => {
  // El volcado tambien lanza en este caso, pero un UPDATE mal hecho desde el
  // admin no deberia poder dejar la fila en un estado imposible.
  const db = base();
  assert.throws(() => insertarProducto(db, { estado: 'aprobado', slug: null }), /CHECK|constraint/i);
});

test('publicado y eliminado sin slug tambien son rechazados', () => {
  for (const estado of ['publicado', 'eliminado']) {
    const db = base();
    assert.throws(() => insertarProducto(db, { estado, slug: null }), /CHECK|constraint/i);
  }
});

test('aprobar es pasar estado y slug en la misma sentencia', () => {
  // Confirma que el CHECK no impide la transicion real del admin.
  const db = base();
  const id = insertarProducto(db, { estado: 'importado', slug: null });
  assert.doesNotThrow(() =>
    db.prepare(`UPDATE productos SET estado='aprobado', slug=? WHERE id=?`).run('mi-slug', id)
  );
});

test('un estado inventado es rechazado', () => {
  const db = base();
  assert.throws(() => insertarProducto(db, { estado: 'borrador' }), /CHECK|constraint/i);
});

// --------------------------------------------------------------------------
// Identidad: el codigo es la clave de negocio (SPEC-etapa2 §5.3)
// --------------------------------------------------------------------------

test('el codigo es unico: reemplaza al manifest.json de SPEC §6.7', () => {
  // La idempotencia del scrape sale de esta restriccion. Sin ella habria que
  // mantener un archivo de estado que se puede desincronizar.
  const db = base();
  insertarProducto(db);
  assert.throws(() => insertarProducto(db, { slug: 'otro-slug' }), /UNIQUE|constraint/i);
});

test('el slug es unico entre productos publicables', () => {
  const db = base();
  insertarProducto(db);
  assert.throws(() => insertarProducto(db, { codigo: 'CG99999' }), /UNIQUE|constraint/i);
});

test('varios productos importados pueden tener slug NULL a la vez', () => {
  // SQLite permite multiples NULL en una columna UNIQUE. De eso depende que la
  // cola de importados pueda tener cientos de filas sin slug.
  const db = base();
  insertarProducto(db, { codigo: 'A1', slug: null, estado: 'importado' });
  insertarProducto(db, { codigo: 'A2', slug: null, estado: 'importado' });
  const n = db.prepare(`SELECT COUNT(*) c FROM productos WHERE slug IS NULL`).get().c;
  assert.equal(n, 2);
});

// --------------------------------------------------------------------------
// Variantes e imagenes
// --------------------------------------------------------------------------

test('el sku es unico', () => {
  const db = base();
  const id = insertarProducto(db);
  const ins = db.prepare(`INSERT INTO variantes (producto_id, sku, color) VALUES (?, ?, ?)`);
  ins.run(id, 'CG85527-P', 'Rosado');
  assert.throws(() => ins.run(id, 'CG85527-P', 'Negro'), /UNIQUE|constraint/i);
});

test('una variante con producto inexistente es rechazada por la foreign key', () => {
  const db = base();
  assert.throws(
    () => db.prepare(`INSERT INTO variantes (producto_id, sku, color) VALUES (?, ?, ?)`).run(404, 'X-1', 'Gris'),
    /FOREIGN KEY|constraint/i
  );
});

test('borrar un producto arrastra sus variantes y categorias', () => {
  // Es el borrado FISICO de un producto que nunca fue publico (§12.2).
  const db = base();
  const id = insertarProducto(db, { estado: 'importado', slug: null });
  db.prepare(`INSERT INTO variantes (producto_id, sku, color) VALUES (?, ?, ?)`).run(id, 'X-1', 'Gris');
  db.prepare(`INSERT INTO producto_categorias (producto_id, categoria_slug) VALUES (?, ?)`).run(id, 'carteras');

  db.prepare(`DELETE FROM productos WHERE id=?`).run(id);

  assert.equal(db.prepare(`SELECT COUNT(*) c FROM variantes`).get().c, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM producto_categorias`).get().c, 0);
});

test('el hash16 de una imagen es unico: es el dedupe de SPEC §6.8', () => {
  const db = base();
  const ins = db.prepare(
    `INSERT INTO imagenes (hash16, anchos, ancho_origen, alto_origen, bytes_origen, creado_en)
     VALUES (?, ?, 600, 600, 118000, ?)`
  );
  ins.run('9dadecbc3b4c69f4', '[300,600]', AHORA);
  assert.throws(() => ins.run('9dadecbc3b4c69f4', '[300]', AHORA), /UNIQUE|constraint/i);
});

test('una imagen puede pertenecer a variantes de productos distintos', () => {
  // Los proveedores repiten la misma foto entre SKU: el dedupe solo sirve si el
  // modelo admite compartirla (SPEC §6.8).
  const db = base();
  const p1 = insertarProducto(db, { codigo: 'A1', slug: 's1' });
  const p2 = insertarProducto(db, { codigo: 'A2', slug: 's2' });
  const v1 = db.prepare(`INSERT INTO variantes (producto_id, sku, color) VALUES (?, ?, ?) RETURNING id`).get(p1, 'A1-1', 'Gris').id;
  const v2 = db.prepare(`INSERT INTO variantes (producto_id, sku, color) VALUES (?, ?, ?) RETURNING id`).get(p2, 'A2-1', 'Gris').id;
  const img = db
    .prepare(
      `INSERT INTO imagenes (hash16, anchos, ancho_origen, alto_origen, bytes_origen, creado_en)
       VALUES (?, ?, 600, 600, 1, ?) RETURNING id`
    )
    .get('aaaaaaaaaaaaaaaa', '[300,600]', AHORA).id;

  const rel = db.prepare(`INSERT INTO variante_imagenes (variante_id, imagen_id) VALUES (?, ?)`);
  rel.run(v1, img);
  rel.run(v2, img);

  assert.equal(db.prepare(`SELECT COUNT(*) c FROM variante_imagenes WHERE imagen_id=?`).get(img).c, 2);
});

test('la misma imagen no se puede asociar dos veces a la misma variante', () => {
  const db = base();
  const p = insertarProducto(db);
  const v = db.prepare(`INSERT INTO variantes (producto_id, sku, color) VALUES (?, ?, ?) RETURNING id`).get(p, 'X-1', 'Gris').id;
  const img = db
    .prepare(
      `INSERT INTO imagenes (hash16, anchos, ancho_origen, alto_origen, bytes_origen, creado_en)
       VALUES (?, ?, 600, 600, 1, ?) RETURNING id`
    )
    .get('aaaaaaaaaaaaaaaa', '[300]', AHORA).id;

  const rel = db.prepare(`INSERT INTO variante_imagenes (variante_id, imagen_id) VALUES (?, ?)`);
  rel.run(v, img);
  assert.throws(() => rel.run(v, img), /UNIQUE|PRIMARY|constraint/i);
});

test('un producto no puede repetir la misma categoria', () => {
  const db = base();
  const p = insertarProducto(db);
  const ins = db.prepare(`INSERT INTO producto_categorias (producto_id, categoria_slug) VALUES (?, ?)`);
  ins.run(p, 'carteras');
  assert.throws(() => ins.run(p, 'carteras'), /UNIQUE|PRIMARY|constraint/i);
});

// --------------------------------------------------------------------------
// Publicaciones (§11.3)
// --------------------------------------------------------------------------

test('el estado de una publicacion esta acotado', () => {
  const db = base();
  const ins = db.prepare(
    `INSERT INTO publicaciones (estado, disparada_por, disparada_en) VALUES (?, ?, ?)`
  );
  for (const estado of ['pendiente', 'corriendo', 'ok', 'error']) {
    assert.doesNotThrow(() => ins.run(estado, 'alguien@ejemplo.com', AHORA));
  }
  assert.throws(() => ins.run('quizas', 'alguien@ejemplo.com', AHORA), /CHECK|constraint/i);
});
