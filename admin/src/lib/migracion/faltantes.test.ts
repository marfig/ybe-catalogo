import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AVANCE_INICIAL,
  porcentaje,
  resueltos,
  sumar,
  textoDeFaltantes,
} from './faltantes.ts';

const con = (parcial: Partial<typeof AVANCE_INICIAL>) => ({ ...AVANCE_INICIAL, ...parcial });

test('sumar no toca el avance que recibe', () => {
  const antes = con({ total: 177 });
  const despues = sumar(antes, 'creado');

  assert.equal(antes.creados, 0);
  assert.equal(despues.creados, 1);
});

test('cada suerte suma en su casillero', () => {
  let a = con({ total: 3 });
  a = sumar(a, 'creado');
  a = sumar(a, 'yaEstaba');
  a = sumar(a, 'problema');

  assert.equal(a.creados, 1);
  assert.equal(a.yaEstaban, 1);
  assert.equal(a.problemas, 1);
  assert.equal(resueltos(a), 3);
});

test('la barra cuenta todo lo resuelto, no sólo lo que entró', () => {
  /**
   * Los que ya estaban y los que fallaron también avanzan la barra: mide cuánto queda del
   * recorrido, no cuántos productos entraron. Dejarlos afuera daría una barra que nunca
   * llega al final aunque no falte nada por hacer.
   */
  assert.equal(porcentaje(con({ total: 4, creados: 2, yaEstaban: 1, problemas: 1 })), 100);
  assert.equal(porcentaje(con({ total: 4, creados: 1 })), 25);
});

test('sin total la barra no divide por cero', () => {
  assert.equal(porcentaje(AVANCE_INICIAL), 0);
  assert.equal(porcentaje(con({ total: -1, creados: 1 })), 0);
});

test('la barra no se pasa de 100 ni baja de 0', () => {
  // Puede pasar si el inventario cambia entre que se armó la lista y termina la corrida.
  assert.equal(porcentaje(con({ total: 2, creados: 5 })), 100);
});

test('el renglón nombra siempre lo importado, y el resto sólo si lo hay', () => {
  /**
   * Mismo criterio que `textoDeMigracion` y `textoDeBarrido`: un «0 con problema»
   * permanente enseña a ignorar el lugar donde después aparece el aviso de verdad.
   *
   * Acá NO se nombran los ausentes, al revés que en la migración de los 189: estos 177 son
   * todos ausentes del proveedor, así que decirlo en cada renglón sería repetir el título
   * de la pantalla 177 veces.
   */
  assert.equal(
    textoDeFaltantes(con({ total: 177, creados: 40 })),
    'Revisados 40 de 177 · 40 importados'
  );

  assert.equal(
    textoDeFaltantes(con({ total: 177, creados: 40, yaEstaban: 2, problemas: 1 })),
    'Revisados 43 de 177 · 40 importados · 2 que ya tenías · 1 con problema'
  );
});
