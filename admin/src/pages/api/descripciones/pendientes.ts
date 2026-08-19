import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

import { ejecutorD1 } from '../../../lib/d1.ts';
import { cuerpoJson, json, soloPost } from '../../../lib/http.ts';
import { corridaEnCurso, iniciarCorrida } from '../../../lib/scrape/corrida.ts';
import { sinDescripcion } from '../../../lib/scrape/pendientes.ts';

/**
 * La lista de productos sin descripción, y la corrida para rellenarlos.
 *
 * DEVUELVE LA LISTA Y ABRE LA CORRIDA EN UN SOLO PEDIDO, al revés que la importación, que
 * tiene `abrir` aparte. Acá no hay nada que elegir en el medio: la lista sale de la base y
 * no del proveedor, así que no cuesta tráfico y no hay decisión humana entre los dos pasos.
 * Dos endpoints para eso serían dos endpoints que después hay que borrar.
 *
 * NO ESCRIBE NINGUNA DESCRIPCIÓN. El relleno lo hace `/api/scrape/ficha`, que es el endpoint
 * de todos los días, con el `COALESCE(descripcion, ?)` de `registrarFicha` decidiendo si
 * escribe. Es a propósito: si el relleno funciona sobre estos productos, el arreglo del regex
 * queda probado sobre el camino que va a correr siempre, y no sobre uno hecho para la ocasión.
 *
 * ES CÓDIGO DE UN SOLO USO y se borra con su pantalla.
 */

interface Peticion {
  /** `true` para sólo contar, sin abrir corrida. Es lo que rinde la pantalla al entrar. */
  soloContar?: boolean;
}

export const POST: APIRoute = async ({ request }) => {
  const datos = await cuerpoJson<Peticion>(request);
  const ejecutar = ejecutorD1(env.DB);
  const ahora = new Date().toISOString();

  const pendientes = await sinDescripcion(ejecutar);

  if (datos?.soloContar === true) return json({ total: pendientes.length });

  if (pendientes.length === 0) {
    return json({ total: 0, productos: [] });
  }

  /**
   * LA MISMA GUARDA QUE LOS OTROS RECORRIDOS. El paso de 1 pedido por segundo (§7.4) lo marca
   * cada pestaña por su cuenta, así que sin este 409 un relleno y una importación simultáneos
   * le duplican el tráfico al proveedor sin que nadie se entere.
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
    // Queda dicho qué fue: `scrapes` es de dónde sale el resumen que alguien va a leer dentro
    // de seis meses para entender por qué estas fichas se visitaron dos veces.
    url: 'relleno de descripciones faltantes',
    tipo: 'importacion',
    paginas: pendientes.length,
    ahora,
  });

  return json({ scrapeId, total: pendientes.length, productos: pendientes });
};

export const ALL: APIRoute = () => soloPost();
