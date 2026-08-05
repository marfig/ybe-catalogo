import { test } from 'node:test';
import assert from 'node:assert/strict';

import { comparar, resumir } from '../diferencias.mjs';

/**
 * Tests del reporte de cambios del volcado.
 *
 * No es cosmetica: quien publica no entra a GitHub (SPEC-etapa2 §11.3). El log de
 * la Action tiene que decir QUE cambio, y "el archivo cambio" no alcanza para
 * distinguir una publicacion normal de un volcado que borro medio catalogo.
 */

const p = (id, extra = {}) => ({ id, nombre: id, precio: 1000, ...extra });

test('comparar: sin cambios no reporta nada', () => {
  const antes = [p('uno'), p('dos')];
  assert.deepEqual(comparar(antes, [p('uno'), p('dos')]), {
    altas: [],
    bajas: [],
    modificados: [],
  });
});

test('comparar: detecta altas', () => {
  const d = comparar([p('uno')], [p('uno'), p('dos')]);
  assert.deepEqual(d.altas, ['dos']);
  assert.deepEqual(d.bajas, []);
  assert.deepEqual(d.modificados, []);
});

test('comparar: detecta bajas', () => {
  // Una baja en el volcado es grave: un producto publicado que desaparece del
  // JSON deja su URL en 404. Por eso se reporta aparte, no junto a los cambios.
  const d = comparar([p('uno'), p('dos')], [p('uno')]);
  assert.deepEqual(d.bajas, ['dos']);
  assert.deepEqual(d.altas, []);
});

test('comparar: detecta modificaciones de cualquier campo, incluido el precio', () => {
  const d = comparar([p('uno', { precio: 1000 })], [p('uno', { precio: 1500 })]);
  assert.deepEqual(d.modificados, ['uno']);
});

test('comparar: un cambio anidado en una variante cuenta como modificacion', () => {
  const antes = [p('uno', { variantes: [{ sku: 'A', color: 'Azul' }] })];
  const despues = [p('uno', { variantes: [{ sku: 'A', color: 'Azul marino' }] })];
  assert.deepEqual(comparar(antes, despues).modificados, ['uno']);
});

test('comparar: el ORDEN de los productos no cuenta como modificacion', () => {
  // El volcado ya emite orden canonico; si el orden contara, cualquier reordenado
  // se leeria como "cambiaron todos" y el reporte no serviria para nada.
  const d = comparar([p('uno'), p('dos')], [p('dos'), p('uno')]);
  assert.deepEqual(d, { altas: [], bajas: [], modificados: [] });
});

test('comparar: los ids salen ordenados, no en orden de aparicion', () => {
  const d = comparar([], [p('zeta'), p('alfa'), p('media')]);
  assert.deepEqual(d.altas, ['alfa', 'media', 'zeta']);
});

test('comparar: un catalogo anterior ausente es todo altas', () => {
  // Primer volcado: no hay productos.json todavia.
  const d = comparar(null, [p('uno'), p('dos')]);
  assert.deepEqual(d.altas, ['dos', 'uno'].sort());
  assert.deepEqual(d.bajas, []);
});

// --------------------------------------------------------------------------
// resumir — la linea que se lee en el log de la Action
// --------------------------------------------------------------------------

test('resumir: sin cambios lo dice explicito', () => {
  assert.match(resumir({ altas: [], bajas: [], modificados: [] }), /sin cambios/);
});

test('resumir: cuenta las tres categorias', () => {
  const linea = resumir({ altas: ['a'], bajas: ['b', 'c'], modificados: ['d'] });
  assert.match(linea, /1 alta/);
  assert.match(linea, /2 bajas/);
  assert.match(linea, /1 modificado/);
});

test('resumir: singular y plural bien', () => {
  assert.match(resumir({ altas: ['a'], bajas: [], modificados: [] }), /1 alta\b/);
  assert.match(resumir({ altas: ['a', 'b'], bajas: [], modificados: [] }), /2 altas\b/);
});
