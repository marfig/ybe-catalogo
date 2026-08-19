import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { Ejecutar } from '../grilla.ts';
import { sinDescripcion } from './pendientes.ts';

/**
 * Contra el ESQUEMA REAL con `node:sqlite`. Esta consulta decide a qué productos se les va a
 * pedir la ficha de nuevo, así que un producto de más son requests al proveedor sobre algo
 * que no hacía falta, y uno de menos es un producto que se queda sin descripción para
 * siempre.
 */
const MIGRACIONES = [
  '0001_esquema_inicial.sql',
  '0002_codigo_insensible_a_mayusculas.sql',
  '0003_aviso_cambio_en_origen.sql',
  '0004_papelera.sql',
  '0005_barrido_de_bajas.sql',
].map((n) => readFileSync(new URL(`../../../../db/migrations/${n}`, import.meta.url), 'utf8'));

const AHORA = '2026-08-19T18:00:00Z';

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
  descripcion?: string | null;
  urlOrigen?: string | null;
}

function alta(db: DatabaseSync, a: Alta) {
  const estado = a.estado ?? 'importado';
  db.prepare(
    `INSERT INTO productos (codigo, proveedor, estado, slug, descripcion, url_origen, creado_en, actualizado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    a.codigo,
    a.proveedor ?? 'chenson',
    estado,
    estado === 'importado' ? null : `slug-${a.codigo}`,
    a.descripcion ?? null,
    a.urlOrigen !== undefined ? a.urlOrigen : `https://www.chenson.com.py/producto/1-${a.codigo}`,
    AHORA,
    AHORA
  );
}

const codigos = async (db: DatabaseSync) =>
  (await sinDescripcion(ejecutor(db))).map((p) => p.codigo);

test('trae los que no tienen descripción y sí tienen ficha del proveedor', async () => {
  const db = base();
  alta(db, { codigo: 'CG001' });
  alta(db, { codigo: 'CG002', descripcion: 'Medidas aprox. (alto x largo x ancho): 1 x 1 x 1 cm' });

  assert.deepEqual(await codigos(db), ['CG001']);
});

test('una descripción de espacios cuenta como vacía', async () => {
  // Un `'   '` rinde un parrafo en blanco en la ficha publica: es un hueco, no contenido.
  const db = base();
  alta(db, { codigo: 'CG003', descripcion: '   ' });
  alta(db, { codigo: 'CG004', descripcion: '' });

  assert.deepEqual(await codigos(db), ['CG003', 'CG004']);
});

test('INCLUYE los publicados, que era la decisión a tomar', async () => {
  /**
   * Son productos que están en la calle, y rellenar una descripción vacía no pisa nada de lo
   * que alguien escribió — el `COALESCE` de `registrarFicha` sólo escribe sobre NULL. Se
   * incluyen porque un producto publicado sin descripción es el caso que MÁS molesta: es el
   * que un cliente está mirando.
   */
  const db = base();
  alta(db, { codigo: 'CG005', estado: 'publicado' });
  alta(db, { codigo: 'CG006', estado: 'aprobado' });
  alta(db, { codigo: 'CG007', estado: 'importado' });

  assert.deepEqual(await codigos(db), ['CG005', 'CG006', 'CG007']);
});

test('la papelera NO entra', async () => {
  // Ya se decidió sacarlos del catálogo: gastar requests del proveedor en ellos no le sirve
  // a nadie, y si alguno se restaura vuelve a aparecer en esta lista.
  const db = base();
  alta(db, { codigo: 'CG008', estado: 'eliminado' });
  alta(db, { codigo: 'CG009' });

  assert.deepEqual(await codigos(db), ['CG009']);
});

test('sólo los del proveedor: los otros orígenes no tienen ficha que pedir', async () => {
  /**
   * `manual` no salió de ningún origen, y `catalogo-viejo` son EXACTAMENTE los productos que
   * el proveedor ya no publica: pedirle su ficha devolvería una página que no existe. Es la
   * misma lista blanca que usa `cola.ts` para el barrido, y por el mismo motivo.
   */
  const db = base();
  alta(db, { codigo: 'CG010', proveedor: 'chenson' });
  alta(db, { codigo: 'AMANO', proveedor: 'manual' });
  alta(db, { codigo: '8732209', proveedor: 'catalogo-viejo' });

  assert.deepEqual(await codigos(db), ['CG010']);
});

test('sin url_origen no entra: no hay ficha que pedir', async () => {
  // Pasa con productos viejos anteriores al scrape. Incluirlos daria un error por producto
  // en cada corrida, sobre algo que esta lista no puede resolver.
  const db = base();
  alta(db, { codigo: 'CG011', urlOrigen: null });
  alta(db, { codigo: 'CG012', urlOrigen: '' });
  alta(db, { codigo: 'CG013' });

  assert.deepEqual(await codigos(db), ['CG013']);
});

test('viene el id, el código y la URL de la ficha', async () => {
  const db = base();
  alta(db, { codigo: 'CG014' });

  const [p] = await sinDescripcion(ejecutor(db));
  assert.equal(typeof p!.id, 'number');
  assert.equal(p!.codigo, 'CG014');
  assert.equal(p!.url, 'https://www.chenson.com.py/producto/1-CG014');
});

test('el orden es por código: estable entre corridas', async () => {
  // Es lo que hace la corrida reanudable: se corta a la mitad, se aprieta de nuevo, y los ya
  // rellenados salen solos de la lista porque ya tienen descripción.
  const db = base();
  for (const c of ['CG030', 'CG010', 'CG020']) alta(db, { codigo: c });

  assert.deepEqual(await codigos(db), ['CG010', 'CG020', 'CG030']);
});
