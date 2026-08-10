import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { Ejecutar } from '../grilla.ts';
import { codigosExistentes, nombreDeColor, registrarFicha, vincularImagen } from './registrar.ts';

/**
 * Los tests corren contra el ESQUEMA REAL con `node:sqlite`, que es el mismo motor
 * que D1. Un UPDATE que pise curaduría se ve acá y no en producción.
 */
const MIGRACIONES = [
  '0001_esquema_inicial.sql',
  '0002_codigo_insensible_a_mayusculas.sql',
  '0003_aviso_cambio_en_origen.sql',
  '0004_papelera.sql',
].map((n) => readFileSync(new URL(`../../../../db/migrations/${n}`, import.meta.url), 'utf8'));

const AHORA = '2026-08-06T15:00:00Z';
const DESPUES = '2026-08-07T09:00:00Z';

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

/**
 * `node:sqlite` devuelve filas SIN prototipo, y `deepEqual` estricto distingue eso de
 * un objeto literal. Aplanar es más honesto que aflojar la comparación.
 */
const plano = <T>(fila: T): T => ({ ...fila });

/** CG85700 real: (3) NEGRO es el color propio, los otros dos son hermanos. */
const CG85700 = {
  codigo: 'CG85700',
  urlOrigen: 'https://www.chenson.com.py/producto/71163-cg85700',
  colores: [
    { colorOrigen: '(3) NEGRO', url: 'https://www.chenson.com.py/producto/71163-cg85700' },
    { colorOrigen: '(T) MARRON CLARO', url: 'https://www.chenson.com.py/producto/71301-cg85700' },
    { colorOrigen: '(B) MARRON', url: 'https://www.chenson.com.py/producto/71350-cg85700' },
  ],
};

const opciones = { scrapeId: null, ahora: AHORA };

// --- El alta ---

test('un modelo nuevo entra con sus tres variantes y los SKU del proveedor', () => {
  const db = base();
  return registrarFicha(ejecutor(db), CG85700, opciones).then((r) => {
    assert.equal(r.creado, true);
    assert.deepEqual(r.variantesNuevas.sort(), ['CG85700-3', 'CG85700-B', 'CG85700-T']);

    const vs = db.prepare('SELECT sku, color, color_origen, orden FROM variantes ORDER BY orden').all().map(plano);
    assert.deepEqual(vs, [
      { sku: 'CG85700-B', color: 'Marron', color_origen: '(B) MARRON', orden: 0 },
      { sku: 'CG85700-T', color: 'Marron Claro', color_origen: '(T) MARRON CLARO', orden: 1 },
      { sku: 'CG85700-3', color: 'Negro', color_origen: '(3) NEGRO', orden: 2 },
    ]);
  });
});

test('un modelo nuevo nace en importado y sin curaduría', () => {
  const db = base();
  return registrarFicha(ejecutor(db), CG85700, opciones).then(() => {
    const p = db.prepare('SELECT * FROM productos').get() as Record<string, unknown>;
    assert.equal(p.estado, 'importado');
    assert.equal(p.proveedor, 'chenson');
    assert.equal(p.nombre, null);
    assert.equal(p.precio, null);
    assert.equal(p.slug, null);
    assert.equal(p.url_origen, CG85700.urlOrigen);
  });
});

// --- La idempotencia y la curaduría: el corazón de §7.5 ---

test('correrlo dos veces no duplica nada', async () => {
  const db = base();
  const e = ejecutor(db);
  await registrarFicha(e, CG85700, opciones);
  const segunda = await registrarFicha(e, CG85700, { scrapeId: null, ahora: DESPUES });

  assert.equal(segunda.creado, false);
  assert.deepEqual(segunda.variantesNuevas, []);
  assert.equal((db.prepare('SELECT count(*) c FROM productos').get() as { c: number }).c, 1);
  assert.equal((db.prepare('SELECT count(*) c FROM variantes').get() as { c: number }).c, 3);
});

test('NO pisa el nombre, el precio ni el estado escritos a mano', async () => {
  /**
   * El test que justifica todo el modulo. Una persona curo el producto; el scrape
   * vuelve a pasar y NO puede revertir ni una de esas decisiones.
   */
  const db = base();
  const e = ejecutor(db);
  await registrarFicha(e, CG85700, opciones);

  db.prepare(
    `UPDATE productos SET nombre = ?, descripcion = ?, precio = ?, destacado = 1,
            slug = ?, estado = 'publicado' WHERE codigo = 'CG85700'`
  ).run('Mochila urbana', 'Con bolsillo para notebook', 450000, 'mochila-urbana');

  await registrarFicha(e, CG85700, { scrapeId: null, ahora: DESPUES });

  const p = db.prepare('SELECT * FROM productos').get() as Record<string, unknown>;
  assert.equal(p.nombre, 'Mochila urbana');
  assert.equal(p.descripcion, 'Con bolsillo para notebook');
  assert.equal(p.precio, 450000);
  assert.equal(p.destacado, 1);
  assert.equal(p.slug, 'mochila-urbana');
  assert.equal(p.estado, 'publicado');
});

test('tampoco pisa el color_hex cargado a mano', async () => {
  const db = base();
  const e = ejecutor(db);
  await registrarFicha(e, CG85700, opciones);
  db.prepare(`UPDATE variantes SET color_hex = '#1a1a1a' WHERE sku = 'CG85700-3'`).run();

  await registrarFicha(e, CG85700, { scrapeId: null, ahora: DESPUES });

  const v = plano(db.prepare(`SELECT color_hex FROM variantes WHERE sku = 'CG85700-3'`).get());
  assert.deepEqual(v, { color_hex: '#1a1a1a' });
});

test('un código en minúsculas encuentra el producto que ya existe', async () => {
  // `UNIQUE` en SQLite distingue mayusculas: sin el `upper()` entrarian dos filas.
  const db = base();
  const e = ejecutor(db);
  await registrarFicha(e, CG85700, opciones);
  const r = await registrarFicha(e, { ...CG85700, codigo: 'cg85700' }, opciones);

  assert.equal(r.creado, false);
  assert.equal((db.prepare('SELECT count(*) c FROM productos').get() as { c: number }).c, 1);
});

// --- Un color nuevo del proveedor ---

test('un color nuevo se agrega al final y avisa que hay que revisar', async () => {
  const db = base();
  const e = ejecutor(db);
  await registrarFicha(e, CG85700, opciones);
  db.prepare(`UPDATE productos SET estado = 'publicado', slug = 'x', nombre = 'X'`).run();

  const r = await registrarFicha(
    e,
    { ...CG85700, colores: [...CG85700.colores, { colorOrigen: '(9) AZUL', url: 'u' }] },
    { scrapeId: null, ahora: DESPUES }
  );

  assert.deepEqual(r.variantesNuevas, ['CG85700-9']);
  assert.equal(r.avisoDeCambio, true);

  // Al final: el orden de las que ya estaban es curaduria y no se toca.
  const vs = db.prepare('SELECT sku, orden FROM variantes ORDER BY orden').all().map(plano);
  assert.deepEqual(vs.at(-1), { sku: 'CG85700-9', orden: 3 });

  const p = plano(db.prepare('SELECT cambio_en_origen FROM productos').get());
  assert.deepEqual(p, { cambio_en_origen: DESPUES });
});

test('sobre un producto todavía sin curar no hay aviso', async () => {
  // Todo es nuevo por definicion: avisar de cada color seria ruido.
  const db = base();
  const e = ejecutor(db);
  await registrarFicha(e, CG85700, opciones);

  const r = await registrarFicha(
    e,
    { ...CG85700, colores: [...CG85700.colores, { colorOrigen: '(9) AZUL', url: 'u' }] },
    { scrapeId: null, ahora: DESPUES }
  );

  assert.equal(r.avisoDeCambio, false);
  assert.equal((db.prepare('SELECT cambio_en_origen FROM productos').get() as { cambio_en_origen: unknown }).cambio_en_origen, null);
});

// --- Bordes ---

test('un color sin nombre se cuenta y no rompe la ficha', async () => {
  const db = base();
  const r = await registrarFicha(
    ejecutor(db),
    { ...CG85700, colores: [CG85700.colores[0], { colorOrigen: null, url: 'u' }] },
    opciones
  );
  assert.equal(r.coloresSinNombre, 1);
  assert.deepEqual(r.variantesNuevas, ['CG85700-3']);
});

test('una ficha sin ningún color no se guarda a medias', async () => {
  const db = base();
  await assert.rejects(
    registrarFicha(ejecutor(db), { ...CG85700, colores: [] }, opciones),
    /color/i
  );
  assert.equal((db.prepare('SELECT count(*) c FROM productos').get() as { c: number }).c, 0);
});

// --- El vínculo de imágenes ---

/** Registra CG85700 y deja una imagen subida, lista para vincular. */
async function conImagen(db: DatabaseSync, hash = 'aaaaaaaaaaaaaaaa') {
  const e = ejecutor(db);
  await registrarFicha(e, CG85700, opciones);
  db.prepare(
    `INSERT INTO imagenes (hash16, anchos, ancho_origen, alto_origen, bytes_origen, creado_en)
     VALUES (?, '[300,600]', 600, 600, 1000, ?)`
  ).run(hash, AHORA);
  return e;
}

test('vincular una imagen la asocia a la variante', async () => {
  const db = base();
  const e = await conImagen(db);
  assert.deepEqual(await vincularImagen(e, { sku: 'CG85700-3', hash16: 'aaaaaaaaaaaaaaaa' }), {
    vinculada: true,
  });
  assert.equal((db.prepare('SELECT count(*) c FROM variante_imagenes').get() as { c: number }).c, 1);
});

test('vincular dos veces lo mismo no duplica', async () => {
  // Es lo que permite repetir una corrida interrumpida sin pensar en que llego a entrar.
  const db = base();
  const e = await conImagen(db);
  await vincularImagen(e, { sku: 'CG85700-3', hash16: 'aaaaaaaaaaaaaaaa' });
  assert.deepEqual(await vincularImagen(e, { sku: 'CG85700-3', hash16: 'aaaaaaaaaaaaaaaa' }), {
    vinculada: false,
  });
  assert.equal((db.prepare('SELECT count(*) c FROM variante_imagenes').get() as { c: number }).c, 1);
});

test('las imágenes se ordenan por llegada', async () => {
  const db = base();
  const e = await conImagen(db);
  db.prepare(
    `INSERT INTO imagenes (hash16, anchos, ancho_origen, alto_origen, bytes_origen, creado_en)
     VALUES ('bbbbbbbbbbbbbbbb', '[300]', 300, 300, 500, ?)`
  ).run(AHORA);

  await vincularImagen(e, { sku: 'CG85700-3', hash16: 'aaaaaaaaaaaaaaaa' });
  await vincularImagen(e, { sku: 'CG85700-3', hash16: 'bbbbbbbbbbbbbbbb' });

  const filas = db
    .prepare(
      `SELECT i.hash16, vi.orden FROM variante_imagenes vi
         JOIN imagenes i ON i.id = vi.imagen_id ORDER BY vi.orden`
    )
    .all()
    .map(plano);
  assert.deepEqual(filas, [
    { hash16: 'aaaaaaaaaaaaaaaa', orden: 0 },
    { hash16: 'bbbbbbbbbbbbbbbb', orden: 1 },
  ]);
});

test('no se vincula una imagen que no está subida', async () => {
  // El vinculo apuntaria a nada y el catalogo mostraria un <img> roto.
  const db = base();
  const e = await conImagen(db);
  await assert.rejects(
    vincularImagen(e, { sku: 'CG85700-3', hash16: 'cccccccccccccccc' }),
    /no está subida/i
  );
});

test('no se vincula a una variante inexistente', async () => {
  const db = base();
  const e = await conImagen(db);
  await assert.rejects(vincularImagen(e, { sku: 'CG99999-9', hash16: 'aaaaaaaaaaaaaaaa' }), /variante/i);
});

test('nombreDeColor deja los acentos y las palabras cortas bien', () => {
  assert.equal(nombreDeColor('MARRON CLARO'), 'Marron Claro');
  assert.equal(nombreDeColor('VERDE MILITAR'), 'Verde Militar');
  assert.equal(nombreDeColor('AZUL-GRIS'), 'Azul-Gris');
});

// --------------------------------------------------------------------------
// Cuáles de estos códigos ya están en el catálogo (§7.5, opción de saltear)
// --------------------------------------------------------------------------

test('codigosExistentes: devuelve sólo los que ya están', async () => {
  const db = base();
  const e = ejecutor(db);
  await registrarFicha(e, CG85700, opciones);

  const hay = await codigosExistentes(e, ['CG85700', 'CG99999']);

  assert.deepEqual(hay, ['CG85700']);
});

test('codigosExistentes: compara sin distinguir mayúsculas', async () => {
  /**
   * Misma regla que el UNIQUE de §5.3: la collation por defecto es BINARY, asi que
   * `cg85700` y `CG85700` serian dos codigos distintos para un `IN (…)` pelado — y el
   * salteo dejaria pasar un producto que si tenemos.
   */
  const db = base();
  const e = ejecutor(db);
  await registrarFicha(e, CG85700, opciones);

  assert.deepEqual(await codigosExistentes(e, ['cg85700']), ['CG85700']);
});

test('codigosExistentes: cuenta también lo que está en la papelera', async () => {
  /**
   * Un producto eliminado SIGUE existiendo: su codigo esta tomado y su URL vive. Si el
   * salteo no lo contara, la importacion lo volveria a traer y `registrarFicha` haria
   * UPDATE sobre una fila `eliminado`, resucitando datos que alguien saco a proposito.
   */
  const db = base();
  const e = ejecutor(db);
  await registrarFicha(e, CG85700, opciones);
  // Con slug: el CHECK de §5.2 no deja que nada pase de `importado` sin el suyo, y un
  // eliminado siempre estuvo publicado antes.
  db.prepare(
    `UPDATE productos SET estado = 'eliminado', slug = 'cg85700' WHERE codigo = 'CG85700'`
  ).run();

  assert.deepEqual(await codigosExistentes(e, ['CG85700']), ['CG85700']);
});

test('codigosExistentes: sin códigos no consulta y devuelve vacío', async () => {
  assert.deepEqual(await codigosExistentes(ejecutor(base()), []), []);
});

test('codigosExistentes: un catálogo vacío no saltea nada', async () => {
  assert.deepEqual(await codigosExistentes(ejecutor(base()), ['CG85700', 'CG1']), []);
});

// --------------------------------------------------------------------------
// Reimportar algo que esta en la papelera (§7.5 x §12.2)
// --------------------------------------------------------------------------

test('un producto ELIMINADO reimportado NO vuelve al catalogo', async () => {
  /**
   * El cruce de dos reglas que se escribieron por separado, y el de peor consecuencia
   * si fallara: alguien saco un producto del catalogo a proposito, el proveedor lo
   * sigue listando, y la proxima importacion lo trae de nuevo. Si el scrape tocara
   * `estado`, el producto REAPARECERIA en el sitio sin que nadie lo decidiera.
   *
   * No pasa porque el UPDATE de `registrarFicha` no nombra `estado` — pero eso es una
   * propiedad del codigo, y una propiedad sin test es una propiedad hasta que alguien
   * agrega una columna al UPDATE sin pensarlo.
   */
  const db = base();
  const e = ejecutor(db);
  await registrarFicha(e, CG85700, opciones);

  db.prepare(
    `UPDATE productos SET nombre = ?, slug = ?, estado = 'eliminado',
            eliminado_en = ?, eliminado_por = ? WHERE codigo = 'CG85700'`
  ).run('Mochila urbana', 'mochila-urbana', AHORA, 'ana@ybe.com.py');

  await registrarFicha(e, CG85700, { scrapeId: null, ahora: DESPUES });

  const p = db.prepare('SELECT * FROM productos').get() as Record<string, unknown>;
  assert.equal(p.estado, 'eliminado', 'sigue en la papelera');
  assert.equal(p.nombre, 'Mochila urbana', 'conserva el nombre que le pusieron');
});

test('el slug de un eliminado sobrevive a la reimportacion', async () => {
  // Es lo que permite restaurarlo con la MISMA URL. Si el scrape lo liberara o lo
  // recalculara, restaurar daria una direccion nueva y la vieja quedaria muerta.
  const db = base();
  const e = ejecutor(db);
  await registrarFicha(e, CG85700, opciones);
  db.prepare(
    `UPDATE productos SET slug = 'mochila-urbana', estado = 'eliminado' WHERE codigo = 'CG85700'`
  ).run();

  await registrarFicha(e, CG85700, { scrapeId: null, ahora: DESPUES });

  const p = db.prepare('SELECT slug FROM productos').get() as { slug: string };
  assert.equal(p.slug, 'mochila-urbana');
});

test('la marca de quien lo elimino y cuando NO se borra al reimportar', async () => {
  // La papelera muestra «fecha, quien lo hizo» (§10.5). Que una importacion las
  // limpiara dejaria un producto en la papelera sin saber quien lo saco.
  const db = base();
  const e = ejecutor(db);
  await registrarFicha(e, CG85700, opciones);
  db.prepare(
    `UPDATE productos SET slug = 'x', estado = 'eliminado', eliminado_en = ?,
            eliminado_por = ? WHERE codigo = 'CG85700'`
  ).run(AHORA, 'ana@ybe.com.py');

  await registrarFicha(e, CG85700, { scrapeId: null, ahora: DESPUES });

  const p = db.prepare('SELECT eliminado_en, eliminado_por FROM productos').get() as {
    eliminado_en: string;
    eliminado_por: string;
  };
  assert.equal(p.eliminado_en, AHORA);
  assert.equal(p.eliminado_por, 'ana@ybe.com.py');
});

test('un color nuevo entra como variante aunque el producto este eliminado', async () => {
  /**
   * La estructura SI se actualiza: el scrape aporta estructura y las personas aportan
   * decisiones. El color queda registrado y marcado con el aviso, listo para cuando
   * alguien restaure el producto — pero el producto sigue fuera del catalogo.
   */
  const db = base();
  const e = ejecutor(db);
  await registrarFicha(e, CG85700, opciones);
  db.prepare(
    `UPDATE productos SET slug = 'x', estado = 'eliminado' WHERE codigo = 'CG85700'`
  ).run();

  const r = await registrarFicha(
    e,
    {
      ...CG85700,
      colores: [
        ...CG85700.colores,
        { colorOrigen: '(9) AZUL', url: 'https://www.chenson.com.py/producto/99999-cg85700' },
      ],
    },
    { scrapeId: null, ahora: DESPUES }
  );

  assert.deepEqual(r.variantesNuevas, ['CG85700-9']);
  assert.equal(r.avisoDeCambio, true, 'queda marcado para que alguien lo mire');
  const p = db.prepare('SELECT estado FROM productos').get() as { estado: string };
  assert.equal(p.estado, 'eliminado', 'y sigue afuera del catalogo');
});
