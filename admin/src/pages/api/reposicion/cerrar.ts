import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

import { ejecutorD1 } from '../../../lib/d1.ts';
import { cuerpoJson, json, soloPost } from '../../../lib/http.ts';
import { productosDeCorrida } from '../../../lib/reposicion.ts';
import { cerrarCorrida } from '../../../lib/scrape/corrida.ts';

/**
 * Cierra la corrida de la reposición y devuelve, junto con el resumen de §10.2, el
 * worklist de lo que tocó: no hay tabla nueva para eso, es una consulta por
 * `scrape_id` (`productosDeCorrida`), y viaja acá para que la pantalla no tenga que
 * pedirlo aparte.
 *
 * `abortado` no es un error: es lo que corresponde si alguien corta la reposición a
 * mitad de camino. Lo que ya entró en D1 queda — cada código se resuelve solo — y no
 * hay «seguir» que ofrecer: a diferencia del barrido, acá no hay una cola que continuar,
 * cada código pegado se pide una sola vez.
 */

interface Peticion {
  scrapeId?: number;
  abortado?: boolean;
}

export const POST: APIRoute = async ({ request }) => {
  const datos = await cuerpoJson<Peticion>(request);
  if (typeof datos?.scrapeId !== 'number') return json({ error: 'Falta el scrapeId.' }, 400);

  try {
    const ejecutar = ejecutorD1(env.DB);
    const resumen = await cerrarCorrida(ejecutar, datos.scrapeId, {
      ahora: new Date().toISOString(),
      estado: datos.abortado ? 'abortado' : 'terminado',
    });

    /**
     * TRY/CATCH PROPIO, igual que `/api/scrape/cerrar` con la vuelta: para cuando corre
     * esto, `cerrarCorrida` YA escribió y el trabajo salió bien. Que un tropiezo acá
     * tire un 404 de «no existe la corrida» reportaría como roto un cierre que en
     * realidad funcionó — lo único que se perdería es el listado de qué se repuso.
     */
    let productos: Awaited<ReturnType<typeof productosDeCorrida>> = [];
    try {
      productos = await productosDeCorrida(ejecutar, datos.scrapeId);
    } catch {
      // El cierre ya está hecho.
    }

    return json({ ...resumen, productos });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 404);
  }
};

export const ALL: APIRoute = () => soloPost();
