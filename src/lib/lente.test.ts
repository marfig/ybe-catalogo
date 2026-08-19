import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DIAMETRO_LENTE, FACTOR_LENTE, encuadreDeLente } from './lente.ts';

/**
 * La lupa de la ficha, en cuentas.
 *
 * Un signo al revés acá no da ningún error: da una lupa que muestra la esquina opuesta a
 * donde está el cursor, y eso se descubre mirándola, no ejecutándola. Por eso las cuentas
 * viven separadas del `mousemove`.
 */

/** Una caja de 500 px con lupa de 200 y factor 2: la imagen ampliada mide 1000. */
const caja = { lado: 500, diametro: 200, factor: 2 };

test('el punto bajo el cursor queda en el centro de la lupa', () => {
  /**
   * ES LA UNICA PROPIEDAD QUE IMPORTA. El cursor en el medio de una caja de 500 con factor
   * 2 apunta al pixel 500 de la imagen ampliada; para que ese pixel caiga en el centro de
   * una lupa de 200, la imagen tiene que corrersele 500 - 100 = 400 hacia arriba y a la
   * izquierda.
   */
  assert.deepEqual(encuadreDeLente({ ...caja, cursorX: 250, cursorY: 250 }), {
    x: -400,
    y: -400,
  });
});

test('en el borde de arriba a la izquierda no se sale de la imagen', () => {
  /**
   * Sin acotar, el cursor en (0,0) daria un desplazamiento POSITIVO de +100 y la lupa
   * mostraria un cuarto de imagen y tres cuartos de vacio. Acotado, muestra la esquina
   * completa: es lo que uno espera al mirar una esquina con una lupa de verdad.
   */
  assert.deepEqual(encuadreDeLente({ ...caja, cursorX: 0, cursorY: 0 }), { x: 0, y: 0 });
});

test('en el borde de abajo a la derecha tampoco', () => {
  // El tope es -(1000 - 200) = -800: mas que eso deja vacio del otro lado.
  assert.deepEqual(encuadreDeLente({ ...caja, cursorX: 500, cursorY: 500 }), {
    x: -800,
    y: -800,
  });
});

test('los dos ejes se acotan por separado', () => {
  // Cursor pegado al borde izquierdo pero a media altura: se acota en X y no en Y.
  assert.deepEqual(encuadreDeLente({ ...caja, cursorX: 0, cursorY: 250 }), { x: 0, y: -400 });
});

test('un cursor fuera de la caja se trae adentro', () => {
  // `mousemove` puede llegar con coordenadas de un pixel afuera al salir rapido.
  assert.deepEqual(encuadreDeLente({ ...caja, cursorX: -30, cursorY: 700 }), { x: 0, y: -800 });
});

test('si la lupa es mas grande que la imagen ampliada, la centra', () => {
  /**
   * Pasa con una imagen chica: 300 px de origen a factor 1,5 son 450, menos que una lupa de
   * 500. Ahi el rango de acotado se invierte —el minimo seria mayor que el maximo— y sin
   * este caso la cuenta devolveria el limite equivocado y la imagen quedaria pegada a un
   * borde con vacio al lado.
   */
  assert.deepEqual(encuadreDeLente({ lado: 300, diametro: 500, factor: 1.5, cursorX: 150, cursorY: 150 }), {
    x: 25,
    y: 25,
  });
});

test('una caja sin tamaño no revienta ni devuelve NaN', () => {
  // El primer `mousemove` puede llegar antes de que el layout tenga medidas.
  const r = encuadreDeLente({ lado: 0, diametro: 200, factor: 2, cursorX: 0, cursorY: 0 });
  assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y), `dio ${JSON.stringify(r)}`);
});

test('el desplazamiento nunca deja ver fuera de la imagen', () => {
  /**
   * La garantia, barrida sobre toda la caja: el borde izquierdo de la imagen ampliada nunca
   * entra por derecha del borde de la lupa, y su borde derecho nunca sale por izquierda.
   */
  const { lado, diametro, factor } = caja;
  const ampliada = lado * factor;
  for (let c = -50; c <= lado + 50; c += 10) {
    const { x } = encuadreDeLente({ ...caja, cursorX: c, cursorY: c });
    assert.ok(x <= 0, `x=${x} deja vacio a la izquierda con cursor ${c}`);
    assert.ok(x >= diametro - ampliada, `x=${x} deja vacio a la derecha con cursor ${c}`);
  }
});

// --- Las constantes, que son decisiones y no numeros sueltos ---

test('el factor no promete detalle que las imagenes no tienen', () => {
  /**
   * El origen del catalogo son 600 px —1.130 de 1.165 imagenes son 600×600— asi que la
   * lupa amplia pixeles, no revela detalle. Con 2× la suavidad todavia se lee como una
   * lupa; de 3× en adelante se lee como una foto mala.
   */
  assert.ok(FACTOR_LENTE >= 1.5, 'menos de 1,5x no se nota y no vale el efecto');
  assert.ok(FACTOR_LENTE <= 2, 'mas de 2x sobre 600 px de origen se ve inventado');
});

test('la lupa es mas chica que la foto en la ficha', () => {
  // Una lupa del tamaño de la imagen no es una lupa: es un reemplazo, y tapa la referencia
  // de donde se esta mirando.
  assert.ok(DIAMETRO_LENTE > 0);
  assert.ok(DIAMETRO_LENTE < 400, 'la columna de la ficha ronda los 530 px');
});
