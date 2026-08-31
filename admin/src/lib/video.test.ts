import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  claveDePoster,
  claveDeVideo,
  clavesDeVideo,
  instanteDelPoster,
  medidaDelPoster,
  rutaDeVideo,
  urlPoster,
  urlVideo,
} from './video.ts';

const HASH = 'bbbbbbbbbbbbbbbb';

test('la clave del video vive bajo su propio prefijo, no bajo catalogo/', () => {
  // `indice.json.ts` hace `base.replace('catalogo/', '')` sobre la miniatura. Un
  // video guardado bajo `catalogo/` pasaría por ese replace y saldría como una
  // miniatura rota en el buscador, sin error.
  assert.equal(claveDeVideo(HASH), `videos/${HASH}/video.mp4`);
  assert.equal(claveDePoster(HASH), `videos/${HASH}/poster.webp`);
});

test('las dos claves de un video son las que hay que borrar de R2', () => {
  assert.deepEqual(clavesDeVideo(HASH), [`videos/${HASH}/video.mp4`, `videos/${HASH}/poster.webp`]);
});

test('un hash inválido no arma clave', () => {
  // Mismo motivo que en `claveDeImagen`: un hash con barras escribiría fuera del
  // prefijo. Se valida aunque venga de la base.
  for (const malo of ['../etc', 'BBBBBBBBBBBBBBBB', 'bbbb', `${HASH}/x`, '']) {
    assert.throws(() => claveDeVideo(malo), /Hash inválido/, malo);
    assert.throws(() => clavesDeVideo(malo), /Hash inválido/, malo);
  }
});

// --------------------------------------------------------------------------
// Las reglas del poster
// --------------------------------------------------------------------------

test('el poster NO se saca del primer cuadro', () => {
  // El cuadro 0 de un video de celular es casi siempre negro o un fundido: la ficha
  // mostraria un rectangulo oscuro como portada. Un segundo adentro ya hay imagen.
  assert.equal(instanteDelPoster(10), 1);
});

test('en un video mas corto que dos segundos, el poster sale del medio', () => {
  // Pedir el segundo 1 de un video de 0.8 s no devuelve nada: el `seek` se pasa del
  // final y el canvas dibuja un cuadro vacio.
  assert.equal(instanteDelPoster(0.8), 0.4);
  assert.equal(instanteDelPoster(2), 1);
});

test('una duracion que el navegador no sabe cae al principio', () => {
  // `duration` es Infinity o NaN hasta que llegan los metadatos, y en algunos MP4 se
  // queda asi. Un `seek` a Infinity deja el <video> colgado sin lanzar.
  for (const mala of [Number.POSITIVE_INFINITY, Number.NaN, 0, -3]) {
    assert.equal(instanteDelPoster(mala), 0, String(mala));
  }
});

test('el poster no supera los 600 px de lado mayor', () => {
  // El mismo tope que la derivada mas grande de una foto: es lo que entra en la ficha.
  assert.deepEqual(medidaDelPoster(1080, 1920), { ancho: 338, alto: 600 });
  assert.deepEqual(medidaDelPoster(1920, 1080), { ancho: 600, alto: 338 });
});

test('el poster nunca se amplia', () => {
  // La misma regla que sostiene todo el pipeline de imagen: ampliar inventa pixeles.
  assert.deepEqual(medidaDelPoster(320, 240), { ancho: 320, alto: 240 });
});

test('el poster conserva la proporcion y nunca cae a cero', () => {
  // Un video muy apaisado redondeaba el lado corto a 0 y el canvas lanza con una
  // dimension en cero.
  const m = medidaDelPoster(6000, 100);
  assert.equal(m.ancho, 600);
  assert.ok(m.alto >= 1, `alto fue ${m.alto}`);
});

// --------------------------------------------------------------------------
// Servir el video en desarrollo
// --------------------------------------------------------------------------

test('la ruta de un video se valida y dice con que tipo servirlo', () => {
  // El endpoint de dev sirve con el Content-Type que le diga esto. Un video servido
  // como image/webp no reproduce y no da error: el <video> se queda en blanco.
  assert.deepEqual(rutaDeVideo(`videos/${HASH}/video.mp4`), {
    clave: `videos/${HASH}/video.mp4`,
    tipo: 'video/mp4',
  });
  assert.deepEqual(rutaDeVideo(`videos/${HASH}/poster.webp`), {
    clave: `videos/${HASH}/poster.webp`,
    tipo: 'image/webp',
  });
});

test('cualquier otra ruta no es un video', () => {
  // Sin esto, cualquier objeto del balde seria descargable por su nombre: es la misma
  // razon por la que existe `claveDesdeRuta` para las imagenes.
  for (const mala of [
    `videos/${HASH}/otro.mp4`,
    `videos/${HASH}/video.webm`,
    `catalogo/${HASH}/w600.webp`,
    `videos/${HASH.toUpperCase()}/video.mp4`,
    `videos/../${HASH}/video.mp4`,
    'videos//video.mp4',
    '',
  ]) {
    assert.equal(rutaDeVideo(mala), null, mala);
  }
});

test('las URL publicas del video cuelgan de la misma base que las fotos', () => {
  assert.equal(urlVideo('https://r2.ejemplo', HASH), `https://r2.ejemplo/videos/${HASH}/video.mp4`);
  assert.equal(
    urlPoster('https://r2.ejemplo/', HASH),
    `https://r2.ejemplo/videos/${HASH}/poster.webp`
  );
});
