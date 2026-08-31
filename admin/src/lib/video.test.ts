import assert from 'node:assert/strict';
import { test } from 'node:test';

import { claveDePoster, claveDeVideo, clavesDeVideo } from './video.ts';

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
