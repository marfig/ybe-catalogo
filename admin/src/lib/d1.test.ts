import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { loteSqlite } from './d1.ts';

/**
 * El ejecutor de lote, contra `node:sqlite`.
 *
 * NO SE PUEDE PROBAR `loteD1` acá: `batch()` es de la API de Workers y no existe en Node.
 * Lo que sí se prueba es el CONTRATO que las dos implementaciones tienen que cumplir —
 * devolver las filas de cada sentencia en orden, y que todo entre o no entre nada— porque
 * es de eso que dependen quienes lo usan.
 *
 * `loteSqlite` no es un doble de test: es la implementación que usan los tests de
 * `guardar.ts` y `transiciones.ts` para ejercitar el MISMO camino que corre en producción.
 * Vive en `d1.ts`, al lado de la de D1, para que las dos se lean juntas.
 */
function base() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, n TEXT NOT NULL UNIQUE)');
  return db;
}

/**
 * Filas como objetos comunes.
 *
 * `node:sqlite` devuelve objetos SIN prototipo, y `deepEqual` de `assert/strict` los
 * considera distintos de un objeto literal. Es un detalle del driver y no algo que estos
 * tests quieran fijar: lo que importa es qué campos traen.
 */
const plano = (filas: unknown[]) => filas.map((f) => ({ ...(f as object) }));

test('devuelve las filas de cada sentencia, en orden', async () => {
  /**
   * EL ORDEN ES EL CONTRATO. Quien llama empareja el resultado con la fila que lo pidió —
   * es lo que permite reportar «a este producto le cambió el estado en el medio» sobre el
   * producto correcto. Un resultado corrido reportaría el problema en la fila de al lado.
   */
  const db = base();
  const lote = loteSqlite(db);

  const filas = await lote([
    { sql: `INSERT INTO t (id, n) VALUES (?, ?) RETURNING id`, params: [1, 'uno'] },
    { sql: `INSERT INTO t (id, n) VALUES (?, ?) RETURNING id`, params: [2, 'dos'] },
    { sql: `SELECT n FROM t ORDER BY id` },
  ]);

  assert.equal(filas.length, 3);
  assert.deepEqual(plano(filas[0]!), [{ id: 1 }]);
  assert.deepEqual(plano(filas[1]!), [{ id: 2 }]);
  assert.deepEqual(plano(filas[2]!), [{ n: 'uno' }, { n: 'dos' }]);
});

test('una sentencia sin filas devuelve una lista vacía, no un hueco', async () => {
  // `RETURNING` que no devuelve nada es como se detecta que el UPDATE no aplicó. Si eso
  // llegara como `undefined`, quien llama reventaría en vez de reportar la fila.
  const db = base();
  const filas = await loteSqlite(db)([
    { sql: `UPDATE t SET n = 'x' WHERE id = 99 RETURNING id` },
  ]);

  assert.deepEqual(filas, [[]]);
});

test('O ENTRA TODO O NO ENTRA NADA', async () => {
  /**
   * Es la mitad del valor de agrupar, y la que arregla un agujero real: `guardarFilas`
   * borraba las categorías de un producto y después las insertaba. Un request que muriera
   * en el medio dejaba el producto sin ninguna, y un publicable sin categoría rompe el
   * build del sitio.
   */
  const db = base();
  const lote = loteSqlite(db);
  await lote([{ sql: `INSERT INTO t (id, n) VALUES (1, 'uno')` }]);

  await assert.rejects(() =>
    lote([
      { sql: `DELETE FROM t WHERE id = 1` },
      // Choca con el UNIQUE: la sentencia falla y tiene que arrastrar al DELETE de arriba.
      { sql: `INSERT INTO t (id, n) VALUES (2, 'dos')` },
      { sql: `INSERT INTO t (id, n) VALUES (3, 'dos')` },
    ])
  );

  const quedan = plano(db.prepare('SELECT id, n FROM t').all());
  assert.deepEqual(quedan, [{ id: 1, n: 'uno' }], 'el DELETE tenía que revertirse');
});

test('un lote vacío no hace nada y no revienta', async () => {
  // Pasa cuando ninguna fila del formulario cambió: no hay nada que escribir.
  const db = base();
  assert.deepEqual(await loteSqlite(db)([]), []);
});

test('un lote anidado no se puede: la transacción ya está abierta', async () => {
  /**
   * Documenta el límite en vez de dejarlo para que alguien lo descubra. SQLite no anida
   * `BEGIN`, y D1 tampoco anida `batch()`: quien arma un lote junta TODAS sus sentencias y
   * llama una sola vez.
   */
  const db = base();
  const lote = loteSqlite(db);

  await assert.rejects(
    () => lote([{ sql: 'BEGIN' }, { sql: `INSERT INTO t (id, n) VALUES (9, 'nueve')` }]),
    /transaction/i
  );
});
