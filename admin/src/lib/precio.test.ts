import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatearPrecio, parsearPrecio } from './precio.ts';

/**
 * Tests del precio tipeado en la grilla.
 *
 * Es un campo de texto libre que termina en una columna INTEGER, y el peor resultado
 * posible no es un error: es que "285.OOO" (con letras O) entre como 285 o como 0 y
 * el producto salga publicado con un precio inventado. De ahi que todo lo que no sea
 * inequivocamente un numero se RECHACE.
 */

test('un numero pelado', () => {
  assert.equal(parsearPrecio('285000'), 285000);
});

test('acepta el separador de miles con punto, como se escribe en Paraguay', () => {
  assert.equal(parsearPrecio('285.000'), 285000);
  assert.equal(parsearPrecio('1.250.000'), 1250000);
});

test('acepta espacios alrededor y adentro de los miles', () => {
  assert.equal(parsearPrecio('  285 000  '), 285000);
});

test('acepta el prefijo Gs. porque es lo que se copia y pega', () => {
  assert.equal(parsearPrecio('Gs. 285.000'), 285000);
  assert.equal(parsearPrecio('gs 285000'), 285000);
});

test('vacio es null, que significa "Consultar precio"', () => {
  // Es un estado con significado (SPEC.md §7.3): sin precio no hay bloque `offers`.
  for (const v of ['', '   ', '\t']) assert.equal(parsearPrecio(v), null);
});

test('cero se acepta: la validacion lo avisa, no lo prohibe', () => {
  assert.equal(parsearPrecio('0'), 0);
});

// --------------------------------------------------------------------------
// Lo que tiene que RECHAZAR. Es donde esta el valor del modulo.
// --------------------------------------------------------------------------

test('RECHAZA letras metidas entre numeros', () => {
  // El caso real: la O mayuscula por el cero. Tolerarlo produciria un precio falso.
  assert.throws(() => parsearPrecio('285.OOO'), /precio/i);
  assert.throws(() => parsearPrecio('285mil'), /precio/i);
});

test('RECHAZA decimales: el guarani no los tiene', () => {
  // Tolerarlos obligaria a decidir si se redondea o se trunca, y las dos opciones
  // cambian el precio sin que nadie lo pida.
  assert.throws(() => parsearPrecio('285000,50'), /decimal|precio/i);
  assert.throws(() => parsearPrecio('285000.50'), /decimal|precio/i);
});

test('RECHAZA negativos', () => {
  assert.throws(() => parsearPrecio('-285000'), /precio/i);
});

test('RECHAZA un numero absurdo en vez de guardarlo', () => {
  // Un tipeo de 20 digitos no es un precio: es un dedo apoyado en una tecla.
  assert.throws(() => parsearPrecio('99999999999999999999'), /precio/i);
});

test('RECHAZA texto suelto', () => {
  for (const v of ['consultar', 'a convenir', '???']) {
    assert.throws(() => parsearPrecio(v), /precio/i, `deberia rechazar ${JSON.stringify(v)}`);
  }
});

test('el mensaje de error incluye lo que se tipeo', () => {
  // Sin eso, con 50 filas en pantalla hay que adivinar cual tiene el problema.
  assert.throws(() => parsearPrecio('285.OOO'), /285\.OOO/);
});

// --------------------------------------------------------------------------
// formatearPrecio — lo que se pinta en el input al cargar la pagina
// --------------------------------------------------------------------------

test('formatea con separador de miles', () => {
  assert.equal(formatearPrecio(285000), '285.000');
});

test('null se formatea como vacio, no como "null" ni como 0', () => {
  assert.equal(formatearPrecio(null), '');
});

test('el ida y vuelta no cambia el valor', () => {
  // El invariante que importa: cargar la pagina y guardar sin tocar nada NO puede
  // modificar un precio. Si el formato no se puede volver a parsear, cada guardado
  // ensuciaria el catalogo entero.
  for (const n of [0, 1, 999, 1000, 285000, 1250000, 999999999]) {
    assert.equal(parsearPrecio(formatearPrecio(n)), n, `fallo con ${n}`);
  }
  assert.equal(parsearPrecio(formatearPrecio(null)), null);
});
