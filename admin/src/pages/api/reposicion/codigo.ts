import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

import { ejecutorD1 } from '../../../lib/d1.ts';
import { cuerpoJson, json, soloPost } from '../../../lib/http.ts';
import { resolverCodigo } from '../../../lib/reposicion.ts';
import { anotarError, contarRevisado } from '../../../lib/scrape/corrida.ts';

/**
 * Un código de la reposición.
 *
 * **Un código por invocación, siempre**, igual que `/api/scrape/presencia` y
 * `/api/scrape/ficha`: es la misma cortesía de §7.4, de a un pedido al proveedor por
 * vez, y `resolverCodigo` puede terminar pidiéndole al proveedor tanto el buscador
 * como una ficha entera.
 *
 * TODO LO QUE DECIDE VIVE EN `resolverCodigo` (`lib/reposicion.ts`), que es lo que
 * tiene tests. Acá sólo se valida la entrada, se anota el error si lo hay y se cuenta
 * el tráfico — la misma repartición que ya usan `presencia.ts` y `ficha.ts`.
 */

interface Peticion {
  scrapeId?: number;
  codigo?: string;
}

export const POST: APIRoute = async ({ request }) => {
  const datos = await cuerpoJson<Peticion>(request);
  if (typeof datos?.scrapeId !== 'number') return json({ error: 'Falta el scrapeId.' }, 400);
  if (typeof datos.codigo !== 'string' || datos.codigo.trim() === '') {
    return json({ error: 'Falta el código.' }, 400);
  }

  const ahora = new Date().toISOString();
  const ejecutar = ejecutorD1(env.DB);
  const { scrapeId, codigo } = datos;

  const resultado = await resolverCodigo(ejecutar, codigo, { scrapeId, ahora });

  /**
   * `error` es el único desenlace que sale de una excepción atrapada (una ficha que no
   * se pudo bajar): se anota igual que anota `/api/scrape/ficha`, para que quede
   * rastro en `scrape_errores` y la corrida siga sin cortarse (§7.4).
   */
  if (resultado.desenlace === 'error') {
    await anotarError(ejecutar, scrapeId, {
      url: resultado.url ?? codigo,
      motivo: resultado.motivo,
      ahora,
    });
  }

  /**
   * `invalido` NO cuenta como tráfico al proveedor: `resolverCodigo` corta antes de
   * preguntarle nada. Contarlo mediría un pedido que nunca salió.
   */
  if (resultado.desenlace !== 'invalido') await contarRevisado(ejecutar, scrapeId);

  return json(resultado);
};

export const ALL: APIRoute = () => soloPost();
