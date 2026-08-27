import assert from 'node:assert/strict';
import { test } from 'node:test';

import { avisoDeColoresSinNombre } from './aviso-colores.ts';

test('sin colores sin nombre no hay nada que avisar', () => {
  assert.equal(avisoDeColoresSinNombre(0), null);
});

/**
 * La respuesta del endpoint es JSON sin garantías: una versión vieja del Worker no manda el
 * campo. Que falte no puede ensuciar la lista de problemas con una fila en blanco.
 */
test('un campo ausente o basura no avisa nada', () => {
  assert.equal(avisoDeColoresSinNombre(undefined), null);
  assert.equal(avisoDeColoresSinNombre(null), null);
  assert.equal(avisoDeColoresSinNombre(Number.NaN), null);
  assert.equal(avisoDeColoresSinNombre(-3), null);
});

test('con uno, el aviso va en singular', () => {
  const aviso = avisoDeColoresSinNombre(1);
  assert.ok(aviso);
  assert.ok(aviso.includes('1 color'), aviso);
  assert.ok(aviso.includes('esa variante'), aviso);
  assert.ok(!aviso.includes('colores'), aviso);
});

test('con varios, el aviso va en plural', () => {
  const aviso = avisoDeColoresSinNombre(3);
  assert.ok(aviso);
  assert.ok(aviso.includes('3 colores'), aviso);
  assert.ok(aviso.includes('esas variantes'), aviso);
});

/**
 * El aviso tiene que decir DÓNDE mirar. Un «color inválido» a secas manda a leer código; la
 * causa real de las dos veces que esto pasó estaba en el título de la ficha.
 */
test('el aviso dice que se perdieron las fotos y apunta al titulo', () => {
  const aviso = avisoDeColoresSinNombre(2) ?? '';
  assert.ok(/fotos/i.test(aviso), 'no menciona las fotos perdidas');
  assert.ok(/t[íi]tulo/i.test(aviso), 'no apunta al titulo de la ficha');
});
