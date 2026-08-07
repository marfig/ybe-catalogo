import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

import { ejecutorD1 } from '../../../lib/d1.ts';
import { cuerpoJson, json, soloPost } from '../../../lib/http.ts';
import { vincularImagen } from '../../../lib/scrape/registrar.ts';

/**
 * Ata una imagen ya subida a su variante (SPEC-etapa2 §8.1).
 *
 * Es el último paso del viaje de una foto nueva: el navegador derivó w300/w600 con
 * canvas y las subió a `/api/imagenes`, que registra el CONTENIDO. Esto dice de quién
 * es — y es un paso aparte porque la misma foto puede pertenecer a variantes de
 * distintos productos, que es el caso de dedupe de `SPEC.md` §6.8.
 *
 * Idempotente: repetirlo no duplica ni reordena.
 */

interface Peticion {
  sku?: string;
  hash16?: string;
}

export const POST: APIRoute = async ({ request }) => {
  const datos = await cuerpoJson<Peticion>(request);
  if (!datos?.sku) return json({ error: 'Falta el SKU de la variante.' }, 400);
  if (!datos.hash16) return json({ error: 'Falta el hash de la imagen.' }, 400);

  try {
    const resultado = await vincularImagen(ejecutorD1(env.DB), {
      sku: datos.sku,
      hash16: datos.hash16,
    });
    return json({ hash16: datos.hash16, ...resultado });
  } catch (error) {
    // Todo lo que lanza `vincularImagen` es un problema de lo que se mandó.
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
};

export const ALL: APIRoute = () => soloPost();
