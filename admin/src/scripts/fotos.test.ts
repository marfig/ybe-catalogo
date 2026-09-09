import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { traerFotos } from './fotos.ts';

/**
 * El recuento de `traerFotos`, que es lo que la pasada de revisión de galerías le muestra a
 * quien la corre: «N fotos que faltaban».
 *
 * POR QUÉ ESTE ARCHIVO EXISTE SIENDO EL ÚNICO TEST DE UN `scripts/`. El resto de esta carpeta
 * son pantallas: pegan un par de fetches y pintan el DOM, y su valor se ve usándolas. Esto es
 * distinto — es una DECISIÓN sobre dos formas de respuesta distintas:
 *
 *   - el puente (`/api/scrape/imagen`) responde JSON `{conocida, hash16, vinculada}` cuando
 *     ya conoce los bytes, y ahí los bytes no viajan
 *   - `/api/scrape/vincular` responde `{hash16, vinculada}` cuando la foto acaba de subirse
 *
 * Un `!==` en vez de un `===`, o que a cualquiera de los dos endpoints le renombren el campo,
 * invierte el conteo EN SILENCIO: la pantalla diría «0 fotos que faltaban» sobre una pasada
 * que agregó doscientas, o al revés. Y como el número es lo único que dice si la pasada sirvió
 * de algo, esa mentira no la atrapa nadie.
 *
 * SÓLO SE EJERCITA EL CAMINO DE LA FOTO YA CONOCIDA, que es el que devuelve JSON. El otro pasa
 * por `subirFotoDelOrigen` -> `OffscreenCanvas`, que no existe en Node; y es justamente el
 * camino que domina en esta pasada, porque la foto principal de cada variante YA está subida.
 */

/** Una respuesta JSON del puente, como la arma `admin/src/pages/api/scrape/imagen.ts`. */
function respuestaJson(cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), {
    headers: { 'Content-Type': 'application/json' },
  });
}

const fetchOriginal = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

/** Reemplaza `fetch` y anota cada URL pedida, en orden. */
function fingirFetch(respuestas: Response[]): { pedidos: string[] } {
  const pedidos: string[] = [];
  let i = 0;

  globalThis.fetch = (async (entrada: RequestInfo | URL, opciones?: RequestInit) => {
    const url = String(entrada);
    // El cuerpo trae la URL de la foto; es lo que interesa cuando algo se pide de más.
    const cuerpo = typeof opciones?.body === 'string' ? opciones.body : '';
    pedidos.push(`${url} ${cuerpo}`);
    const r = respuestas[i] ?? respuestaJson({});
    i += 1;
    return r;
  }) as typeof fetch;

  return { pedidos };
}

const sinCortesia = async (): Promise<void> => {};
const ignorarProblemas = (): void => {};

test('una foto que el puente vincula por primera vez cuenta como vinculada', async () => {
  fingirFetch([respuestaJson({ conocida: true, hash16: 'abc', vinculada: true })]);

  const recuento = await traerFotos(
    { codigo: 'CG85700', colores: [{ sku: 'CG85700-3', fotos: ['https://x/una.jpg'] }] },
    sinCortesia,
    ignorarProblemas
  );

  assert.deepEqual(recuento, { pedidas: 1, vinculadas: 1 });
});

test('una foto que YA estaba vinculada no cuenta', async () => {
  /**
   * ES EL CASO MAYORITARIO DE LA PASADA DE REVISIÓN: la foto principal de cada variante ya
   * está. Si contara igual, el resumen diría que encontró mil fotos nuevas cuando no encontró
   * ninguna, y la pasada dejaría de servir para lo único que sirve.
   */
  fingirFetch([respuestaJson({ conocida: true, hash16: 'abc', vinculada: false })]);

  const recuento = await traerFotos(
    { codigo: 'CG85700', colores: [{ sku: 'CG85700-3', fotos: ['https://x/una.jpg'] }] },
    sinCortesia,
    ignorarProblemas
  );

  assert.deepEqual(recuento, { pedidas: 1, vinculadas: 0 });
});

test('sin el campo vinculada NO se cuenta: se pregunta por true, no por «algo»', async () => {
  // Si el endpoint dejara de mandar el campo, el conteo tiene que caer a cero y no inventar.
  fingirFetch([respuestaJson({ conocida: true, hash16: 'abc' })]);

  const recuento = await traerFotos(
    { colores: [{ sku: 'CG85700-3', fotos: ['https://x/una.jpg'] }] },
    sinCortesia,
    ignorarProblemas
  );

  assert.deepEqual(recuento, { pedidas: 1, vinculadas: 0 });
});

test('una foto que falla se anota, no cuenta, y no tumba las demás', async () => {
  // `unaFoto` no lanza nunca (§7.4): una foto caída no puede perder la ficha entera.
  fingirFetch([
    respuestaJson({ error: 'La URL no es del proveedor.' }),
    respuestaJson({ conocida: true, hash16: 'b', vinculada: true }),
  ]);

  const problemas: string[] = [];
  const recuento = await traerFotos(
    {
      codigo: 'CG85700',
      colores: [{ sku: 'CG85700-3', fotos: ['https://x/mala.jpg', 'https://x/buena.jpg'] }],
    },
    sinCortesia,
    (que, motivo) => problemas.push(`${que}: ${motivo}`)
  );

  assert.deepEqual(recuento, { pedidas: 2, vinculadas: 1 });
  assert.equal(problemas.length, 1);
  // El SKU va en el aviso: «fallo una foto de CG85700» no dice cuál variante quedo corta.
  assert.match(problemas[0], /CG85700-3/);
});

test('el recuento suma TODOS los colores del modelo, no sólo el primero', async () => {
  /**
   * Las fotos de los colores hermanos vienen en la misma ficha. Si el recuento se quedara en
   * el primer color, la pasada reportaría de menos justo en los modelos de varios colores.
   */
  fingirFetch([
    respuestaJson({ vinculada: true }),
    respuestaJson({ vinculada: false }),
    respuestaJson({ vinculada: true }),
  ]);

  const recuento = await traerFotos(
    {
      codigo: 'CG85700',
      colores: [
        { sku: 'CG85700-3', fotos: ['https://x/1.jpg', 'https://x/2.jpg'] },
        { sku: 'CG85700-T', fotos: ['https://x/3.jpg'] },
      ],
    },
    sinCortesia,
    ignorarProblemas
  );

  assert.deepEqual(recuento, { pedidas: 3, vinculadas: 2 });
});

test('una ficha sin colores no pide nada', async () => {
  // Es el caso de un producto que el proveedor sirve sin foto: no hay nada que traer.
  const { pedidos } = fingirFetch([]);

  assert.deepEqual(await traerFotos({}, sinCortesia, ignorarProblemas), {
    pedidas: 0,
    vinculadas: 0,
  });
  assert.deepEqual(await traerFotos({ colores: [] }, sinCortesia, ignorarProblemas), {
    pedidas: 0,
    vinculadas: 0,
  });
  assert.deepEqual(pedidos, []);
});

test('la cortesía se espera una vez por foto: es el paso de 1 por segundo al proveedor', async () => {
  /**
   * Sin esto la pasada le pega al proveedor tan rápido como pueda. El paso lo marca esta
   * pestaña y nadie más, así que si se saltea no hay ningún lado donde se note.
   */
  fingirFetch([respuestaJson({ vinculada: true }), respuestaJson({ vinculada: true })]);

  let esperas = 0;
  await traerFotos(
    { colores: [{ sku: 'CG85700-3', fotos: ['https://x/1.jpg', 'https://x/2.jpg'] }] },
    async () => {
      esperas += 1;
    },
    ignorarProblemas
  );

  assert.equal(esperas, 2);
});

test('el puente por defecto es el del proveedor, y se puede cambiar por el del viejo', async () => {
  /**
   * Son dos orígenes con dos guardas distintas en el servidor: `/api/scrape/imagen` sólo
   * acepta URLs del proveedor. Mandar una foto del catálogo viejo por ahí la rebota.
   */
  const { pedidos } = fingirFetch([respuestaJson({ vinculada: true })]);
  await traerFotos(
    { colores: [{ sku: 'X-1', fotos: ['https://x/1.jpg'] }] },
    sinCortesia,
    ignorarProblemas
  );
  assert.match(pedidos[0], /^\/api\/scrape\/imagen /);

  const otro = fingirFetch([respuestaJson({ vinculada: true })]);
  await traerFotos(
    { colores: [{ sku: 'X-1', fotos: ['https://x/1.jpg'] }] },
    sinCortesia,
    ignorarProblemas,
    '/api/migracion/imagen'
  );
  assert.match(otro.pedidos[0], /^\/api\/migracion\/imagen /);
});
