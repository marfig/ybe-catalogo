import assert from 'node:assert/strict';
import { test } from 'node:test';

import { rotuloDeVuelta } from './navegacion.ts';

/**
 * El rótulo del enlace de vuelta.
 *
 * EL BUG QUE ORIGINÓ ESTE MÓDULO, por segunda vez. El `Panel` tenía el texto «Inicio»
 * fijo mientras el `href` era el que le pasaran, así que una pantalla que volvía a una
 * lista intermedia anunciaba un destino y llevaba a otro. Se agregó el parámetro
 * `volverTexto`… con «Inicio» de default, así que la mentira siguió disponible por
 * omisión — y dos pantallas que vuelven a `/productos` la heredaron.
 *
 * Un default que miente es peor que no tener default: no falla, no avisa, y sólo lo
 * encuentra alguien que hace clic y presta atención a dónde cayó.
 */

test('la raíz es Inicio', () => {
  assert.equal(rotuloDeVuelta('/'), 'Inicio');
});

test('NINGUNA otra ruta dice Inicio: es la invariante que se violó dos veces', () => {
  for (const ruta of ['/productos', '/pedidos-especiales', '/eliminados', '/lo-que-sea']) {
    assert.notEqual(rotuloDeVuelta(ruta), 'Inicio', ruta);
  }
});

test('las rutas conocidas se nombran como se llaman en el panel', () => {
  assert.equal(rotuloDeVuelta('/productos'), 'Productos');
  assert.equal(rotuloDeVuelta('/pedidos-especiales'), 'Pedidos especiales');
  // La pantalla se llama «Papelera», no «Eliminados»: el rótulo nombra el destino tal
  // como lo ve la persona, no como se llama el archivo.
  assert.equal(rotuloDeVuelta('/eliminados'), 'Papelera');
});

test('una ruta que nadie mapeó se deriva del último segmento', () => {
  // Sin esto, agregar una pantalla obligaría a tocar dos archivos, y el que se olvida
  // es siempre el segundo. Derivar da algo razonable y, sobre todo, no dice «Inicio».
  assert.equal(rotuloDeVuelta('/fotos-faltantes'), 'Fotos faltantes');
  assert.equal(rotuloDeVuelta('/barrido'), 'Barrido');
});

test('la barra final no cambia el rótulo', () => {
  assert.equal(rotuloDeVuelta('/productos/'), 'Productos');
});

test('una ruta vacía cae en Inicio, que es a donde lleva', () => {
  // `volver=""` no es un destino: el Panel no rinde el enlace. Pero si alguna vez
  // llegara acá, «Inicio» es la verdad y no una mentira.
  assert.equal(rotuloDeVuelta(''), 'Inicio');
});
