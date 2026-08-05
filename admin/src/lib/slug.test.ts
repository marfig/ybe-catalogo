import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LARGO_MAXIMO, slugificar, slugUnico } from './slug.ts';

/**
 * Tests del slug (SPEC.md §6.7, SPEC-etapa2 §5.2).
 *
 * El slug se genera UNA vez, al aprobar, y desde ahi es la URL del producto para
 * siempre: vive en conversaciones de WhatsApp que nadie va a corregir. Un bug aca no
 * se arregla despues — se arrastra o se rompe un enlace.
 */

test('slugifica un nombre normal', () => {
  assert.equal(slugificar('Cartera de fiesta con strass'), 'cartera-de-fiesta-con-strass');
});

test('saca tildes y eñes', () => {
  // Es la regla explicita de §6.7, y los slugs ya publicados la cumplen:
  // "Riñonera juvenil" quedo como "rinonera-juvenil".
  assert.equal(slugificar('Riñonera juvenil'), 'rinonera-juvenil');
  assert.equal(slugificar('Mochila acolchada güeña ártica'), 'mochila-acolchada-guena-artica');
});

test('conserva los numeros y descarta el resto de los simbolos', () => {
  // Caso real: 'Mochila urbana lisa 18"' quedo como 'mochila-urbana-lisa-18'.
  assert.equal(slugificar('Mochila urbana lisa 18"'), 'mochila-urbana-lisa-18');
  assert.equal(slugificar('Cartera 2×1 (oferta)'), 'cartera-2x1-oferta');
});

test('colapsa separadores y no deja guiones en los bordes', () => {
  assert.equal(slugificar('  ---Cartera   //  de   fiesta---  '), 'cartera-de-fiesta');
});

test('el resultado solo tiene minusculas, numeros y guiones', () => {
  const sucio = 'ÁÉÍ Ñoño! ¿Qué? 50% —dijo— "che" #1 @casa +vos/más';
  const slug = slugificar(sucio);
  assert.match(slug, /^[a-z0-9]+(-[a-z0-9]+)*$/, `slug invalido: ${slug}`);
});

test('acorta los nombres largos sin cortar una palabra al medio', () => {
  // Un slug de 200 caracteres es una URL inusable. Se corta en un guion para que
  // la ultima palabra quede entera, no mutilada.
  const largo = 'Mochila urbana impermeable con compartimento acolchado para notebook de quince pulgadas y bolsillo frontal';
  const slug = slugificar(largo);
  assert.ok(slug.length <= LARGO_MAXIMO, `${slug.length} > ${LARGO_MAXIMO}`);
  assert.ok(!slug.endsWith('-'));
  // La palabra final no puede ser un pedazo: tiene que estar completa en el original.
  const palabras = slug.split('-');
  assert.ok(
    largo.toLowerCase().includes(palabras[palabras.length - 1]),
    `la ultima palabra "${palabras[palabras.length - 1]}" quedo cortada`
  );
});

test('es determinista', () => {
  assert.equal(slugificar('Cartera de fiesta'), slugificar('Cartera de fiesta'));
});

// --------------------------------------------------------------------------
// El caso que no puede producir un slug vacio
// --------------------------------------------------------------------------

test('un nombre sin nada slugificable NO devuelve cadena vacia: revienta', () => {
  // Un slug vacio produciria la URL /productos/ — que no es la ficha de nadie — y
  // el UNIQUE de la base lo dejaria pasar una vez. Cortar es mejor que publicar un
  // producto inalcanzable.
  for (const nombre of ['', '   ', '!!!', '¿?¿?', '---']) {
    assert.throws(() => slugificar(nombre), /slug/i, `deberia reventar con ${JSON.stringify(nombre)}`);
  }
});

// --------------------------------------------------------------------------
// slugUnico — la colision
// --------------------------------------------------------------------------

test('sin colision devuelve el slug tal cual', () => {
  assert.equal(slugUnico('cartera-de-fiesta', new Set()), 'cartera-de-fiesta');
});

test('ante colision sufija -2, -3, como pide §6.7', () => {
  assert.equal(slugUnico('cartera', new Set(['cartera'])), 'cartera-2');
  assert.equal(slugUnico('cartera', new Set(['cartera', 'cartera-2'])), 'cartera-3');
  assert.equal(
    slugUnico('cartera', new Set(['cartera', 'cartera-2', 'cartera-3'])),
    'cartera-4'
  );
});

test('el sufijo no rompe el largo maximo', () => {
  // Si el base ya esta en el limite, agregar "-12" lo pasaria. Se recorta el base
  // para que el resultado entero entre.
  const base = 'a'.repeat(LARGO_MAXIMO);
  const tomados = new Set([base]);
  const slug = slugUnico(base, tomados);
  assert.ok(slug.length <= LARGO_MAXIMO, `${slug.length} > ${LARGO_MAXIMO}: ${slug}`);
  assert.notEqual(slug, base);
});

test('slugUnico no muta el conjunto que recibe', () => {
  // Quien llama decide cuando registrar el slug. Mutar acá haria que un intento
  // fallido igual reserve el nombre.
  const tomados = new Set(['cartera']);
  slugUnico('cartera', tomados);
  assert.deepEqual([...tomados], ['cartera']);
});

test('la busqueda de sufijo no se cuelga si hay muchisimas colisiones', () => {
  const tomados = new Set(['x', ...Array.from({ length: 200 }, (_, i) => `x-${i + 2}`)]);
  const slug = slugUnico('x', tomados);
  assert.equal(slug, 'x-202');
});
