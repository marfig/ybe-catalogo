import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

import { ejecutorD1 } from '../../../lib/d1.ts';
import { cuerpoJson, json, soloPost } from '../../../lib/http.ts';
import { corridaEnCurso, iniciarCorrida } from '../../../lib/scrape/corrida.ts';

/**
 * Abre la corrida del barrido.
 *
 * La importación no tiene un endpoint así porque abre la suya al pedir la primera
 * página del listado. El barrido no pide ningún listado: su cola sale de la base
 * propia, así que necesita un lugar donde declararse antes de empezar.
 *
 * LA GUARDA DE LA CORRIDA ABIERTA ES EL MOTIVO DE QUE ESTO EXISTA, más que el registro.
 * Dos recorridos simultáneos duplican el paso al proveedor, y el límite de 1 request
 * por segundo (§7.4) lo marca cada pestaña por su cuenta: sin este 409, dos pestañas
 * abiertas rompen la cortesía sin que nadie se entere.
 */

interface Peticion {
  /** Cuántos productos entran a esta corrida. Sólo para el registro. */
  total?: number;
}

export const POST: APIRoute = async ({ request }) => {
  const datos = await cuerpoJson<Peticion>(request);
  const ahora = new Date().toISOString();
  const ejecutar = ejecutorD1(env.DB);

  const abierta = await corridaEnCurso(ejecutar, { ahora });
  if (abierta) {
    return json(
      {
        error:
          abierta.tipo === 'barrido'
            ? 'Ya hay un barrido en curso. Se hace de a uno para no duplicarle el tráfico al proveedor.'
            : 'Hay una importación en curso. Esperá a que termine: dos recorridos a la vez le duplican el tráfico al proveedor.',
      },
      409
    );
  }

  const scrapeId = await iniciarCorrida(ejecutar, {
    // La corrida guarda una URL, y el barrido no recorre una: se deja dicho qué fue.
    url: 'barrido de bajas',
    tipo: 'barrido',
    paginas: Math.max(1, Number(datos?.total) || 1),
    ahora,
  });

  return json({ scrapeId });
};

export const ALL: APIRoute = () => soloPost();
