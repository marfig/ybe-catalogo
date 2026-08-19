import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

import { ejecutorD1 } from '../../../lib/d1.ts';
import { cuerpoJson, json, soloPost } from '../../../lib/http.ts';
import { hash16De } from '../../../lib/imagenes.ts';
import { esDelCdnViejo } from '../../../lib/migracion/parse.ts';
import { USER_AGENT } from '../../../lib/scrape/ficha.ts';
import { vincularImagen } from '../../../lib/scrape/registrar.ts';

/**
 * Trae una foto del catálogo viejo y decide si hay que procesarla (SPEC-etapa2 §8.1).
 *
 * ES EL MISMO PUENTE QUE `/api/scrape/imagen`, con UN cambio: el origen permitido. Ése sólo
 * acepta URLs del proveedor, y estas fotos vienen del CDN del catálogo viejo — que es
 * justamente el punto de esta migración, porque estos 177 productos no tienen ficha en el
 * proveedor de dónde sacar fotos.
 *
 * POR QUÉ NO SE LE AGREGA UN SEGUNDO ORIGEN AL DE TODOS LOS DÍAS. `/api/scrape/imagen` es
 * código que corre en cada importación, y su guarda de origen es lo único que lo separa de
 * ser un proxy abierto detrás de Access. Ampliarla deja para siempre un permiso que hacía
 * falta una sola vez. Este archivo se borra con el resto de `migracion/` cuando los 177 estén
 * dentro, y con él el permiso.
 *
 * El reparto de trabajo, idéntico al de siempre:
 *
 *   1. El Worker baja la imagen y **hashea los bytes originales**.
 *   2. Si el hash ya está en la base, la vincula y termina. La imagen NO viaja.
 *   3. Si es nueva, devuelve los bytes crudos. El navegador deriva w300/w600 con canvas,
 *      los sube a `/api/imagenes` y después llama a `/api/scrape/vincular`.
 *
 * El paso 2 es lo que hace barato repetir una corrida, y acá además dedupea contra las fotos
 * que ya subió el proveedor: una foto idéntica no se guarda dos veces.
 *
 * El hash se calcula sobre el ORIGINAL y nunca sobre el WebP que produce el navegador: el
 * encoder varía entre navegadores y hashear la salida rompería el dedupe.
 */

interface Peticion {
  /** Variante a la que pertenece la foto. */
  sku?: string;
  url?: string;
}

/** Tope de descarga. Las fotos medidas del catálogo viejo rondan los 70–95 KB; 8 MB corta lo absurdo. */
const MAXIMO_BYTES = 8 * 1024 * 1024;

export const POST: APIRoute = async ({ request }) => {
  const datos = await cuerpoJson<Peticion>(request);
  if (!datos?.url) return json({ error: 'Falta la URL de la imagen.' }, 400);
  if (!datos.sku) return json({ error: 'Falta el SKU de la variante.' }, 400);
  if (!esDelCdnViejo(datos.url)) {
    return json({ error: 'La URL no es del catálogo viejo.' }, 403);
  }

  const ejecutar = ejecutorD1(env.DB);

  let respuesta: Response;
  try {
    respuesta = await fetch(datos.url, { headers: { 'User-Agent': USER_AGENT } });
  } catch (error) {
    return json({ error: `No se pudo bajar la imagen: ${String(error)}` }, 502);
  }
  if (!respuesta.ok) return json({ error: `HTTP ${respuesta.status} al bajar la imagen.` }, 502);

  const tipo = respuesta.headers.get('Content-Type') ?? 'application/octet-stream';
  if (!tipo.startsWith('image/')) {
    // Una página de error del CDN llega con 200 y `text/html`. Hashearla guardaría basura
    // con apariencia de foto.
    return json({ error: `Eso no es una imagen: ${tipo}.` }, 502);
  }

  const bytes = await respuesta.arrayBuffer();
  if (bytes.byteLength === 0) return json({ error: 'La imagen vino vacía.' }, 502);
  if (bytes.byteLength > MAXIMO_BYTES) {
    return json({ error: `La imagen pesa ${Math.round(bytes.byteLength / 1024)} KB.` }, 413);
  }

  const hash16 = await hash16De(bytes);

  const [conocida] = await ejecutar<{ hash16: string }>(
    `SELECT hash16 FROM imagenes WHERE hash16 = ?`,
    [hash16]
  );

  if (conocida) {
    // Ya está procesada: sólo falta que sea de esta variante. Los bytes no viajan.
    try {
      const { vinculada } = await vincularImagen(ejecutar, { sku: datos.sku, hash16 });
      return json({ conocida: true, hash16, vinculada });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  /**
   * Nueva: viajan los bytes. El hash va en un header y no en el cuerpo porque el cuerpo ES
   * la imagen — el navegador la pasa directo al canvas sin decodificar JSON.
   */
  return new Response(bytes, {
    headers: {
      'Content-Type': tipo,
      'Content-Length': String(bytes.byteLength),
      'X-Hash16': hash16,
      'Cache-Control': 'no-store',
    },
  });
};

export const ALL: APIRoute = () => soloPost();
