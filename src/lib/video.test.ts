import assert from 'node:assert/strict';
import { test } from 'node:test';

import { urlPoster, urlVideo } from './video.ts';

const VIDEO = { base: 'videos/bbbbbbbbbbbbbbbb', ancho: 720, alto: 1280 };

test('la URL del video sale del base tal como lo escribe el volcado', () => {
  assert.equal(
    urlVideo('https://cdn.ybe.test', VIDEO),
    'https://cdn.ybe.test/videos/bbbbbbbbbbbbbbbb/video.mp4'
  );
});

test('el poster cuelga del mismo prefijo que el video', () => {
  // Una sola fila en la base es dueña de los dos objetos, y el poster se DERIVA del
  // mismo hash. No hay un campo aparte que pueda discrepar.
  assert.equal(
    urlPoster('https://cdn.ybe.test', VIDEO),
    'https://cdn.ybe.test/videos/bbbbbbbbbbbbbbbb/poster.webp'
  );
});

test('una barra de más en la base no duplica la barra', () => {
  assert.equal(
    urlVideo('https://cdn.ybe.test/', VIDEO),
    'https://cdn.ybe.test/videos/bbbbbbbbbbbbbbbb/video.mp4'
  );
});

test('la base de desarrollo es una ruta de raíz y también sirve', () => {
  // En `astro dev` las imágenes salen de `/img-dev`, que es una ruta y no una URL.
  assert.equal(urlVideo('/img-dev', VIDEO), '/img-dev/videos/bbbbbbbbbbbbbbbb/video.mp4');
});

test('una base vacía falla en vez de emitir una URL rota', () => {
  // Misma guarda que las imágenes: `src="/videos/…"` no daría ningún error, daría un
  // <video> en blanco en producción.
  assert.throws(() => urlVideo('', VIDEO), /PUBLIC_R2_BASE/);
});

test('un base que no es una clave de video no arma URL', () => {
  // El schema de la colección ya lo valida en el build. Esto es la segunda puerta: si
  // alguna vez se construye un video a mano, no puede apuntar fuera de `videos/`.
  for (const malo of ['catalogo/bbbbbbbbbbbbbbbb', 'videos/../etc', 'videos/BBBB', '']) {
    assert.throws(
      () => urlVideo('https://cdn.ybe.test', { ...VIDEO, base: malo }),
      /clave de video/i,
      malo
    );
  }
});
