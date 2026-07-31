import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatearGs, ESPACIO_DURO } from './precio.ts';

// El formato se resuelve en BUILD, con el ICU de Node, no en el navegador
// (SPEC §9.3). Estos tests fijan la salida exacta.

test('formatearGs: salida esperada en guaranies', () => {
  assert.equal(formatearGs(285000), `Gs.${ESPACIO_DURO}285.000`);
  assert.equal(formatearGs(1250000), `Gs.${ESPACIO_DURO}1.250.000`);
  assert.equal(formatearGs(95000), `Gs.${ESPACIO_DURO}95.000`);
});

test('formatearGs: el separador es espacio DURO, no espacio normal', () => {
  // U+00A0 lo pone el ICU a proposito: evita que "Gs." quede colgado en una
  // linea y el numero salte a la siguiente. No cambiar a U+0020.
  const s = formatearGs(285000);
  assert.equal(ESPACIO_DURO, ' ');
  assert.ok(s.includes(' '), 'debe contener U+00A0');
  assert.ok(!s.includes(' '), 'no debe contener espacio normal U+0020');
  assert.deepEqual(
    [...s].map((c) => c.codePointAt(0)),
    [0x47, 0x73, 0x2e, 0xa0, 0x32, 0x38, 0x35, 0x2e, 0x30, 0x30, 0x30]
  );
});

test('formatearGs: sin decimales, el guarani no los tiene', () => {
  assert.equal(formatearGs(285000), `Gs.${ESPACIO_DURO}285.000`);
  assert.ok(!formatearGs(285000).includes(','), 'no debe haber separador decimal');
});

test('formatearGs: el punto es separador de miles, no decimal', () => {
  // Si alguien cambiara el locale a es-419 saldria "PYG 285,000" y el cliente
  // paraguayo leeria doscientos ochenta y cinco. Este test lo bloquea.
  assert.ok(formatearGs(285000).includes('285.000'));
  assert.ok(!formatearGs(285000).includes('285,000'));
  assert.ok(formatearGs(285000).startsWith('Gs.'), 'el simbolo es Gs., no PYG');
});

test('formatearGs: montos chicos y grandes', () => {
  assert.equal(formatearGs(1000), `Gs.${ESPACIO_DURO}1.000`);
  assert.equal(formatearGs(999), `Gs.${ESPACIO_DURO}999`);
  assert.equal(formatearGs(12500000), `Gs.${ESPACIO_DURO}12.500.000`);
});

test('formatearGs: rechaza valores que el schema no deberia permitir', () => {
  // precio es z.number().int().positive().nullable() (SPEC §4.1). Un no-entero
  // o un negativo indica un bug del importador, no un dato valido.
  assert.throws(() => formatearGs(Number.NaN), /entero positivo/);
  assert.throws(() => formatearGs(-100), /entero positivo/);
  assert.throws(() => formatearGs(1500.75), /entero positivo/);
});
