import { test } from 'node:test';
import assert from 'node:assert/strict';

import { despacharPublicacion, leerConfigDespacho } from './despacho.ts';

/** Tests del disparo a GitHub Actions (SPEC-etapa2 §11.2). */

const CONFIG = { repo: 'marvin/ybe', token: 'tok' };

function buscarFalso(estado: number, cuerpo = '') {
  const llamadas: Array<{ url: string; opciones: RequestInit }> = [];
  const buscar = (async (url: string, opciones: RequestInit) => {
    llamadas.push({ url, opciones });
    return { status: estado, text: async () => cuerpo } as unknown as Response;
  }) as unknown as typeof fetch;
  return { buscar, llamadas };
}

test('leerConfigDespacho: lista TODAS las que faltan', () => {
  assert.throws(
    () => leerConfigDespacho({}),
    (e: Error) => {
      assert.match(e.message, /GITHUB_REPO/);
      assert.match(e.message, /GITHUB_TOKEN/);
      return true;
    }
  );
});

test('despacha con el evento y el id de la publicacion', async () => {
  const { buscar, llamadas } = buscarFalso(204);
  await despacharPublicacion(CONFIG, 42, buscar);

  assert.equal(llamadas[0].url, 'https://api.github.com/repos/marvin/ybe/dispatches');
  assert.deepEqual(JSON.parse(llamadas[0].opciones.body as string), {
    event_type: 'publicar',
    // El id viaja para que el workflow sepa QUE fila reportar: con dos publicaciones
    // seguidas, sin esto el resultado podria ir contra el intento equivocado.
    client_payload: { publicacion: 42 },
  });
});

test('manda User-Agent, que GitHub exige', async () => {
  const { buscar, llamadas } = buscarFalso(204);
  await despacharPublicacion(CONFIG, 1, buscar);
  const headers = llamadas[0].opciones.headers as Record<string, string>;
  assert.ok(headers['User-Agent'], 'sin User-Agent GitHub rechaza el request');
  assert.equal(headers.Authorization, 'Bearer tok');
});

test('un 200 tambien es fallo: el dispatch exitoso es 204', async () => {
  // Tratar cualquier 2xx como exito dejaria pasar una respuesta que no es la que
  // GitHub documenta, y la publicacion quedaria en "pendiente" para siempre.
  const { buscar } = buscarFalso(200);
  await assert.rejects(() => despacharPublicacion(CONFIG, 1, buscar), /HTTP 200/);
});

test('un 404 sugiere revisar el repo, no los permisos', async () => {
  // Los dos fallos frecuentes se distinguen solo por el codigo, y mandan a mirar
  // lugares distintos.
  const { buscar } = buscarFalso(404);
  await assert.rejects(() => despacharPublicacion(CONFIG, 1, buscar), /GITHUB_REPO/);
});

test('un 403 sugiere revisar el token', async () => {
  const { buscar } = buscarFalso(403);
  await assert.rejects(() => despacharPublicacion(CONFIG, 1, buscar), /GITHUB_TOKEN/);
});
