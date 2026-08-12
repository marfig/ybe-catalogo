import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

import { ejecutorD1 } from '../../../lib/d1.ts';
import { cuerpoJson, json, soloPost } from '../../../lib/http.ts';
import { corridaEnCurso, iniciarCorrida } from '../../../lib/scrape/corrida.ts';

/**
 * Abre la corrida de la migración.
 *
 * NO SE REUSA `/api/scrape/abrir` porque ése fija `tipo: 'barrido'` y
 * `url: 'barrido de bajas'`. Reusarlo dejaría el registro diciendo que corrió un barrido,
 * y `scrapes` es de dónde sale el resumen que alguien va a leer dentro de seis meses para
 * entender qué pasó con estos 189 productos.
 *
 * LO QUE SÍ SE REUSA ES LA GUARDA, que es la parte que importa: `corridaEnCurso` impide
 * que dos recorridos le peguen al proveedor a la vez. El paso de 1 request por segundo
 * (§7.4) lo marca cada pestaña por su cuenta, así que sin este 409 una migración y una
 * importación simultáneas duplican el tráfico sin que nadie se entere.
 */

interface Peticion {
  /** Cuántos productos trae el catálogo viejo. Sólo para el registro. */
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
          'Ya hay un recorrido en curso. Se hace de a uno para no duplicarle el tráfico al proveedor.',
      },
      409
    );
  }

  const scrapeId = await iniciarCorrida(ejecutar, {
    url: 'migracion del catalogo viejo',
    tipo: 'migracion',
    paginas: Math.max(1, Number(datos?.total) || 1),
    ahora,
  });

  return json({ scrapeId });
};

export const ALL: APIRoute = () => soloPost();
