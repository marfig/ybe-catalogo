import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

import { buscarPorCodigo, normalizarCodigo } from './codigo.ts';
import type { Ejecutar } from './grilla.ts';

/**
 * Tests de la identidad del producto (SPEC-etapa2 §5.3, §7.5, §9).
 *
 * El código es la identidad, y los dos caminos que crean productos —el formulario
 * manual y el scrape— tienen que preguntar por él ANTES de insertar: el manual para
 * ofrecer editar en vez de fallar (§9), el scrape para hacer `UPDATE` y no `INSERT`
 * (§7.5).
 *
 * El `UNIQUE` de la columna es la red, no la lógica: da un error crudo de SQLite, y
 * §10 pide que ningún mensaje del admin lo sea.
 */

const MIGRACIONES = ['0001_esquema_inicial.sql', '0002_codigo_insensible_a_mayusculas.sql'].map(
  (n) => readFileSync(new URL(`../../../db/migrations/${n}`, import.meta.url), 'utf8')
);

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

function alta(db: DatabaseSync, codigo: string, extra: Record<string, unknown> = {}) {
  db.prepare(
    `INSERT INTO productos (codigo, proveedor, slug, nombre, estado, creado_en, actualizado_en)
     VALUES (?, 'chenson', ?, ?, ?, '2026-08-01', '2026-08-01')`
  ).run(
    codigo,
    (extra.slug as string) ?? null,
    (extra.nombre as string) ?? 'Cartera de fiesta',
    (extra.estado as string) ?? 'importado'
  );
}

// --------------------------------------------------------------------------
// normalizarCodigo
// --------------------------------------------------------------------------

test('pasa a mayúsculas y recorta', () => {
  assert.equal(normalizarCodigo('  cg85527  '), 'CG85527');
  assert.equal(normalizarCodigo('Cg85527'), 'CG85527');
});

test('acepta guiones y guiones bajos, que un código manual puede llevar', () => {
  assert.equal(normalizarCodigo('man-001'), 'MAN-001');
  assert.equal(normalizarCodigo('ybe_01'), 'YBE_01');
});

test('RECHAZA vacío', () => {
  for (const v of ['', '   ', '\t']) assert.throws(() => normalizarCodigo(v), /código/i);
});

test('RECHAZA espacios adentro en vez de sacarlos en silencio', () => {
  // Sacarlos cambiaría lo que la persona escribió sin avisarle, y "CG 855 27" es
  // casi siempre un error de tipeo, no un código con espacios.
  assert.throws(() => normalizarCodigo('CG 85527'), /espacio/i);
});

test('RECHAZA caracteres que no son de un código', () => {
  for (const v of ['CG/85527', 'CG.85527', 'CG#1', 'CG\n1']) {
    assert.throws(() => normalizarCodigo(v), /código/i, `deberia rechazar ${JSON.stringify(v)}`);
  }
});

test('RECHAZA un código absurdamente largo', () => {
  assert.throws(() => normalizarCodigo('C'.repeat(100)), /largo|código/i);
});

test('es idempotente', () => {
  assert.equal(normalizarCodigo(normalizarCodigo('cg85527')), 'CG85527');
});

// --------------------------------------------------------------------------
// buscarPorCodigo
// --------------------------------------------------------------------------

test('encuentra el producto y trae lo que el formulario necesita mostrar', async () => {
  const db = base();
  alta(db, 'CG85527', { nombre: 'Cartera de fiesta', estado: 'publicado', slug: 'cartera' });

  const p = await buscarPorCodigo(ejecutor(db), 'CG85527');
  assert.equal(p!.codigo, 'CG85527');
  assert.equal(p!.nombre, 'Cartera de fiesta');
  // El estado decide qué ofrece el formulario y qué puede pisar el scrape (§7.5).
  assert.equal(p!.estado, 'publicado');
  assert.ok(Number.isInteger(p!.id));
});

test('devuelve null si no existe', async () => {
  assert.equal(await buscarPorCodigo(ejecutor(base()), 'CG00000'), null);
});

test('ENCUENTRA aunque venga en minúscula: es el mismo producto', async () => {
  // EL test del módulo. Sin normalizar, el formulario no lo encontraría, insertaría
  // uno nuevo, y quedarían dos productos con dos URLs para la misma cosa.
  const db = base();
  alta(db, 'CG85527');

  for (const escrito of ['cg85527', 'Cg85527', '  CG85527 ']) {
    const p = await buscarPorCodigo(ejecutor(db), escrito);
    assert.ok(p, `no encontró con ${JSON.stringify(escrito)}`);
    assert.equal(p!.codigo, 'CG85527');
  }
});

test('un código inválido no revienta la búsqueda: devuelve null', async () => {
  // Buscar es una consulta, no un alta. Que el formulario explote mientras alguien
  // todavía está tipeando sería peor que no encontrar nada.
  const db = base();
  alta(db, 'CG85527');
  assert.equal(await buscarPorCodigo(ejecutor(db), 'CG 855'), null);
  assert.equal(await buscarPorCodigo(ejecutor(db), ''), null);
});

test('no confunde un código con otro que lo contiene', async () => {
  const db = base();
  alta(db, 'CG855');
  alta(db, 'CG85527');
  assert.equal((await buscarPorCodigo(ejecutor(db), 'CG855'))!.codigo, 'CG855');
});

// --------------------------------------------------------------------------
// La red de la base
// --------------------------------------------------------------------------

test('la BASE rechaza un duplicado por mayúsculas, no solo el código', async () => {
  // La consulta previa no cubre la carrera entre dos pestañas que insertan a la vez.
  // Verificado que sin el indice de la migracion 0002 entran las dos.
  const db = base();
  alta(db, 'CG85527');
  assert.throws(() => alta(db, 'cg85527'), /UNIQUE/i);
  assert.throws(() => alta(db, 'Cg85527'), /UNIQUE/i);
});
