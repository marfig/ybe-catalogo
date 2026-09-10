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

test('aplicar la cadena deja las 10 tablas del esquema acumulado', () => {
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
    'videos',
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

// --------------------------------------------------------------------------
// 0007 — un video opcional por producto
// --------------------------------------------------------------------------

function insertarVideo(db, campos = {}) {
  const v = {
    hash16: 'bbbbbbbbbbbbbbbb',
    ancho: 720,
    alto: 1280,
    bytes: 3_000_000,
    ...campos,
  };
  return db
    .prepare(
      `INSERT INTO videos (hash16, ancho, alto, bytes, creado_en)
       VALUES (?, ?, ?, ?, ?) RETURNING id`
    )
    .get(v.hash16, v.ancho, v.alto, v.bytes, AHORA).id;
}

function insertarProducto(db, campos = {}) {
  const p = { codigo: 'CG85527', slug: 'cartera-de-fiesta', video_id: null, ...campos };
  return db
    .prepare(
      `INSERT INTO productos (codigo, proveedor, slug, nombre, estado, video_id, creado_en, actualizado_en)
       VALUES (?, 'chenson', ?, 'Cartera', 'publicado', ?, ?, ?) RETURNING id`
    )
    .get(p.codigo, p.slug, p.video_id, AHORA, AHORA).id;
}

test('0007: el hash16 de un video es unico, igual que el de una imagen', () => {
  // Es el dedupe: el mismo archivo subido dos veces es una sola fila y un solo
  // objeto en R2. Sin esta restriccion el segundo `put` pisa al primero y la
  // fila vieja queda apuntando a un objeto que ya no es el suyo.
  const db = aplicar();
  insertarVideo(db);
  assert.throws(() => insertarVideo(db, { ancho: 1080 }), /UNIQUE|constraint/i);
});

test('0007: ancho, alto y bytes son obligatorios', () => {
  // ancho/alto no son anti-upscaling como en `imagenes` —no hay derivadas—:
  // sostienen el aspect-ratio del <video> para que la ficha no salte al cargar.
  const db = aplicar();
  for (const campo of ['ancho', 'alto', 'bytes']) {
    assert.throws(() => insertarVideo(db, { [campo]: null }), /NOT NULL|constraint/i, campo);
  }
});

test('0007: un producto nace sin video', () => {
  // La columna es opcional y no hay backfill: el catalogo entero sigue igual
  // despues de la migracion.
  const db = aplicar();
  const id = insertarProducto(db);
  assert.equal(db.prepare(`SELECT video_id FROM productos WHERE id=?`).get(id).video_id, null);
});

test('0007: un producto no puede apuntar a un video inexistente', () => {
  const db = aplicar();
  assert.throws(() => insertarProducto(db, { video_id: 404 }), /FOREIGN KEY|constraint/i);
});

test('0007: borrar un video en uso falla, no deja la ficha sin video en silencio', () => {
  // Mismo criterio que `pedidos_especiales.imagen_id`: sin ON DELETE CASCADE ni
  // SET NULL. Quitar el video de un producto es un UPDATE explicito del admin;
  // recien despues la fila queda huerfana y la papelera puede llevarse el
  // objeto de R2.
  const db = aplicar();
  const video = insertarVideo(db);
  insertarProducto(db, { video_id: video });
  assert.throws(() => db.prepare(`DELETE FROM videos WHERE id=?`).run(video), /FOREIGN KEY|constraint/i);
});

test('0007: borrar el producto NO borra el video', () => {
  // A proposito: la fila sobrevive como huerfana. El objeto de R2 pesa 10 MB y
  // tiene que salir por la recoleccion de huerfanas, que es donde se borran los
  // dos —fila y objeto— juntos. Un CASCADE aca haria desaparecer la fila y
  // dejaria el objeto en R2 para siempre, invisible.
  const db = aplicar();
  const video = insertarVideo(db);
  const producto = insertarProducto(db, { video_id: video });

  db.prepare(`DELETE FROM productos WHERE id=?`).run(producto);

  assert.equal(db.prepare(`SELECT COUNT(*) c FROM videos`).get().c, 1);
});

test('0007: dos productos pueden compartir el mismo video', () => {
  // Consecuencia del dedupe por hash16, igual que `variante_imagenes` con las
  // fotos repetidas del proveedor. `video_id` NO es UNIQUE.
  const db = aplicar();
  const video = insertarVideo(db);
  insertarProducto(db, { codigo: 'A1', slug: 's1', video_id: video });
  insertarProducto(db, { codigo: 'A2', slug: 's2', video_id: video });
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM productos WHERE video_id=?`).get(video).c, 2);
});

test('0007: el indice de video es parcial', () => {
  // Misma convencion que 0003 y 0005: los productos con video van a ser una
  // minoria, y el indice solo tiene que conocer a esos.
  const db = aplicar();
  const sql = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_productos_video'`)
    .get();
  assert.ok(sql, 'falta el indice idx_productos_video');
  assert.match(sql.sql, /WHERE\s+video_id\s+IS\s+NOT\s+NULL/i);
});

// --------------------------------------------------------------------------
// 0008 — los colores con mas fotos primero
// --------------------------------------------------------------------------

let sembradas = 0;

/**
 * Una variante con `fotos` imagenes colgadas. Devuelve su id.
 *
 * Cada foto es una fila propia de `imagenes` porque `hash16` es UNIQUE: reusar una
 * sola no dejaria armar conteos distintos entre variantes, que es lo unico que este
 * bloque necesita construir.
 */
function sembrarVariante(db, { productoId, sku, color, orden, fotos = 0 }) {
  const { id } = db
    .prepare(
      `INSERT INTO variantes (producto_id, sku, color, orden)
       VALUES (?, ?, ?, ?) RETURNING id`
    )
    .get(productoId, sku, color, orden);

  for (let i = 0; i < fotos; i++) {
    const imagenId = insertarImagen(db, String(++sembradas).padStart(16, '0'));
    db.prepare(
      `INSERT INTO variante_imagenes (variante_id, imagen_id, orden) VALUES (?, ?, ?)`
    ).run(id, imagenId, i);
  }
  return id;
}

/** Los SKU del producto, en el `orden` en que quedaron. */
function ordenDe(db, codigo) {
  return db
    .prepare(
      `SELECT v.sku, v.orden
         FROM variantes v JOIN productos p ON p.id = v.producto_id
        WHERE p.codigo = ? ORDER BY v.orden`
    )
    .all(codigo)
    .map((f) => f.sku);
}

test('0008: dentro de un producto, el color con mas fotos queda primero', () => {
  // Es el unico caso de esta carpeta —junto al backfill de 0005— donde el ORDEN de
  // aplicacion cambia el resultado: la migracion reescribe filas que ya estaban.
  const db = aplicar(7); // hasta 0007, o sea con el catalogo cargado y sin reordenar
  const producto = insertarProducto(db, { codigo: 'CG85700', slug: 'cartera' });

  // Alfabetico, que es como los deja el alta de `registrarFicha`.
  sembrarVariante(db, { productoId: producto, sku: 'CG85700-A', color: 'Azul', orden: 0, fotos: 1 });
  sembrarVariante(db, { productoId: producto, sku: 'CG85700-B', color: 'Blanco', orden: 1, fotos: 3 });
  sembrarVariante(db, { productoId: producto, sku: 'CG85700-C', color: 'Celeste', orden: 2, fotos: 2 });

  db.exec(readFileSync(`${DIRECTORIO}/${MIGRACIONES[7]}`, 'utf8'));

  assert.deepEqual(ordenDe(db, 'CG85700'), ['CG85700-B', 'CG85700-C', 'CG85700-A']);
});

test('0008: con las mismas fotos se conserva el orden que ya tenian', () => {
  // EL EMPATE ES EL CASO QUE DECIDE SI LA MIGRACION ES DETERMINISTA. Sin el
  // desempate por el `orden` actual, dos variantes con la misma cantidad de fotos
  // quedarian en el orden que se le antoje al planificador, y una reimportacion del
  // mismo catalogo daria un color principal distinto cada vez.
  const db = aplicar(7);
  const producto = insertarProducto(db, { codigo: 'CG85527', slug: 'mochila' });

  sembrarVariante(db, { productoId: producto, sku: 'CG85527-A', color: 'Azul', orden: 0, fotos: 1 });
  sembrarVariante(db, { productoId: producto, sku: 'CG85527-B', color: 'Blanco', orden: 1, fotos: 2 });
  sembrarVariante(db, { productoId: producto, sku: 'CG85527-C', color: 'Celeste', orden: 2, fotos: 1 });
  sembrarVariante(db, { productoId: producto, sku: 'CG85527-D', color: 'Dorado', orden: 3, fotos: 2 });

  db.exec(readFileSync(`${DIRECTORIO}/${MIGRACIONES[7]}`, 'utf8'));

  // Blanco y Dorado empatan en 2 y siguen en ese orden; Azul y Celeste, en 1.
  assert.deepEqual(ordenDe(db, 'CG85527'), [
    'CG85527-B',
    'CG85527-D',
    'CG85527-A',
    'CG85527-C',
  ]);
});

test('0008: una variante sin fotos queda ultima, no se saltea', () => {
  // El conteo tiene que ser 0 y no NULL: un color sin ninguna foto existe igual en la
  // ficha —el catalogo le dibuja el placeholder de §5.4— y necesita su lugar en la
  // secuencia. Un INNER JOIN contra `variante_imagenes` lo dejaria sin `orden` nuevo.
  const db = aplicar(7);
  const producto = insertarProducto(db, { codigo: 'CG86003', slug: 'billetera' });

  sembrarVariante(db, { productoId: producto, sku: 'CG86003-A', color: 'Azul', orden: 0, fotos: 0 });
  sembrarVariante(db, { productoId: producto, sku: 'CG86003-B', color: 'Blanco', orden: 1, fotos: 1 });

  db.exec(readFileSync(`${DIRECTORIO}/${MIGRACIONES[7]}`, 'utf8'));

  assert.deepEqual(ordenDe(db, 'CG86003'), ['CG86003-B', 'CG86003-A']);
});

test('0008: cada producto arranca su propia secuencia en 0', () => {
  // `PARTITION BY producto_id`. Sin la particion la numeracion seria global y el
  // `orden` de un producto dependeria de cuantas variantes tiene el catalogo entero.
  const db = aplicar(7);
  const uno = insertarProducto(db, { codigo: 'CG1', slug: 'uno' });
  const dos = insertarProducto(db, { codigo: 'CG2', slug: 'dos' });

  sembrarVariante(db, { productoId: uno, sku: 'CG1-A', color: 'Azul', orden: 0, fotos: 1 });
  sembrarVariante(db, { productoId: uno, sku: 'CG1-B', color: 'Blanco', orden: 1, fotos: 4 });
  sembrarVariante(db, { productoId: dos, sku: 'CG2-A', color: 'Azul', orden: 0, fotos: 2 });
  sembrarVariante(db, { productoId: dos, sku: 'CG2-B', color: 'Blanco', orden: 1, fotos: 5 });

  db.exec(readFileSync(`${DIRECTORIO}/${MIGRACIONES[7]}`, 'utf8'));

  const filas = db
    .prepare(
      `SELECT p.codigo, v.sku, v.orden
         FROM variantes v JOIN productos p ON p.id = v.producto_id
        ORDER BY p.codigo, v.orden`
    )
    .all()
    .map((f) => ({ ...f }));

  assert.deepEqual(filas, [
    { codigo: 'CG1', sku: 'CG1-B', orden: 0 },
    { codigo: 'CG1', sku: 'CG1-A', orden: 1 },
    { codigo: 'CG2', sku: 'CG2-B', orden: 0 },
    { codigo: 'CG2', sku: 'CG2-A', orden: 1 },
  ]);
});

test('0008: la secuencia queda densa desde 0, sin huecos heredados', () => {
  // El catalogo real trae `orden` con saltos: los colores nuevos entran con
  // `max(orden)+1` y el reordenamiento a mano del admin deja huecos. La migracion
  // renumera de cero para que `variantes.orden` vuelva a ser una posicion y no un
  // historial.
  const db = aplicar(7);
  const producto = insertarProducto(db, { codigo: 'CG9', slug: 'nueve' });

  sembrarVariante(db, { productoId: producto, sku: 'CG9-A', color: 'Azul', orden: 7, fotos: 2 });
  sembrarVariante(db, { productoId: producto, sku: 'CG9-B', color: 'Blanco', orden: 40, fotos: 9 });

  db.exec(readFileSync(`${DIRECTORIO}/${MIGRACIONES[7]}`, 'utf8'));

  assert.deepEqual(
    db.prepare(`SELECT sku, orden FROM variantes ORDER BY orden`).all().map((f) => ({ ...f })),
    [
      { sku: 'CG9-B', orden: 0 },
      { sku: 'CG9-A', orden: 1 },
    ]
  );
});
