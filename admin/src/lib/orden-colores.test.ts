import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MOVIMIENTOS, esIdentidad, ordenTrasMover } from './orden-colores.ts';

/**
 * El orden de los colores decide QUÉ SE VE del producto: la variante que queda primera es
 * la que el sitio rinde por defecto en la ficha, la que da la miniatura de la tarjeta del
 * listado y la que va al índice del buscador. Un fuera de rango que devuelva una lista
 * corta acá le borra colores a un producto publicado.
 */

// --- Subir ---

test('subir intercambia con el de arriba', () => {
  assert.deepEqual(ordenTrasMover(4, 2, 'subir'), [0, 2, 1, 3]);
  assert.deepEqual(ordenTrasMover(4, 1, 'subir'), [1, 0, 2, 3]);
  assert.deepEqual(ordenTrasMover(4, 3, 'subir'), [0, 1, 3, 2]);
});

test('subir el primero no hace nada', () => {
  // El botón se deshabilita, pero la lógica no confía en eso: un doble clic sobre el
  // ultimo estado del DOM puede llegar igual.
  assert.deepEqual(ordenTrasMover(4, 0, 'subir'), [0, 1, 2, 3]);
});

// --- Bajar ---

test('bajar intercambia con el de abajo', () => {
  assert.deepEqual(ordenTrasMover(4, 1, 'bajar'), [0, 2, 1, 3]);
  assert.deepEqual(ordenTrasMover(4, 0, 'bajar'), [1, 0, 2, 3]);
});

test('bajar el último no hace nada', () => {
  assert.deepEqual(ordenTrasMover(4, 3, 'bajar'), [0, 1, 2, 3]);
});

test('subir y bajar son inversos', () => {
  // Es la propiedad que hace que acomodar una lista no pueda dejarla peor de como estaba.
  const orden = ordenTrasMover(5, 3, 'subir');
  const vuelta = ordenTrasMover(5, 2, 'bajar').map((i) => orden[i]);
  assert.deepEqual(vuelta, [0, 1, 2, 3, 4]);
});

// --- Hacer principal ---

test('hacer principal lo manda al frente y conserva el resto', () => {
  /**
   * ES EL ATAJO QUE JUSTIFICA EL BOTÓN. Con sólo flechas, mover el último color al primer
   * puesto en el producto de 18 colores son diecisiete movimientos. Y el orden relativo de
   * los demás NO se toca: quien eligió que el negro va antes que el gris no pidió que eso
   * cambie por elegir otro principal.
   */
  assert.deepEqual(ordenTrasMover(4, 3, 'principal'), [3, 0, 1, 2]);
  assert.deepEqual(ordenTrasMover(4, 1, 'principal'), [1, 0, 2, 3]);
  assert.deepEqual(ordenTrasMover(18, 17, 'principal'), [
    17, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
  ]);
});

test('hacer principal al que ya es principal no hace nada', () => {
  assert.deepEqual(ordenTrasMover(4, 0, 'principal'), [0, 1, 2, 3]);
});

// --- Los bordes, que son los que pueden borrar colores ---

test('una posición fuera de rango devuelve el orden intacto', () => {
  /**
   * NO SE RECORTA NI SE ADIVINA. Devolver una lista mas corta que `cantidad` haria que el
   * formulario mandara menos colores de los que tiene el producto, y `actualizarProducto`
   * reescribe las variantes con lo que llega: seria perder un color por un indice mal
   * calculado, sin ningun error a la vista.
   */
  for (const desde of [-1, 4, 99, 1.5, Number.NaN]) {
    assert.deepEqual(ordenTrasMover(4, desde, 'subir'), [0, 1, 2, 3], String(desde));
    assert.deepEqual(ordenTrasMover(4, desde, 'principal'), [0, 1, 2, 3], String(desde));
  }
});

test('con un color o ninguno no hay nada que ordenar', () => {
  assert.deepEqual(ordenTrasMover(1, 0, 'principal'), [0]);
  assert.deepEqual(ordenTrasMover(0, 0, 'subir'), []);
  assert.deepEqual(ordenTrasMover(-3, 0, 'subir'), []);
});

test('el resultado es SIEMPRE una permutación completa', () => {
  /**
   * La garantía que protege al producto: cada posición vieja aparece exactamente una vez.
   * Sin esto, un movimiento podria duplicar un color y perder otro.
   */
  for (const cantidad of [1, 2, 3, 5, 18]) {
    for (let desde = 0; desde < cantidad; desde++) {
      for (const movimiento of MOVIMIENTOS) {
        const orden = ordenTrasMover(cantidad, desde, movimiento);
        assert.equal(orden.length, cantidad, `${cantidad}/${desde}/${movimiento}`);
        assert.deepEqual(
          [...orden].sort((a, b) => a - b),
          Array.from({ length: cantidad }, (_, i) => i),
          `${cantidad}/${desde}/${movimiento}`
        );
      }
    }
  }
});

test('un movimiento desconocido no toca nada', () => {
  // Llega de un `data-` del DOM, que cualquiera puede editar desde el inspector.
  assert.deepEqual(ordenTrasMover(3, 1, 'saltar' as never), [0, 1, 2]);
});

// --- La identidad, que es lo que evita trabajo de DOM al vacío ---

test('esIdentidad reconoce el orden sin cambios', () => {
  assert.equal(esIdentidad([0, 1, 2]), true);
  assert.equal(esIdentidad([]), true);
  assert.equal(esIdentidad([1, 0, 2]), false);
  assert.equal(esIdentidad([2, 0, 1]), false);
});
