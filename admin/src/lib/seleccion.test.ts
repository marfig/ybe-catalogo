import { test } from 'node:test';
import assert from 'node:assert/strict';

import { estadoDeMarcarTodo } from './seleccion.ts';

/**
 * Tests de la casilla de encabezado de la grilla (SPEC-etapa2 §10.3).
 *
 * Es una casilla de TRES estados, y el tercero —el indeterminado— es el que hace que no
 * mienta: con 3 de 50 tildados, una casilla vacía dice «no hay nada seleccionado» y una
 * llena dice «están los 50». Las dos son falsas.
 */

test('sin nada tildado: vacía', () => {
  assert.deepEqual(estadoDeMarcarTodo(0, 50), { marcada: false, indeterminada: false });
});

test('con todos tildados: llena', () => {
  assert.deepEqual(estadoDeMarcarTodo(50, 50), { marcada: true, indeterminada: false });
});

test('con algunos tildados: indeterminada', () => {
  assert.deepEqual(estadoDeMarcarTodo(3, 50), { marcada: false, indeterminada: true });
});

test('una página sin filas NO queda marcada', () => {
  /*
   * 0 de 0 satisface «están todos» por vacuidad, y una casilla llena sobre una tabla
   * vacía invita a apretar un botón que no tiene sobre qué operar.
   */
  assert.deepEqual(estadoDeMarcarTodo(0, 0), { marcada: false, indeterminada: false });
});

test('el siguiente clic es marcar mientras falte alguno', () => {
  // Desde el indeterminado se completa la selección; no se vacía. Es lo que espera
  // quien tildó tres a mano y después decide que los quiere todos.
  assert.equal(estadoDeMarcarTodo(3, 50).marcada, false);
});
