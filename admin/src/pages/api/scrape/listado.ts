import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

import { ejecutorD1 } from '../../../lib/d1.ts';
import { cuerpoJson, json, soloPost } from '../../../lib/http.ts';
import { corridaEnCurso, iniciarCorrida } from '../../../lib/scrape/corrida.ts';
import { extraerListado } from '../../../lib/scrape/listado.ts';
import { codigoDesdeUrl } from '../../../lib/scrape/origen.ts';
import { codigosExistentes } from '../../../lib/scrape/registrar.ts';
import { leerRobots, permiteRuta } from '../../../lib/scrape/robots.ts';

/**
 * Una página del listado del proveedor (SPEC-etapa2 §7.2).
 *
 * Sirve las dos clases de listado, `/lanzamientos` y `/categoria/...`, y no se ramifica
 * por ninguna: qué acota el recorrido lo sabe `lib/scrape/listado.ts`. Acá la única
 * diferencia visible es `totalProductos`, que una categoría declara y un lanzamiento no.
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

  /**
   * Cuáles de estas fichas son de productos que YA tenemos.
   *
   * Va acá y no en un endpoint aparte porque es la misma unidad de trabajo: una página
   * del listado. Es UNA consulta a la base propia por página, y lo que ahorra son las
   * decenas de pedidos al proveedor que costaría descubrir lo mismo bajando cada ficha.
   *
   * El servidor sólo INFORMA. Saltearlas o no es decisión del navegador, según la
   * opción de la pantalla: acá no se conoce la intención de quien importa.
   */
  const codigos = listado.fichas.map(codigoDesdeUrl).filter((c): c is string => c !== null);
  const yaTengo = await codigosExistentes(ejecutar, [...new Set(codigos)]);

  return json({
    scrapeId,
    clase: listado.clase,
    fichas: listado.fichas,
    paginas: listado.paginas,
    totalPaginas: listado.totalPaginas,
    /**
     * Va crudo, sin convertirlo a páginas: cuántas son depende del tamaño de página, que
     * se aprende recorriendo y es estado del recorrido, no de una respuesta.
     */
    totalProductos: listado.totalProductos,
    robotsAusente: robots.ausente,
    yaTengo,
  });
};

export const ALL: APIRoute = () => soloPost();
