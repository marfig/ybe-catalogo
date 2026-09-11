import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

import { ejecutorD1 } from '../../../lib/d1.ts';
import { cuerpoJson, json, soloPost } from '../../../lib/http.ts';
import { corridaEnCurso, iniciarCorrida } from '../../../lib/scrape/corrida.ts';

/**
 * Abre la corrida de la reposición.
 *
 * Mismo motivo que `/api/scrape/abrir`: la cola no sale de un listado que se pida acá,
 * sino de los códigos que alguien pegó, así que hace falta un lugar donde declararse
 * antes de empezar y donde valga la guarda de la corrida en curso.
 *
 * LA REPOSICIÓN NO ESTÁ EXENTA DE LA GUARDA. Comparte `scrapes` con la importación y el
 * barrido justamente para eso: el paso de 1 request por segundo (§7.4) lo marca cada
 * pestaña por su cuenta, y dos recorridos a la vez —sea cual sea su tipo— se lo
 * duplican al proveedor sin que nadie se entere.
 */

interface Peticion {
  /** Cuántos códigos entran a esta corrida. Sólo para el registro. */
  total?: number;
}

const MENSAJE_OCUPADO: Record<string, string> = {
  barrido: 'Hay un barrido en curso. Dos recorridos a la vez le duplican el tráfico al proveedor.',
  importacion: 'Hay una importación en curso. Dos recorridos a la vez le duplican el tráfico al proveedor.',
  reposicion: 'Ya hay una reposición en curso. Se hace de a una para no duplicarle el tráfico al proveedor.',
};

export const POST: APIRoute = async ({ request }) => {
  const datos = await cuerpoJson<Peticion>(request);
  const ahora = new Date().toISOString();
  const ejecutar = ejecutorD1(env.DB);

  const abierta = await corridaEnCurso(ejecutar, { ahora });
  if (abierta) {
    return json(
      {
        error:
          MENSAJE_OCUPADO[abierta.tipo] ??
          'Hay otro recorrido en curso. Dos a la vez le duplican el tráfico al proveedor.',
      },
      409
    );
  }

  const scrapeId = await iniciarCorrida(ejecutar, {
    // La corrida guarda una URL, y la reposición no recorre una: se deja dicho qué fue.
    url: 'reposición manual',
    tipo: 'reposicion',
    paginas: Math.max(1, Number(datos?.total) || 1),
    ahora,
  });

  return json({ scrapeId });
};

export const ALL: APIRoute = () => soloPost();
