import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { repartirColores } from '../repartir.mjs';

/**
 * Tests del reparto en colores de los productos que la migracion dejo con uno solo.
 *
 * ES UNA OPERACION DE UNA SOLA VEZ Y SOBRE PRODUCCION, asi que lo que mas se prueba no
 * es el camino feliz: es que NO haga de mas. Que no toque las filas de `imagenes` —los
 * objetos de R2 cuelgan de ellas—, que no se lleve una foto de otro producto, y que
 * valide todo ANTES de escribir la primera fila.
 */

const CARPETA = new URL('../../../db/migrations/', import.meta.url);
const MIGRACIONES = readdirSync(CARPETA)
  .filter((n) => n.endsWith('.sql'))
  .sort()
  .map((n) => readFileSync(new URL(n, CARPETA), 'utf8'));

const AHORA = '2026-08-31T18:00:00Z';
const ANTES = '2026-08-01T10:00:00Z';

function base() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const m of MIGRACIONES) db.exec(m);
  return db;
}

const ejecutor = (db) => async (sql, params = []) => db.prepare(sql).all(...params);

/** Un producto con UNA variante y las fotos que se le pasen, como quedo la migracion. */
function sembrar(db, { codigo = 'CG34337', color = 'Único', fotos = [], slug = 'mochila' } = {}) {
  const { id } = db
    .prepare(
      `INSERT INTO productos (codigo, proveedor, slug, nombre, estado, creado_en, actualizado_en)
       VALUES (?, 'catalogo-viejo', ?, 'Mochila', 'publicado', ?, ?) RETURNING id`
    )
    .get(codigo, slug, ANTES, ANTES);

  const { id: varianteId } = db
    .prepare(
      `INSERT INTO variantes (producto_id, sku, color, orden) VALUES (?, ?, ?, 0) RETURNING id`
    )
    .get(id, codigo, color);

  for (const [orden, hash] of fotos.entries()) {
    const { id: imagenId } = db
      .prepare(
        `INSERT INTO imagenes (hash16, anchos, ancho_origen, alto_origen, bytes_origen, creado_en)
         VALUES (?, '[300,600]', 600, 600, 1000, ?) RETURNING id`
      )
      .get(hash, ANTES);
    db.prepare(
      `INSERT INTO variante_imagenes (variante_id, imagen_id, orden) VALUES (?, ?, ?)`
    ).run(varianteId, imagenId, orden);
  }
  return { id, varianteId };
}

const H = (n) => String(n).repeat(16).slice(0, 16);

const colores = (db, codigo = 'CG34337') =>
  db
    .prepare(
      `SELECT v.color, v.sku, v.orden,
              (SELECT COUNT(*) FROM variante_imagenes vi WHERE vi.variante_id = v.id) AS fotos
         FROM variantes v JOIN productos p ON p.id = v.producto_id
        WHERE upper(p.codigo) = upper(?) ORDER BY v.orden`
    )
    .all(codigo);

const cuantos = (db, tabla) => db.prepare(`SELECT COUNT(*) n FROM ${tabla}`).get().n;

const MAPEO = [
  {
    codigo: 'CG34337',
    variantes: [
      { color: 'Verde', fotos: [H('a'), H('b')] },
      { color: 'Gris', fotos: [H('c')] },
    ],
  },
];

// --------------------------------------------------------------------------
// El reparto
// --------------------------------------------------------------------------

test('crea una variante por color, en el orden del mapeo', async () => {
  const db = base();
  sembrar(db, { fotos: [H('a'), H('b'), H('c')] });

  await repartirColores(ejecutor(db), MAPEO, { ahora: AHORA });

  assert.deepEqual(
    colores(db).map((v) => [v.color, v.sku, v.fotos]),
    [
      ['Verde', 'CG34337-verde', 2],
      ['Gris', 'CG34337-gris', 1],
    ]
  );
});

test('la variante vieja se va: era el «Único» que nunca fue un color', async () => {
  // Es lo que el formulario de edicion prohibe a proposito —«su SKU ya circulo»— y por
  // eso esto es una operacion aparte y deliberada, no un guardado.
  const db = base();
  sembrar(db, { fotos: [H('a'), H('b'), H('c')] });

  await repartirColores(ejecutor(db), MAPEO, { ahora: AHORA });

  assert.equal(
    colores(db).some((v) => v.color === 'Único'),
    false
  );
  assert.equal(cuantos(db, 'variantes'), 2);
});

test('las fotos quedan en el orden en que se listaron', async () => {
  const db = base();
  sembrar(db, { fotos: [H('a'), H('b'), H('c')] });

  await repartirColores(
    ejecutor(db),
    [{ codigo: 'CG34337', variantes: [{ color: 'Verde', fotos: [H('b'), H('a')] }] }],
    { ahora: AHORA }
  );

  const orden = db
    .prepare(
      `SELECT i.hash16 FROM variante_imagenes vi
         JOIN imagenes i ON i.id = vi.imagen_id
        ORDER BY vi.orden`
    )
    .all()
    .map((f) => f.hash16);
  assert.deepEqual(orden, [H('b'), H('a')]);
});

test('NO borra ninguna fila de imagenes: los objetos de R2 cuelgan de ellas', async () => {
  /**
   * La garantia central. Reasignar es recablear `variante_imagenes`, que es solo el
   * vinculo. Si esto borrara una fila de `imagenes`, el objeto en R2 quedaria sin dueño
   * e invisible — y estas fotos son las UNICAS copias que existen.
   */
  const db = base();
  sembrar(db, { fotos: [H('a'), H('b'), H('c'), H('d')] });

  await repartirColores(ejecutor(db), MAPEO, { ahora: AHORA });

  assert.equal(cuantos(db, 'imagenes'), 4, 'las cuatro filas siguen ahi');
});

test('reporta las fotos que quedaron sin asignar en vez de borrarlas', async () => {
  // Una foto que no es de ningun color queda huerfana A PROPOSITO. Borrarla seria
  // irreversible, y un error de etiquetado se llevaria una foto buena.
  const db = base();
  sembrar(db, { fotos: [H('a'), H('b'), H('c'), H('d')] });

  const informe = await repartirColores(ejecutor(db), MAPEO, { ahora: AHORA });

  assert.deepEqual(informe[0].sinAsignar, [H('d')]);
});

test('mueve actualizado_en para que el contador de publicar lo vea', async () => {
  // Sin esto el cambio queda hecho y el Inicio dice que no hay nada que publicar.
  const db = base();
  sembrar(db, { fotos: [H('a'), H('b'), H('c')] });

  await repartirColores(ejecutor(db), MAPEO, { ahora: AHORA });

  const { actualizado_en } = db
    .prepare(`SELECT actualizado_en FROM productos WHERE codigo = 'CG34337'`)
    .get();
  assert.equal(actualizado_en, AHORA);
});

// --------------------------------------------------------------------------
// Lo que tiene que RECHAZAR, y sin escribir nada
// --------------------------------------------------------------------------

test('rechaza una foto que es de OTRO producto', async () => {
  /**
   * La guarda mas importante. Los hashes se copian a mano de una planilla: uno pegado
   * de la fila de al lado le sacaria la foto a otro producto, que se quedaria sin ella
   * en el catalogo publicado.
   */
  const db = base();
  sembrar(db, { fotos: [H('a'), H('b'), H('c')] });
  sembrar(db, { codigo: 'OTRO1', slug: 'otro', fotos: [H('z')] });

  await assert.rejects(
    () =>
      repartirColores(
        ejecutor(db),
        [{ codigo: 'CG34337', variantes: [{ color: 'Verde', fotos: [H('z')] }] }],
        { ahora: AHORA }
      ),
    /no es de CG34337|otro producto/i
  );

  assert.equal(colores(db)[0].color, 'Único', 'no se escribio nada');
});

test('rechaza un hash que no existe', async () => {
  const db = base();
  sembrar(db, { fotos: [H('a')] });

  await assert.rejects(
    () =>
      repartirColores(
        ejecutor(db),
        [{ codigo: 'CG34337', variantes: [{ color: 'Verde', fotos: ['0000000000000000'] }] }],
        { ahora: AHORA }
      ),
    /no existe/i
  );
});

test('rechaza un producto que no existe', async () => {
  await assert.rejects(
    () => repartirColores(ejecutor(base()), MAPEO, { ahora: AHORA }),
    /CG34337.*no existe|no existe.*CG34337/i
  );
});

test('rechaza dos colores que darian el mismo SKU', async () => {
  // `skuDe` slugifica: «Verde» y «verde» chocarian contra el UNIQUE de la columna, y el
  // error de SQLite aparece lejos de la causa.
  const db = base();
  sembrar(db, { fotos: [H('a'), H('b')] });

  await assert.rejects(
    () =>
      repartirColores(
        ejecutor(db),
        [
          {
            codigo: 'CG34337',
            variantes: [
              { color: 'Verde', fotos: [H('a')] },
              { color: 'verde', fotos: [H('b')] },
            ],
          },
        ],
        { ahora: AHORA }
      ),
    /mismo SKU|repetid/i
  );

  assert.equal(cuantos(db, 'variantes'), 1, 'no se creo ninguna');
});

test('rechaza la misma foto en dos colores', async () => {
  // No es una restriccion de la base —una imagen puede colgar de varias variantes— sino
  // del caso: acá cada foto MUESTRA un color. Repetirla es casi siempre un error de
  // etiquetado, y silenciarlo dejaria dos colores con la misma foto en el catalogo.
  const db = base();
  sembrar(db, { fotos: [H('a'), H('b')] });

  await assert.rejects(
    () =>
      repartirColores(
        ejecutor(db),
        [
          {
            codigo: 'CG34337',
            variantes: [
              { color: 'Verde', fotos: [H('a')] },
              { color: 'Gris', fotos: [H('a')] },
            ],
          },
        ],
        { ahora: AHORA }
      ),
    /dos veces|repetida/i
  );
});

test('rechaza un producto que ya tiene varias variantes', async () => {
  /**
   * Esta operacion existe para los que quedaron con UNA sola. Sobre uno que ya tiene
   * sus colores, borraria variantes cuyos SKU si circularon de verdad.
   */
  const db = base();
  const { id } = sembrar(db, { fotos: [H('a'), H('b')] });
  db.prepare(
    `INSERT INTO variantes (producto_id, sku, color, orden) VALUES (?, 'CG34337-x', 'Otro', 1)`
  ).run(id);

  await assert.rejects(() => repartirColores(ejecutor(db), MAPEO, { ahora: AHORA }), /ya tiene/i);
});

test('el ensayo no escribe nada', async () => {
  const db = base();
  sembrar(db, { fotos: [H('a'), H('b'), H('c')] });

  const informe = await repartirColores(ejecutor(db), MAPEO, { ahora: AHORA, ensayo: true });

  assert.equal(colores(db)[0].color, 'Único');
  assert.equal(cuantos(db, 'variantes'), 1);
  assert.equal(informe[0].variantes.length, 2, 'igual dice qué haría');
});
