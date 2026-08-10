import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buscar, normalizar, type EntradaIndice } from './buscar.ts';

/**
 * Tests de la busqueda del sitio publico (SPEC §9.4, SPEC-etapa2 §5.3).
 *
 * El caso central del negocio manda: un cliente pregunta por WhatsApp citando el
 * CODIGO. Todo lo que sigue esta ordenado por esa realidad, no por elegancia.
 */

const P = (k: string, n: string, extra: Partial<EntradaIndice> = {}): EntradaIndice => ({
  i: n.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  n,
  k,
  p: 100000,
  c: ['carteras'],
  t: null,
  ...extra,
});

const INDICE: EntradaIndice[] = [
  P('CG85527', 'Cartera de fiesta con strass'),
  P('CG84455', 'Mochila juvenil acolchada'),
  P('CG81500', 'Billetera de dama'),
  P('CG85900', 'Riñonera juvenil'),
  P('2515304', 'Mochila urbana lisa 18"'),
];

const codigos = (q: string) => buscar(INDICE, q).map((r) => r.k);

// --------------------------------------------------------------------------
// Por codigo: el caso que justifica la funcion
// --------------------------------------------------------------------------

test('el código exacto encuentra el producto', () => {
  assert.deepEqual(codigos('CG85527'), ['CG85527']);
});

test('el código no distingue mayúsculas', () => {
  // Nadie escribe el codigo en mayusculas desde el telefono.
  assert.deepEqual(codigos('cg85527'), ['CG85527']);
});

test('un pedazo del código alcanza', () => {
  /**
   * El cliente manda una foto de la etiqueta o escribe de memoria: «85527». Exigir el
   * prefijo `CG` seria exigirle que sepa que el prefijo importa, y no importa.
   */
  assert.deepEqual(codigos('85527'), ['CG85527']);
});

test('el código gana sobre el nombre cuando los dos coinciden', () => {
  /**
   * Si alguien escribe algo que es a la vez un codigo y parte de un nombre, lo que
   * quiso es el codigo: es un identificador, no una descripcion.
   */
  const indice = [P('MOCHILA1', 'Cartera de fiesta'), P('CG1', 'Mochila urbana')];
  assert.deepEqual(
    buscar(indice, 'mochila').map((r) => r.k),
    ['MOCHILA1', 'CG1']
  );
});

test('un código exacto va antes que uno que solo lo contiene', () => {
  const indice = [P('CG855270', 'Otra cosa'), P('CG85527', 'La que busca')];
  assert.deepEqual(
    buscar(indice, 'CG85527').map((r) => r.k),
    ['CG85527', 'CG855270']
  );
});

// --------------------------------------------------------------------------
// Por nombre
// --------------------------------------------------------------------------

test('busca por nombre', () => {
  assert.deepEqual(codigos('billetera'), ['CG81500']);
});

test('las palabras pueden venir en cualquier orden', () => {
  // «acolchada mochila» y «mochila acolchada» son la misma intencion.
  assert.deepEqual(codigos('acolchada mochila'), ['CG84455']);
});

test('todas las palabras tienen que estar, no cualquiera', () => {
  /**
   * Con OR, «mochila roja» traeria todas las mochilas y la persona concluye que el
   * buscador no filtra. Con AND, no traer nada es informacion: eso no existe.
   */
  assert.deepEqual(codigos('mochila billetera'), []);
});

test('encuentra por una parte de la palabra', () => {
  // Se busca mientras se tipea: «cart» ya tiene que mostrar carteras.
  assert.deepEqual(codigos('cart'), ['CG85527']);
});

// --------------------------------------------------------------------------
// Acentos y eñes: no son un detalle en castellano
// --------------------------------------------------------------------------

test('«rinonera» encuentra «Riñonera»', () => {
  /**
   * NADIE escribe la eñe desde el buscador de un teclado apurado, y menos los acentos.
   * Si esto no funciona, el producto existe y la persona concluye que no lo tenemos.
   */
  assert.deepEqual(codigos('rinonera'), ['CG85900']);
});

test('«Riñonera» también encuentra «Riñonera»', () => {
  assert.deepEqual(codigos('riñonera'), ['CG85900']);
});

test('normalizar saca acentos, eñes y mayúsculas', () => {
  assert.equal(normalizar('Riñonera Ñandutí ÁÉÍÓÚ'), 'rinonera nanduti aeiou');
});

test('normalizar colapsa los espacios de más', () => {
  // Copiar y pegar de WhatsApp trae espacios raros y saltos de linea.
  assert.equal(normalizar('  mochila \n  urbana  '), 'mochila urbana');
});

// --------------------------------------------------------------------------
// Bordes
// --------------------------------------------------------------------------

test('una consulta vacía no devuelve nada', () => {
  /**
   * Devolver el catalogo entero seria peor que no devolver nada: la lista aparece
   * sola al enfocar el campo y tapa la pagina sin que nadie lo haya pedido.
   */
  assert.deepEqual(buscar(INDICE, ''), []);
  assert.deepEqual(buscar(INDICE, '   '), []);
});

test('lo que no existe devuelve vacío, no todo', () => {
  assert.deepEqual(codigos('paraguas'), []);
});

test('un índice vacío no rompe', () => {
  assert.deepEqual(buscar([], 'mochila'), []);
});

test('la cantidad de resultados está acotada', () => {
  /**
   * Sin tope, «a» sobre 1.500 productos pinta una lista de 1.500 nodos mientras se
   * tipea. El tope es del RENDER, no de la busqueda: quien quiera mas, escribe mas.
   */
  const muchos = Array.from({ length: 100 }, (_, i) => P(`CG${i}`, `Mochila ${i}`));
  assert.equal(buscar(muchos, 'mochila').length, 20);
});

test('un producto sin nombre no rompe la búsqueda por código', () => {
  // El nombre lo escribe una persona y puede faltar; el codigo nunca falta (§5.3).
  const indice = [P('CG1', '', { n: '' })];
  assert.deepEqual(
    buscar(indice, 'CG1').map((r) => r.k),
    ['CG1']
  );
});

test('los símbolos de la consulta no la rompen', () => {
  // Pegar desde WhatsApp trae comillas, guiones y demas.
  assert.deepEqual(codigos('«CG85527»'), ['CG85527']);
  assert.deepEqual(codigos('mochila-urbana'), ['2515304']);
});

test('el mismo índice y la misma consulta dan el mismo orden', () => {
  // Sin orden estable, la lista se reordena entre teclas y el ojo pierde el item.
  assert.deepEqual(buscar(INDICE, 'a'), buscar(INDICE, 'a'));
});
