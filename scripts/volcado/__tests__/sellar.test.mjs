import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

import { MAX_VARIABLES_D1, sellarPublicados, slugsDelCatalogo } from '../sellar.mjs';

/**
 * Tests del sellado tras una publicacion exitosa (SPEC-etapa2 §5.2, §11.2).
 *
 * «Un build que falla no cambia ningun estado: nunca queda un `publicado` que en
 * realidad no esta en el sitio.» Este modulo es el que sostiene esa promesa, asi que
 * lo que se prueba es justamente que NO selle de mas.
 */

const MIGRACION = readFileSync(
  new URL('../../../db/migrations/0001_esquema_inicial.sql', import.meta.url),
  'utf8'
);
const ANTES = '2026-08-01T10:00:00Z';
const AHORA = '2026-08-05T18:00:00Z';

function base() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(MIGRACION);
  return db;
}

const ejecutor = (db) => async (sql, params = []) => db.prepare(sql).all(...params);

function alta(db, { codigo, slug, estado, publicado_en = null }) {
  db.prepare(
    `INSERT INTO productos (codigo, proveedor, slug, nombre, estado, creado_en, actualizado_en, publicado_en)
     VALUES (?, 'chenson', ?, 'Producto', ?, ?, ?, ?)`
  ).run(codigo, slug, estado, ANTES, ANTES, publicado_en);
}

const leer = (db, codigo) =>
  db.prepare(`SELECT estado, publicado_en FROM productos WHERE codigo = ?`).get(codigo);

// --------------------------------------------------------------------------
// slugsDelCatalogo — la fuente de verdad es el archivo que se desplego
// --------------------------------------------------------------------------

test('slugsDelCatalogo saca los ids del JSON, que son los slugs', () => {
  const catalogo = [{ id: 'cartera-de-fiesta' }, { id: 'mochila-urbana' }];
  assert.deepEqual([...slugsDelCatalogo(catalogo)].sort(), ['cartera-de-fiesta', 'mochila-urbana']);
});

test('slugsDelCatalogo revienta si un producto no trae id', () => {
  // Sellar contra una lista incompleta dejaria productos en `aprobado` para siempre.
  assert.throws(() => slugsDelCatalogo([{ nombre: 'sin id' }]), /id/i);
});

// --------------------------------------------------------------------------
// La transicion
// --------------------------------------------------------------------------

test('un aprobado que esta en el catalogo pasa a publicado y se sella', async () => {
  const db = base();
  alta(db, { codigo: 'CG1', slug: 'uno', estado: 'aprobado' });

  const r = await sellarPublicados(ejecutor(db), new Set(['uno']), { ahora: AHORA });

  assert.equal(r.publicados, 1);
  const fila = leer(db, 'CG1');
  assert.equal(fila.estado, 'publicado');
  assert.equal(fila.publicado_en, AHORA);
});

test('EL CASO DE LA CARRERA: un aprobado que NO entro al volcado no se toca', async () => {
  // Entre el volcado y este paso pasan minutos. Si alguien aprueba un producto en el
  // medio, sellarlo lo mostraria "En el catalogo" sin estar en el sitio — justo lo
  // que §11.2 promete que no pasa. Por eso se sella contra el archivo desplegado y
  // no contra "todos los aprobados de ahora".
  const db = base();
  alta(db, { codigo: 'CG1', slug: 'entro', estado: 'aprobado' });
  alta(db, { codigo: 'CG2', slug: 'llego-tarde', estado: 'aprobado' });

  const r = await sellarPublicados(ejecutor(db), new Set(['entro']), { ahora: AHORA });

  assert.equal(r.publicados, 1);
  assert.equal(leer(db, 'CG1').estado, 'publicado');
  assert.equal(leer(db, 'CG2').estado, 'aprobado', 'el que llego tarde sigue esperando');
  assert.equal(leer(db, 'CG2').publicado_en, null);
});

test('publicado_en NO se pisa: es la PRIMERA publicacion', async () => {
  // El esquema lo dice: "primera publicacion. NULL = nunca fue publico". Pisarlo en
  // cada build convertiria el campo en "ultima publicacion", que es otro dato.
  const db = base();
  alta(db, { codigo: 'CG1', slug: 'uno', estado: 'publicado', publicado_en: ANTES });

  await sellarPublicados(ejecutor(db), new Set(['uno']), { ahora: AHORA });

  assert.equal(leer(db, 'CG1').publicado_en, ANTES);
});

test('un publicado sin sellar se sella, aunque ya estuviera publicado', async () => {
  // Caso de datos migrados a mano: el estado ya es correcto pero falta la fecha.
  const db = base();
  alta(db, { codigo: 'CG1', slug: 'uno', estado: 'publicado', publicado_en: null });

  await sellarPublicados(ejecutor(db), new Set(['uno']), { ahora: AHORA });

  assert.equal(leer(db, 'CG1').publicado_en, AHORA);
});

test('un eliminado sigue eliminado aunque este en el JSON', async () => {
  // Los eliminados aparecen en productos.json con activo:false para que su URL no
  // quede rota (§5.2). Estar en el archivo NO los devuelve al catalogo.
  const db = base();
  alta(db, { codigo: 'CG1', slug: 'uno', estado: 'eliminado', publicado_en: ANTES });

  const r = await sellarPublicados(ejecutor(db), new Set(['uno']), { ahora: AHORA });

  assert.equal(r.publicados, 0);
  assert.equal(leer(db, 'CG1').estado, 'eliminado');
});

test('un importado no se toca ni por error', async () => {
  const db = base();
  alta(db, { codigo: 'CG1', slug: null, estado: 'importado' });
  await sellarPublicados(ejecutor(db), new Set(['uno']), { ahora: AHORA });
  assert.equal(leer(db, 'CG1').estado, 'importado');
});

test('correrlo dos veces no cambia nada la segunda', async () => {
  // El workflow puede reintentarse. La segunda corrida no puede mover fechas.
  const db = base();
  alta(db, { codigo: 'CG1', slug: 'uno', estado: 'aprobado' });

  await sellarPublicados(ejecutor(db), new Set(['uno']), { ahora: AHORA });
  const r2 = await sellarPublicados(ejecutor(db), new Set(['uno']), {
    ahora: '2026-09-09T09:00:00Z',
  });

  assert.equal(r2.publicados, 0, 'la segunda vez no hay nada que publicar');
  assert.equal(leer(db, 'CG1').publicado_en, AHORA, 'la fecha de la primera vez se conserva');
});

test('una lista vacia no toca nada y no revienta', async () => {
  const db = base();
  alta(db, { codigo: 'CG1', slug: 'uno', estado: 'aprobado' });

  const r = await sellarPublicados(ejecutor(db), new Set(), { ahora: AHORA });

  assert.equal(r.publicados, 0);
  assert.equal(leer(db, 'CG1').estado, 'aprobado');
});

test('sella varios de una vez', async () => {
  const db = base();
  for (const c of ['CG1', 'CG2', 'CG3']) {
    alta(db, { codigo: c, slug: c.toLowerCase(), estado: 'aprobado' });
  }
  const r = await sellarPublicados(ejecutor(db), new Set(['cg1', 'cg2', 'cg3']), { ahora: AHORA });
  assert.equal(r.publicados, 3);
});

// --------------------------------------------------------------------------
// El limite de variables de D1
// --------------------------------------------------------------------------

test('ninguna consulta pasa el limite de variables ligadas de D1', async () => {
  // D1 acepta 100 parametros por consulta. Un catalogo grande — el que dejo la
  // migracion del catalogo viejo — mandaba un `?` por slug en una sola sentencia y
  // el sellado moria con "too many SQL variables", dejando el sitio publicado y la
  // base diciendo `aprobado`. Ese desfase es justo lo que §11.2 promete que no pasa.
  const db = base();
  const slugs = [];
  for (let i = 0; i < MAX_VARIABLES_D1 * 2 + 7; i++) {
    const slug = `producto-${String(i).padStart(4, '0')}`;
    alta(db, { codigo: `CG${i}`, slug, estado: 'aprobado' });
    slugs.push(slug);
  }

  const usados = [];
  const espia = async (sql, params = []) => {
    usados.push(params.length);
    return db.prepare(sql).all(...params);
  };

  const r = await sellarPublicados(espia, new Set(slugs), { ahora: AHORA });

  assert.ok(usados.length > 0, 'la consulta se ejecuto');
  const excedidas = usados.filter((cuantos) => cuantos > MAX_VARIABLES_D1);
  assert.deepEqual(excedidas, [], `hubo consultas con mas de ${MAX_VARIABLES_D1} variables`);
  assert.equal(r.publicados, slugs.length, 'se sellaron todos, no solo el primer lote');
  assert.equal(r.sellados, slugs.length);
  assert.equal(leer(db, 'CG0').estado, 'publicado');
  assert.equal(leer(db, `CG${slugs.length - 1}`).publicado_en, AHORA);
});
