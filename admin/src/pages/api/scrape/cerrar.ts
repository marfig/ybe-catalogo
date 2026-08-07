import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

import { ejecutorD1 } from '../../../lib/d1.ts';
import { cuerpoJson, json, soloPost } from '../../../lib/http.ts';
import { cerrarCorrida } from '../../../lib/scrape/corrida.ts';

/**
 * Cierra la corrida y devuelve el resumen de §10.2.
 *
 * `abortado` no es un error: es lo que corresponde cuando alguien corta la importación
 * a mitad de camino. Lo que ya entró en D1 queda — cada ficha se confirmó
 * individualmente (§7.1) — y volver a correr el scrape sigue desde donde estaba.
 */

interface Peticion {
  scrapeId?: number;
  abortado?: boolean;
}

export const POST: APIRoute = async ({ request }) => {
  const datos = await cuerpoJson<Peticion>(request);
  if (typeof datos?.scrapeId !== 'number') return json({ error: 'Falta el scrapeId.' }, 400);

  try {
    const resumen = await cerrarCorrida(ejecutorD1(env.DB), datos.scrapeId, {
      ahora: new Date().toISOString(),
      estado: datos.abortado ? 'abortado' : 'terminado',
    });
    return json(resumen);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 404);
  }
};

export const ALL: APIRoute = () => soloPost();
