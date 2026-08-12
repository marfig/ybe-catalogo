import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

import { ejecutorD1 } from '../../../lib/d1.ts';
import { cuerpoJson, json, soloPost } from '../../../lib/http.ts';
import { candidatoPorId, marcar } from '../../../lib/scrape/cola.ts';
import { anotarError, contarRevisado } from '../../../lib/scrape/corrida.ts';
import { consultarPresencia } from '../../../lib/scrape/presencia.ts';

/**
 * ¿El proveedor sigue publicando este producto?
 *
 * **Un producto por invocación, siempre**, igual que `/api/scrape/ficha`: §7.3 midió el
 * margen de CPU en ~5× y prohíbe parsear varias páginas en un mismo request. La página
 * del buscador pesa ~55 KB, del mismo orden que una ficha.
 *
 * NO BORRA NI OCULTA NADA. Escribe dos fechas y devuelve el veredicto; sacar el
 * producto del catálogo es una decisión de persona, que se toma desde la grilla con el
 * flujo de eliminación de §12.2.
 */

interface Peticion {
  scrapeId?: number;
  /** El id del producto, no su código: el servidor no confía en la pestaña. */
  id?: number;
}

export const POST: APIRoute = async ({ request }) => {
  const datos = await cuerpoJson<Peticion>(request);
  if (typeof datos?.id !== 'number') return json({ error: 'Falta el id del producto.' }, 400);
  if (typeof datos.scrapeId !== 'number') return json({ error: 'Falta el scrapeId.' }, 400);

  const ahora = new Date().toISOString();
  const ejecutar = ejecutorD1(env.DB);
  const { scrapeId, id } = datos;

  /**
   * Se relee el producto en vez de creerle al cuerpo del pedido. La página rinde la
   * cola una vez y puede quedar abierta horas: para cuando llega este request, ese
   * producto puede haberse eliminado desde otra pestaña.
   */
  const candidato = await candidatoPorId(ejecutar, id);
  if (!candidato) {
    return json({ id, omitido: true, motivo: 'ya no está en la lista para revisar' });
  }

  const resultado = await consultarPresencia(candidato.codigo);

  /**
   * `indeterminado` va a `scrape_errores` y la corrida SIGUE, igual que una ficha caída
   * en la importación (§7.4). Que un barrido de 300 productos se corte entero porque el
   * proveedor tosió en el número 12 es peor que revisar 299 y listar el que no se pudo.
   */
  if (resultado.presencia === 'indeterminado') {
    await anotarError(ejecutar, scrapeId, {
      url: candidato.codigo,
      motivo: resultado.motivo,
      ahora,
    });
  }

  await marcar(ejecutar, candidato.id, {
    presencia: resultado.presencia,
    codigo: candidato.codigo,
    ahora,
    url: resultado.url,
  });

  // El revisado se cuenta aunque no se haya podido resolver: mide el trafico que se le
  // hizo al proveedor, que es lo que la cortesia de §7.4 cuida.
  await contarRevisado(ejecutar, scrapeId);

  return json({
    id: candidato.id,
    codigo: candidato.codigo,
    presencia: resultado.presencia,
    motivo: resultado.motivo,
  });
};

export const ALL: APIRoute = () => soloPost();
