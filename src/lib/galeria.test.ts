import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FACTOR_AMPLIACION, fotoVecina, topeDeAmpliacion } from './galeria.ts';
import type { Imagen } from './imagenes.ts';

const imagen = (anchos: number[]): Imagen => ({ base: 'catalogo/aaaaaaaaaaaaaaaa', anchos });

// --- El tope de ampliacion: la promesa que la imagen puede cumplir ---

test('el tope sale del ancho REAL que tenemos, no del viewport', () => {
  /**
   * LA RAZON DE SER DE ESTA FUNCION. El origen del catálogo son 600 px —medido: 1.130 de
   * 1.165 imágenes son exactamente 600×600— así que un visor que estire la foto a los
   * 1.400 px de una pantalla grande no muestra más producto: muestra los mismos píxeles,
   * más gordos. Y eso se lee como una foto mala, no como una foto grande.
   */
  assert.equal(topeDeAmpliacion(imagen([300, 600])), Math.round(600 * FACTOR_AMPLIACION));
  assert.equal(topeDeAmpliacion(imagen([300])), Math.round(300 * FACTOR_AMPLIACION));
});

test('el factor no pasa de 2: mas que eso ya no se lee como la misma foto', () => {
  // No es un numero mágico suelto: es el limite de lo que un escalado bicúbico sostiene
  // antes de que el detalle se vea inventado.
  assert.ok(FACTOR_AMPLIACION > 1, 'tiene que ampliar algo');
  assert.ok(FACTOR_AMPLIACION <= 2, 'no puede prometer detalle que no existe');
});

test('una imagen sin anchos no da un tope infinito', () => {
  /**
   * `Math.max()` sin argumentos devuelve `-Infinity`, y `anchoMayor` no lo cubre. Si ese
   * valor llegara a un `max-width` en linea, la regla quedaria invalida y la foto se
   * estiraria sin limite — justo lo contrario de lo que esta funcion existe para evitar.
   */
  assert.equal(topeDeAmpliacion(imagen([])), 0);
});

// --- Moverse entre las fotos de un color ---

test('avanza y retrocede', () => {
  assert.equal(fotoVecina(0, 4, 1), 1);
  assert.equal(fotoVecina(2, 4, 1), 3);
  assert.equal(fotoVecina(2, 4, -1), 1);
});

test('da la vuelta en los dos extremos', () => {
  /**
   * DA LA VUELTA Y NO SE FRENA. Son cuatro fotos en un visor abierto a pantalla completa:
   * una flecha que deja de responder al final se lee como que el visor se colgó, y no
   * queda ninguna pista de que hay que volver para el otro lado.
   */
  assert.equal(fotoVecina(3, 4, 1), 0);
  assert.equal(fotoVecina(0, 4, -1), 3);
});

test('con una sola foto siempre se queda en la misma', () => {
  assert.equal(fotoVecina(0, 1, 1), 0);
  assert.equal(fotoVecina(0, 1, -1), 0);
});

test('sin fotos no devuelve un indice negativo', () => {
  // Un `-1` acá se convierte en `imagenes[-1]`, o sea `undefined`, y el visor se rinde
  // vacío sin decir por qué.
  assert.equal(fotoVecina(0, 0, 1), 0);
  assert.equal(fotoVecina(0, 0, -1), 0);
});

test('un indice fuera de rango se normaliza en vez de propagarse', () => {
  // Puede pasar si el color cambia mientras el visor está abierto y el nuevo tiene menos
  // fotos que el anterior.
  assert.equal(fotoVecina(9, 3, 1), 1);
  // `-4` sobre tres fotos cae en la última —da la vuelta dos veces— y un paso adelante la
  // devuelve a la primera. Lo que importa no es a cuál llega sino que llegue a una válida.
  assert.equal(fotoVecina(-4, 3, 1), 0);
});

test('el resultado SIEMPRE es un indice valido', () => {
  for (const cantidad of [1, 2, 3, 7]) {
    for (let i = -3; i < cantidad + 3; i++) {
      for (const paso of [1, -1] as const) {
        const v = fotoVecina(i, cantidad, paso);
        assert.ok(v >= 0 && v < cantidad, `${i}/${cantidad}/${paso} dio ${v}`);
      }
    }
  }
});
