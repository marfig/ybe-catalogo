import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

import { ejecutorD1 } from '../../../lib/d1.ts';
import { cuerpoJson, json, soloPost } from '../../../lib/http.ts';
import { contarPendientes } from '../../../lib/scrape/cola.ts';
import { cerrarCorrida } from '../../../lib/scrape/corrida.ts';
import { vueltaActual } from '../../../lib/scrape/vuelta.ts';

/**
 * Cierra la corrida y devuelve el resumen de §10.2.
 *
 * `abortado` no es un error: es lo que corresponde cuando alguien corta la importación
 * a mitad de camino. Lo que ya entró en D1 queda — cada ficha se confirmó
 * individualmente (§7.1) — y volver a correr el scrape sigue desde donde estaba.
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
     * `pendientes` viaja con el resumen para que la pestaña pueda ofrecer seguir sin
     * recargar. Es la razón por la que este endpoint sabe algo de vueltas.
     *
     * `null` cuando no hay vuelta abierta: una selección tildada en la grilla no la mueve,
     * y no hay cuenta regresiva sobre la que ofrecer nada. Ver `continuarDespuesDe()`.
     *
     * TRY/CATCH PROPIO, Y NO ES DECORACIÓN. Para cuando corre esto, `cerrarCorrida` YA
     * escribió: la corrida está cerrada y el trabajo salió bien. Dejar que un error acá
     * caiga en el `catch` de abajo devolvería el 404 de «no existe la corrida», y el
     * cliente lo pinta como fallo duro —sin el conteo de revisados, sin las bajas
     * encontradas—. Un barrido perfecto reportado como roto es peor que no ofrecer el
     * enlace de seguir: manda a repetir media hora de trabajo que ya está hecho.
     *
     * Degradar a `null` es exactamente lo que `continuarDespuesDe()` sabe manejar: no
     * ofrece seguir, y la pantalla del barrido dice la verdad en la próxima visita.
     */
    let pendientes: number | null = null;
    try {
      const vuelta = await vueltaActual(ejecutar);
      if (vuelta !== null && vuelta.terminada_en === null) {
        pendientes = await contarPendientes(ejecutar, { desde: vuelta.iniciada_en });
      }
    } catch {
      // El cierre ya está hecho. Lo único que se pierde es el enlace de «seguir».
    }

    return json({ ...resumen, pendientes });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 404);
  }
};

export const ALL: APIRoute = () => soloPost();
