import { test } from 'node:test';
import assert from 'node:assert/strict';

import { argumentosWrangler, enUnaLinea, filasDeSalida } from '../ejecutor-wrangler.mjs';

/**
 * Tests del ejecutor local basado en wrangler.
 *
 * En la GitHub Action el volcado va por la API HTTP de D1 (`ejecutorD1`), pero en
 * una maquina no hay token: hay una sesion de wrangler. Este ejecutor existe para
 * poder correr y verificar el volcado en local.
 *
 * Lo que se prueba es el PARSEO de la salida, que es donde estan las trampas.
 */

const META = {
  served_by: 'v3-prod',
  rows_read: 6,
  rows_written: 0,
};

const salidaValida = (filas) =>
  `├ Checking if file needs uploading\n│\n${JSON.stringify([{ results: filas, success: true, meta: META }], null, 2)}\n`;

test('filasDeSalida: saltea el preambulo que wrangler escribe en stdout', () => {
  // El preambulo va a STDOUT, no a stderr, asi que hay que buscar donde empieza
  // el JSON en vez de asumir que la salida arranca con "[".
  const filas = [{ id: 1, slug: 'uno' }, { id: 2, slug: 'dos' }];
  assert.deepEqual(filasDeSalida(salidaValida(filas)), filas);
});

test('filasDeSalida: un resultado sin filas es un arreglo vacio', () => {
  assert.deepEqual(filasDeSalida(salidaValida([])), []);
});

test('filasDeSalida: DETECTA el resumen que devuelve --file y revienta', () => {
  // La trampa que costo un rato: `wrangler d1 execute --file X --json` devuelve
  // un RESUMEN en vez de las filas, y parecia que la consulta traia una sola
  // fila cuando la base tenia seis. Si alguien cambia --command por --file, esto
  // corta en vez de volcar un catalogo truncado.
  const resumen = salidaValida([
    { 'Total queries executed': 1, 'Rows read': 11, 'Rows written': 0 },
  ]);
  assert.throws(() => filasDeSalida(resumen), /resumen/i);
});

test('filasDeSalida: sin JSON en la salida, revienta con la salida a la vista', () => {
  assert.throws(() => filasDeSalida('✘ algo salio mal\n'), /no devolvio JSON/);
});

test('filasDeSalida: mas de un resultado para una sola sentencia revienta', () => {
  const dos = JSON.stringify([
    { results: [{ id: 1 }], success: true, meta: META },
    { results: [{ id: 2 }], success: true, meta: META },
  ]);
  assert.throws(() => filasDeSalida(dos), /2 resultados/);
});

test('filasDeSalida: un success:false revienta', () => {
  const fallo = JSON.stringify([{ results: [], success: false, meta: META }]);
  assert.throws(() => filasDeSalida(fallo), /rechazo la consulta/);
});

test('enUnaLinea: colapsa el SQL multilinea y sustituye los parametros', () => {
  // wrangler --command recibe una sola cadena; el SQL de consultar.mjs es un
  // template multilinea.
  const sql = `
    SELECT id
      FROM productos
     WHERE estado IN (?, ?)`;
  assert.equal(
    enUnaLinea(sql, ['aprobado', 'publicado']),
    "SELECT id FROM productos WHERE estado IN ('aprobado', 'publicado')"
  );
});

test('enUnaLinea: escapa el apostrofo de un parametro', () => {
  assert.equal(enUnaLinea('SELECT ?', ["d'Or"]), "SELECT 'd''Or'");
});

test('enUnaLinea: revienta si sobran o faltan parametros', () => {
  // Un desajuste silencioso produciria SQL valido pero con el filtro equivocado.
  assert.throws(() => enUnaLinea('SELECT ?, ?', ['uno']), /2 placeholders.*1 parametro/);
  assert.throws(() => enUnaLinea('SELECT ?', ['uno', 'dos']), /1 placeholder.*2 parametros/);
});

// --------------------------------------------------------------------------
// Contra QUE base se corre. Es la decision mas cara de este archivo.
// --------------------------------------------------------------------------

const args = (opciones) => argumentosWrangler({ base: 'ybe-catalogo', config: 'db/wrangler.jsonc', ...opciones });

test('por defecto va contra REMOTO: el volcado publica lo que hay en produccion', () => {
  // Es el comportamiento historico y el que usa la GitHub Action. Cambiarlo por
  // descuido volcaria una base vacia sobre el catalogo publicado.
  const a = args({});
  assert.ok(a.includes('--remote'));
  assert.equal(a.includes('--local'), false);
});

test('con local, NUNCA aparece --remote', () => {
  /**
   * La invariante que importa. `--local` y `--remote` juntos no son un error de
   * sintaxis: wrangler elige uno, y cual elige no es algo que convenga averiguar
   * mirando un catalogo publicado.
   */
  const a = args({ local: true });
  assert.ok(a.includes('--local'));
  assert.equal(a.includes('--remote'), false);
});

test('local apunta al estado de miniflare del admin, no a uno nuevo', () => {
  // Sin `--persist-to`, wrangler crea un estado en la raiz del repo y volcaria una
  // base vacia: la D1 con la que trabaja `astro dev` vive bajo admin/.
  const a = args({ local: true });
  const i = a.indexOf('--persist-to');
  assert.notEqual(i, -1, 'falta --persist-to');
  assert.equal(a[i + 1], 'admin/.wrangler/state');
});

test('siempre --command y nunca --file', () => {
  // `--file --json` devuelve un RESUMEN en vez de las filas, y el volcado saldria
  // truncado sin ningun error. Ya paso una vez.
  for (const opciones of [{}, { local: true }]) {
    const a = args(opciones);
    assert.ok(a.includes('--command'), JSON.stringify(opciones));
    assert.equal(a.includes('--file'), false, JSON.stringify(opciones));
  }
});

test('la base y el config viajan tal cual', () => {
  const a = args({});
  assert.equal(a[a.indexOf('execute') + 1], 'ybe-catalogo');
  assert.equal(a[a.indexOf('--config') + 1], 'db/wrangler.jsonc');
});
