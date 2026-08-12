import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

import { ejecutorD1 } from '../../../lib/d1.ts';
import { cuerpoJson, json, soloPost } from '../../../lib/http.ts';
import { aplicarCuraduria } from '../../../lib/migracion/aplicar.ts';
import { curaduriaDeHtml, esDelOrigenViejo } from '../../../lib/migracion/viejo.ts';
import { USER_AGENT } from '../../../lib/scrape/ficha.ts';

/**
 * Nombre, precio y descripción del catálogo viejo, sobre un producto ya importado.
 *
 * ES EL ÚNICO ENDPOINT DE TODA LA MIGRACIÓN QUE ESCRIBE CURADURÍA, y la guarda no está
 * acá: está en `aplicarCuraduria`, que es lo que tiene tests contra el esquema real.
 * Acá sólo se baja la página y se decide poco, igual que `ficha.ts` con `extractor.ts`.
 *
 * VA POR EL WORKER Y NO POR LA PESTAÑA porque `catalogst.com` no manda cabeceras CORS:
 * el navegador no puede pedirle nada. No es una elección de diseño, es la única forma.
 */

interface Peticion {
  /** El id del producto en NUESTRA base, el que devolvió `/api/scrape/ficha`. */
  id?: number;
  /** La ficha del catálogo viejo, tal como salió del sitemap. */
  urlVieja?: string;
}

export const POST: APIRoute = async ({ request }) => {
  const datos = await cuerpoJson<Peticion>(request);
  if (typeof datos?.id !== 'number') return json({ error: 'Falta el id del producto.' }, 400);

  const urlVieja = typeof datos.urlVieja === 'string' ? datos.urlVieja : '';

  /**
   * La URL viene de la pestaña, así que se valida el origen. Sin esto el endpoint sería
   * un proxy abierto: cualquiera que pase por Access podría hacerle pedir cualquier host
   * desde dentro de la red de Cloudflare. Misma regla que `esDelOrigen` con el proveedor.
   */
  if (!esDelOrigenViejo(urlVieja)) {
    return json({ error: 'La URL no es del catálogo viejo.' }, 400);
  }

  let html: string;
  try {
    const respuesta = await fetch(urlVieja, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      redirect: 'follow',
    });
    if (!respuesta.ok) {
      return json({ id: datos.id, curado: false, error: `El catálogo viejo respondió HTTP ${respuesta.status}.` });
    }
    html = await respuesta.text();
  } catch (error) {
    return json({
      id: datos.id,
      curado: false,
      error: `No se pudo leer la ficha vieja: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  /**
   * Sin el `Product` del JSON-LD no se adivina nada. Fallo TOLERANTE: el producto ya
   * entró con sus fotos y variantes desde el proveedor, y queda en la grilla como algo
   * que falta completar. Cortar la corrida por una ficha vieja rara sería peor.
   */
  const curaduria = curaduriaDeHtml(html);
  if (!curaduria) {
    return json({ id: datos.id, curado: false, error: 'La ficha vieja no trae los datos esperados.' });
  }

  const ejecutar = ejecutorD1(env.DB);
  const curado = await aplicarCuraduria(ejecutar, datos.id, curaduria, {
    ahora: new Date().toISOString(),
  });

  /**
   * `curado: false` sin `error` NO es un fallo: es un producto que ya tenía nombre —o
   * porque lo escribió una persona, o porque una corrida anterior lo curó— y la guarda lo
   * dejó intacto. La pantalla lo cuenta aparte para que se vea la diferencia.
   */
  return json({
    id: datos.id,
    curado,
    nombre: curaduria.nombre,
    precio: curaduria.precio,
    conDescripcion: curaduria.descripcion !== null,
  });
};

export const ALL: APIRoute = () => soloPost();
