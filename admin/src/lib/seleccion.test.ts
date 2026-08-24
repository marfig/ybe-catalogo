import { test } from 'node:test';
import assert from 'node:assert/strict';

import { conectarMarcarTodo, estadoDeMarcarTodo } from './seleccion.ts';

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

// --------------------------------------------------------------------------
// conectarMarcarTodo
// --------------------------------------------------------------------------

/**
 * Un checkbox que despacha sus eventos EN EL ORDEN DE LA SPEC HTML.
 *
 * Es el modelo del navegador, y existe por el bug que motivó estos tests: al activar un
 * checkbox el estado se togglea ANTES de despachar `click`, y `input` y `change` salen
 * DESPUÉS, ya propagado el `click`. Ese detalle es todo el bug — un repintado colgado de
 * `input` corre entre medio y pisa la casilla.
 *
 * Modela al navegador, no lo ejecuta: fija el contrato de ESTE módulo —sincronizar antes
 * de que algo repinte— y no reemplaza probarlo en una pantalla real.
 */
function casillaFalsa() {
  const oyentes = new Map<string, Array<() => void>>();
  const control = {
    checked: false,
    indeterminate: false,
    addEventListener(tipo: string, oyente: () => void) {
      oyentes.set(tipo, [...(oyentes.get(tipo) ?? []), oyente]);
    },
    despachar(tipo: string) {
      for (const o of oyentes.get(tipo) ?? []) o();
    },
    /** Un clic de verdad: togglea, y recién después salen los eventos. */
    clic(alBurbujear: () => void) {
      control.checked = !control.checked;
      control.indeterminate = false;
      control.despachar('click');
      control.despachar('input');
      alBurbujear(); // `input` llega al formulario
      control.despachar('change');
      alBurbujear(); // `change` llega al formulario
    },
  };
  return control;
}

/** El repintado del formulario, que es el que pisaba la casilla. */
function repintadoDe(control: { checked: boolean; indeterminate: boolean }, filas: { checked: boolean }[]) {
  return () => {
    const { marcada, indeterminada } = estadoDeMarcarTodo(
      filas.filter((f) => f.checked).length,
      filas.length
    );
    control.checked = marcada;
    control.indeterminate = indeterminada;
  };
}

test('marcar todos marca las filas, aunque el formulario repinte en el medio', () => {
  const control = casillaFalsa();
  const filas = [{ checked: false }, { checked: false }, { checked: false }];
  conectarMarcarTodo(control, () => filas);

  control.clic(repintadoDe(control, filas));

  assert.deepEqual(filas.map((f) => f.checked), [true, true, true]);
  assert.equal(control.checked, true);
});

test('desmarcar todos desmarca las filas', () => {
  const control = casillaFalsa();
  const filas = [{ checked: true }, { checked: true }];
  control.checked = true;
  conectarMarcarTodo(control, () => filas);

  control.clic(repintadoDe(control, filas));

  assert.deepEqual(filas.map((f) => f.checked), [false, false]);
  assert.equal(control.checked, false);
});

test('desde una selección parcial, el clic MARCA todas y no desmarca las tildadas', () => {
  /*
   * El sintoma exacto que se reporto: «marcar todos no funciona, desmarcar todos si».
   * Con el listener colgado de `change`, el repintado del `input` previo devolvia la
   * casilla a vacia y el handler terminaba escribiendo `false` sobre las que ya estaban
   * tildadas — o sea que el boton de marcar desmarcaba.
   */
  const control = casillaFalsa();
  const filas = [{ checked: true }, { checked: false }, { checked: false }];
  control.indeterminate = true;
  conectarMarcarTodo(control, () => filas);

  control.clic(repintadoDe(control, filas));

  assert.deepEqual(filas.map((f) => f.checked), [true, true, true]);
});
