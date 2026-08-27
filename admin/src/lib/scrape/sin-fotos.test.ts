import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { Ejecutar } from '../grilla.ts';
import { sinFotos } from './sin-fotos.ts';

/**
 * Contra el ESQUEMA REAL con `node:sqlite`, igual que `pendientes.test.ts` y por el mismo
 * motivo: esta consulta decide a qué fichas se les va a volver a pedir la foto. Un producto
 * de más son requests al proveedor sobre algo que ya estaba, y uno de menos es un producto
 * que se queda sin imagen para siempre — el corte por código de la importación no lo va a
 * volver a mirar.
 */
const MIGRACIONES = [
  '0001_esquema_inicial.sql',
  '0002_codigo_insensible_a_mayusculas.sql',
  '0003_aviso_cambio_en_origen.sql',
  '0004_papelera.sql',
  '0005_barrido_de_bajas.sql',
].map((n) => readFileSync(new URL(`../../../../db/migrations/${n}`, import.meta.url), 'utf8'));

const AHORA = '2026-08-27T18:00:00Z';

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
  codigo: string;
  proveedor?: string;
  estado?: string;
  urlOrigen?: string | null;
  /** Cuántas variantes tiene. 1 por defecto; 0 = producto sin variantes. */
  variantes?: number;
  /** Índices de variante (base 0) que llevan foto. Vacío = ninguna. */
  conFoto?: number[];
}

let siguienteHash = 0;

function alta(db: DatabaseSync, a: Alta) {
  const estado = a.estado ?? 'importado';
  db.prepare(
    `INSERT INTO productos (codigo, proveedor, estado, slug, url_origen, creado_en, actualizado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    a.codigo,
    a.proveedor ?? 'chenson',
    estado,
    estado === 'importado' ? null : `slug-${a.codigo}`,
    a.urlOrigen !== undefined ? a.urlOrigen : `https://www.chenson.com.py/producto/1-${a.codigo}`,
    AHORA,
    AHORA
  );
  const productoId = Number(
    (db.prepare('SELECT id FROM productos WHERE codigo = ?').get(a.codigo) as { id: number }).id
  );

  const cuantas = a.variantes ?? 1;
  const conFoto = new Set(a.conFoto ?? []);

  for (let i = 0; i < cuantas; i += 1) {
    db.prepare(
      `INSERT INTO variantes (producto_id, sku, color, orden) VALUES (?, ?, ?, ?)`
    ).run(productoId, `${a.codigo}-${i}`, `Color ${i}`, i);

    if (!conFoto.has(i)) continue;

    const varianteId = Number(
      (db.prepare('SELECT id FROM variantes WHERE sku = ?').get(`${a.codigo}-${i}`) as {
        id: number;
      }).id
    );

    siguienteHash += 1;
    const hash = String(siguienteHash).padStart(16, '0');
    db.prepare(
      `INSERT INTO imagenes (hash16, anchos, ancho_origen, alto_origen, bytes_origen, creado_en)
       VALUES (?, '[300,600]', 600, 600, 1000, ?)`
    ).run(hash, AHORA);
    const imagenId = Number(
      (db.prepare('SELECT id FROM imagenes WHERE hash16 = ?').get(hash) as { id: number }).id
    );

    db.prepare(
      `INSERT INTO variante_imagenes (variante_id, imagen_id, orden) VALUES (?, ?, 0)`
    ).run(varianteId, imagenId);
  }
}

const codigosDe = async (db: DatabaseSync) =>
  (await sinFotos(ejecutor(db))).map((p) => p.codigo);

// --------------------------------------------------------------------------
// Lo que la lista TIENE que traer
// --------------------------------------------------------------------------

test('un producto sin ninguna foto entra en la lista', async () => {
  const db = base();
  alta(db, { codigo: 'AAA111' });
  assert.deepEqual(await codigosDe(db), ['AAA111']);
});

test('un producto con foto NO entra', async () => {
  const db = base();
  alta(db, { codigo: 'AAA111', conFoto: [0] });
  assert.deepEqual(await codigosDe(db), []);
});

test('los tres estados publicables entran: importado, aprobado y publicado', async () => {
  const db = base();
  alta(db, { codigo: 'IMP001', estado: 'importado' });
  alta(db, { codigo: 'APR001', estado: 'aprobado' });
  alta(db, { codigo: 'PUB001', estado: 'publicado' });
  assert.deepEqual(await codigosDe(db), ['APR001', 'IMP001', 'PUB001']);
});

test('devuelve el estado, para que la pantalla lo pueda mostrar', async () => {
  const db = base();
  alta(db, { codigo: 'PUB001', estado: 'publicado' });
  const [fila] = await sinFotos(ejecutor(db));
  assert.equal(fila?.estado, 'publicado');
});

test('devuelve la url de la ficha, que es lo que recibe /api/scrape/ficha', async () => {
  const db = base();
  alta(db, { codigo: 'AAA111', urlOrigen: 'https://www.chenson.com.py/producto/9-aaa111' });
  const [fila] = await sinFotos(ejecutor(db));
  assert.equal(fila?.url, 'https://www.chenson.com.py/producto/9-aaa111');
});

// --------------------------------------------------------------------------
// Lo que la lista NO puede traer, y por qué
// --------------------------------------------------------------------------

test('un eliminado no entra: ya se decidio sacarlo del catalogo', async () => {
  const db = base();
  alta(db, { codigo: 'DEL001', estado: 'eliminado' });
  assert.deepEqual(await codigosDe(db), []);
});

test('sin url de origen no entra: no hay ficha que pedir', async () => {
  const db = base();
  alta(db, { codigo: 'SIN001', urlOrigen: null });
  alta(db, { codigo: 'SIN002', urlOrigen: '' });
  alta(db, { codigo: 'SIN003', urlOrigen: '   ' });
  assert.deepEqual(await codigosDe(db), []);
});

test('los que no son del proveedor no entran', async () => {
  const db = base();
  alta(db, { codigo: 'MAN001', proveedor: 'manual' });
  alta(db, { codigo: 'VIE001', proveedor: 'catalogo-viejo' });
  assert.deepEqual(await codigosDe(db), []);
});

/**
 * ESTE ES EL CASO QUE DECIDE LA CONSULTA, y el que separa un `NOT EXISTS` de un `LEFT JOIN`
 * mal escrito: un modelo de tres colores donde sólo uno trajo foto NO es un producto sin
 * fotos. Volver a pedir su ficha no arregla nada —las variantes vacías son colores que el
 * proveedor sirve sin imagen— y sería un request por cada corrida, para siempre.
 */
test('con al menos una variante con foto, el producto NO entra aunque las otras esten vacias', async () => {
  const db = base();
  alta(db, { codigo: 'MIX001', variantes: 3, conFoto: [1] });
  assert.deepEqual(await codigosDe(db), []);
});

test('todas las variantes vacias si entra', async () => {
  const db = base();
  alta(db, { codigo: 'VAC001', variantes: 3, conFoto: [] });
  assert.deepEqual(await codigosDe(db), ['VAC001']);
});

/**
 * Sin variantes no hay dónde colgar una foto, así que volver a pedir la ficha es
 * exactamente lo que hace falta: es la que crea las variantes.
 */
test('un producto sin variantes entra', async () => {
  const db = base();
  alta(db, { codigo: 'NOV001', variantes: 0 });
  assert.deepEqual(await codigosDe(db), ['NOV001']);
});

// --------------------------------------------------------------------------
// Orden
// --------------------------------------------------------------------------

test('ordena por codigo, que es estable entre corridas', async () => {
  const db = base();
  for (const codigo of ['CCC333', 'AAA111', 'BBB222']) alta(db, { codigo });
  assert.deepEqual(await codigosDe(db), ['AAA111', 'BBB222', 'CCC333']);
});
