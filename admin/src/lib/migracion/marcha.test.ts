import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AVANCE_INICIAL,
  porcentaje,
  resueltos,
  sumar,
  textoDeMigracion,
  type Suerte,
} from './marcha.ts';

const avanceDe = (total: number, ...suertes: Suerte[]) =>
  suertes.reduce(sumar, { ...AVANCE_INICIAL, total });

test('sumar no toca el avance que recibe', () => {
  const antes = { ...AVANCE_INICIAL, total: 10 };
  sumar(antes, 'migrado');
  assert.equal(antes.migrados, 0);
});

test('los ausentes cuentan como recorrido', () => {
  /**
   * Medido el 2026-08-12: de los 368 del catalogo viejo, 179 ya no estan en el proveedor.
   * Si los ausentes no contaran, la barra se clavaria en la mitad con la migracion
   * terminada — y quien mira pensaria que se colgo.
   */
  assert.equal(porcentaje(avanceDe(4, 'migrado', 'ausente')), 50);
  assert.equal(porcentaje(avanceDe(2, 'ausente', 'ausente')), 100);
});

test('todo lo resuelto cuenta, de cualquier manera', () => {
  assert.equal(resueltos(avanceDe(9, 'migrado', 'ausente', 'yaEstaba', 'indeterminado', 'problema')), 5);
});

test('sin total la barra no divide por cero', () => {
  assert.equal(porcentaje(AVANCE_INICIAL), 0);
});

test('la barra no se pasa de 100 si el total quedó corto', () => {
  assert.equal(porcentaje(avanceDe(1, 'migrado', 'migrado', 'migrado')), 100);
});

test('los ausentes se nombran siempre, incluso en cero', () => {
  // Son la mitad del catalogo viejo: quien mira necesita ver que eso es lo esperado.
  assert.match(textoDeMigracion(avanceDe(10, 'migrado')), /0 que el proveedor ya no publica/);
});

test('lo excepcional se nombra sólo si pasó', () => {
  // Un «0 con problema» permanente ensena a ignorar el lugar donde despues aparece el
  // aviso de verdad. Mismo criterio que `textoDeBarrido`.
  const limpio = textoDeMigracion(avanceDe(10, 'migrado'));
  assert.doesNotMatch(limpio, /con problema/);
  assert.doesNotMatch(limpio, /sin respuesta/);
  assert.doesNotMatch(limpio, /ya tenías/);

  assert.match(textoDeMigracion(avanceDe(10, 'problema')), /1 con problema/);
  assert.match(textoDeMigracion(avanceDe(10, 'indeterminado')), /1 sin respuesta/);
  assert.match(textoDeMigracion(avanceDe(10, 'yaEstaba')), /1 que ya tenías/);
});

test('el renglón dice cuántos de cuántos', () => {
  assert.match(textoDeMigracion(avanceDe(368, 'migrado', 'ausente')), /Revisados 2 de 368/);
});
