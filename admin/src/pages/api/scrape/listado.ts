import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

import { ejecutorD1 } from '../../../lib/d1.ts';
import { cuerpoJson, json, soloPost } from '../../../lib/http.ts';
import { corridaEnCurso, iniciarCorrida } from '../../../lib/scrape/corrida.ts';
import { extraerListado } from '../../../lib/scrape/listado.ts';
import { leerRobots, permiteRuta } from '../../../lib/scrape/robots.ts';

/**
 * Una página del listado de lanzamientos (SPEC-etapa2 §7.2).
 *
 * Devuelve las fichas de esta página y el total de páginas del lanzamiento. El bucle
 * lo maneja el navegador (§7.1): este endpoint no encadena nada, porque el presupuesto
 * de CPU es de 10 ms con margen ~5× y §7.3 prohíbe explícitamente encadenar el listado
 * con sus fichas en una sola invocación.
 *
 * La ruta es delgada: todo lo que decide vive en `lib/scrape/` con sus tests.
 */

interface Peticion {
  url?: string;
  /** Ausente en la primera página: es lo que abre la corrida. */
  scrapeId?: number;
}

export const POST: APIRoute = async ({ request }) => {
  const datos = await cuerpoJson<Peticion>(request);
  if (!datos?.url) return json({ error: 'Falta la URL del listado.' }, 400);

  const ahora = new Date().toISOString();
  const ejecutar = ejecutorD1(env.DB);

  /**
   * `robots.txt` primero (§7.4). Hoy el sitio devuelve 404 —sin exclusiones— pero el
   * chequeo se hace igual: un scraper que sólo respeta las reglas que midió una vez es
   * un scraper que las ignora el día que aparecen.
   */
  const robots = await leerRobots();
  if (!permiteRuta(robots.reglas, datos.url)) {
    return json({ error: 'El robots.txt del proveedor no permite pedir esta URL.' }, 403);
  }

  let listado;
  try {
    listado = await extraerListado(datos.url);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }

  let scrapeId = datos.scrapeId ?? null;

  if (scrapeId === null) {
    /**
     * Dos pestañas scrapeando a la vez DUPLICAN el paso al proveedor, y el límite de 1
     * request por segundo lo marca el navegador. No es desprolijidad: rompe la
     * cortesía de §7.4 sin que nadie se entere.
     */
    const abierta = await corridaEnCurso(ejecutar, { ahora });
    if (abierta) {
      return json(
        {
          error: `Ya hay una importación en curso desde ${abierta.iniciado_en}. Esperá a que termine o cerrala.`,
          scrapeId: abierta.id,
        },
        409
      );
    }

    scrapeId = await iniciarCorrida(ejecutar, {
      url: listado.url,
      paginas: listado.totalPaginas,
      ahora,
    });
  }

  return json({
    scrapeId,
    fichas: listado.fichas,
    paginas: listado.paginas,
    totalPaginas: listado.totalPaginas,
    robotsAusente: robots.ausente,
  });
};

export const ALL: APIRoute = () => soloPost();
