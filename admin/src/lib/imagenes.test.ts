import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ANCHOS } from './imagen.ts';
import {
  BASE_DEV,
  baseDeImagenes,
  claveDeImagen,
  claveDesdeRuta,
  hash16De,
  urlMiniatura,
} from './imagenes.ts';

/**
 * EL BUG QUE ORIGINÓ ESTE MÓDULO.
 *
 * La clave de R2 se armaba por concatenación en tres lugares sueltos: el `put` de
 * `subida.ts` y los `<img>` de dos páginas. Nada obligaba a que coincidieran, y de
 * hecho no había forma de notar que dejaran de hacerlo salvo una foto rota.
 *
 * Estos tests fijan una sola definición para los dos lados.
 */

test('claveDeImagen arma la clave del contrato', () => {
  assert.equal(claveDeImagen('5edcaf83b3f7571f', 300), 'catalogo/5edcaf83b3f7571f/w300.webp');
  assert.equal(claveDeImagen('5edcaf83b3f7571f', 600), 'catalogo/5edcaf83b3f7571f/w600.webp');
});

test('claveDeImagen rechaza un hash que no sea 16 hex', () => {
  // Un hash con barras escribiria (o leeria) fuera del prefijo `catalogo/`.
  for (const malo of ['../../etc/passwd', '5EDCAF83B3F7571F', 'abc', '', '5edcaf83b3f7571f0']) {
    assert.throws(() => claveDeImagen(malo, 300), /hash/i, `deberia rechazar ${JSON.stringify(malo)}`);
  }
});

test('claveDeImagen rechaza un ancho fuera del contrato', () => {
  assert.throws(() => claveDeImagen('5edcaf83b3f7571f', 1200), /ancho/i);
});

// --- La eleccion de base: el bug de "subo local y leo del bucket real" ---

test('en desarrollo la base es el servidor propio, no el bucket real', () => {
  // En `astro dev` el binding IMAGENES es un R2 LOCAL de miniflare. Apuntar al
  // bucket publico da 404 en todo lo que se acaba de subir.
  assert.equal(baseDeImagenes({ baseR2: 'https://pub-abc.r2.dev', dev: true }), BASE_DEV);
});

test('fuera de desarrollo manda PUBLIC_R2_BASE', () => {
  assert.equal(baseDeImagenes({ baseR2: 'https://pub-abc.r2.dev', dev: false }), 'https://pub-abc.r2.dev');
});

test('la barra final sobrante no duplica la barra de la URL', () => {
  // Lo escribe una persona en wrangler.jsonc; una barra de mas no puede romper nada.
  const base = baseDeImagenes({ baseR2: 'https://pub-abc.r2.dev/', dev: false });
  assert.equal(urlMiniatura(base, '5edcaf83b3f7571f', 300), 'https://pub-abc.r2.dev/catalogo/5edcaf83b3f7571f/w300.webp');
});

test('una base vacia falla al arrancar y no en silencio', () => {
  // Sin esto el `<img>` queda con src="/catalogo/..." y el sintoma es una foto
  // rota, que es exactamente el bug que hay que dejar de repetir.
  assert.throws(() => baseDeImagenes({ baseR2: '', dev: false }), /PUBLIC_R2_BASE/);
  assert.throws(() => baseDeImagenes({ baseR2: undefined, dev: false }), /PUBLIC_R2_BASE/);
});

// --- El hash de dedupe ---

test('hash16De son los primeros 16 hex del SHA-256', async () => {
  // Vector conocido: SHA-256 de "abc" empieza en ba7816bf8f01cfea.
  assert.equal(await hash16De(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea');
});

test('hash16De da 16 hex en minúscula, apto para la clave', async () => {
  const h = await hash16De(new TextEncoder().encode('lo que sea'));
  assert.match(h, /^[0-9a-f]{16}$/);
  assert.doesNotThrow(() => claveDeImagen(h, 300));
});

test('bytes distintos dan hashes distintos', async () => {
  const a = await hash16De(new TextEncoder().encode('foto-a'));
  const b = await hash16De(new TextEncoder().encode('foto-b'));
  assert.notEqual(a, b);
});

// --- El parser del endpoint de desarrollo ---

test('claveDesdeRuta acepta lo que emite claveDeImagen', () => {
  for (const ancho of ANCHOS) {
    const clave = claveDeImagen('5edcaf83b3f7571f', ancho);
    assert.equal(claveDesdeRuta(clave), clave, `ida y vuelta para w${ancho}`);
  }
});

test('claveDesdeRuta rechaza todo lo que no sea una miniatura del catalogo', () => {
  // El endpoint lee del binding R2 con la clave que llega por URL. Sin esta
  // validacion, cualquier objeto del bucket seria descargable por su nombre.
  for (const malo of [
    'catalogo/../secreto.txt',
    'otro-prefijo/5edcaf83b3f7571f/w300.webp',
    'catalogo/5edcaf83b3f7571f/w1200.webp',
    'catalogo/5edcaf83b3f7571f/original.jpg',
    'catalogo/no-es-un-hash/w300.webp',
    'catalogo/5edcaf83b3f7571f/w300.webp/extra',
    '',
  ]) {
    assert.equal(claveDesdeRuta(malo), null, `deberia rechazar ${JSON.stringify(malo)}`);
  }
});
