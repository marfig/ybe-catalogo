import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

import { ejecutorD1 } from '../../../lib/d1.ts';
import { cuerpoJson, json, soloPost } from '../../../lib/http.ts';
import { corridaEnCurso, iniciarCorrida } from '../../../lib/scrape/corrida.ts';
import { sinFotos } from '../../../lib/scrape/sin-fotos.ts';

/**
 * La lista de productos sin fotos, y la corrida para conseguírselas.
 *
 * DEVUELVE LA LISTA Y ABRE LA CORRIDA EN UN SOLO PEDIDO, igual que el relleno de
 * descripciones y al revés que la importación, que tiene `abrir` aparte. Acá no hay nada
 * que elegir en el medio: la lista sale de la base propia y no del proveedor, así que no
 * cuesta tráfico y no hay decisión humana entre los dos pasos.
 *
 * NO SUBE NINGUNA FOTO. El trabajo lo hacen `/api/scrape/ficha` —que devuelve las URLs de
 * las fotos de cada color— y `traerFotos` desde la pestaña, que son los dos pasos de la
 * importación de todos los días. Es a propósito: la reparación corre por el mismo camino
 * que va a correr siempre, y no por uno hecho para la ocasión que puede divergir.
 */

interface Peticion {
  /** `true` para sólo contar, sin abrir corrida. Es lo que rinde la pantalla al entrar. */
  soloContar?: boolean;
}

export const POST: APIRoute = async ({ request }) => {
  const datos = await cuerpoJson<Peticion>(request);
  const ejecutar = ejecutorD1(env.DB);
  const ahora = new Date().toISOString();

  const pendientes = await sinFotos(ejecutar);

  if (datos?.soloContar === true) return json({ total: pendientes.length });

  if (pendientes.length === 0) {
    return json({ total: 0, productos: [] });
  }

  /**
   * LA MISMA GUARDA QUE LOS OTROS RECORRIDOS. El paso de 1 pedido por segundo (§7.4) lo
   * marca cada pestaña por su cuenta, así que sin este 409 una reparación y una importación
   * simultáneas le duplican el tráfico al proveedor sin que nadie se entere.
   */
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
    // Queda dicho qué fue: `scrapes` es de dónde sale el resumen que alguien va a leer
    // dentro de seis meses para entender por qué estas fichas se visitaron de nuevo.
    url: 'recuperación de fotos faltantes',
    tipo: 'importacion',
    paginas: pendientes.length,
    ahora,
  });

  return json({ scrapeId, total: pendientes.length, productos: pendientes });
};

export const ALL: APIRoute = () => soloPost();
