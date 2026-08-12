import type { APIRoute } from 'astro';

import { cuerpoJson, json, soloPost } from '../../../lib/http.ts';
import { consultarPresencia } from '../../../lib/scrape/presencia.ts';

/**
 * ¿El proveedor todavía publica este código?
 *
 * POR QUÉ NO SIRVE `/api/scrape/presencia`, que hace exactamente esta pregunta: ése
 * recibe el **id de un producto** de nuestra base y le escribe las dos fechas del
 * barrido. Los 368 códigos del catálogo viejo NO existen en la base todavía — averiguar
 * si vale la pena traerlos es justamente el paso anterior a crearlos.
 *
 * Así que este endpoint comparte la lógica —`consultarPresencia`, con sus tests— y no
 * toca D1 en absoluto. Es sólo lectura: no escribe, no crea, no marca.
 *
 * Medido el 2026-08-12 sobre los 368: 189 presentes, 179 ausentes, 0 indeterminados. Un
 * `indeterminado` NO es una baja (ver `presencia.ts`): la pantalla lo cuenta aparte y no
 * lo importa, y en la próxima corrida se vuelve a preguntar.
 */

interface Peticion {
  codigo?: string;
}

export const POST: APIRoute = async ({ request }) => {
  const datos = await cuerpoJson<Peticion>(request);
  const codigo = typeof datos?.codigo === 'string' ? datos.codigo.trim() : '';
  if (!codigo) return json({ error: 'Falta el código.' }, 400);

  try {
    const resultado = await consultarPresencia(codigo);
    return json({
      codigo: resultado.codigo,
      presencia: resultado.presencia,
      motivo: resultado.motivo,
      // La ficha que lo prueba vivo. Es el puente al importador: de acá sale la URL que
      // despues recibe `/api/scrape/ficha`.
      url: resultado.url,
    });
  } catch (error) {
    /**
     * Un fallo de red es `indeterminado`, no `ausente`. La diferencia es la que sostiene
     * todo el barrido: un mal día del proveedor no puede parecer un catálogo discontinuado.
     */
    return json({
      codigo,
      presencia: 'indeterminado',
      motivo: error instanceof Error ? error.message : String(error),
      url: null,
    });
  }
};

export const ALL: APIRoute = () => soloPost();
