import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

import { buscarPorCodigo } from '../../lib/codigo.ts';
import { ejecutorD1 } from '../../lib/d1.ts';
import {
  MAXIMO_BYTES,
  asignarVideo,
  datosDesdeFormularioVideo,
  guardarVideo,
  quitarVideo,
} from '../../lib/subida-video.ts';

/**
 * Sube el video de un producto y lo cuelga de él, o se lo saca.
 *
 * Delgado a propósito, igual que `api/imagenes.ts`: todo lo que puede salir mal —el
 * formato del hash, los magic bytes, el tope, el dedupe, la protección contra
 * sobreescritura— vive en `lib/subida-video.ts` con sus tests. Acá sólo está el HTTP.
 *
 * NO lleva su propia autenticación: el middleware valida el JWT de Access en **cada**
 * request, sin lista de rutas exentas, y esta es una más.
 */

/** Respuesta JSON sin caché: son datos de una persona autenticada. */
const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

/**
 * Margen sobre el tope del archivo para el resto del multipart: el poster, los campos
 * de texto y los separadores. Generoso porque no es la validación de verdad —esa la
 * hace `validarVideo` sobre los bytes reales— sino la que evita traer a memoria un
 * cuerpo que ya se sabe que se va a rechazar.
 */
const MAXIMO_CUERPO = MAXIMO_BYTES + 6 * 1024 * 1024;

export const POST: APIRoute = async ({ request }) => {
  /**
   * EL TAMAÑO SE MIRA ANTES DE LEER EL CUERPO.
   *
   * Es lo único que este endpoint tiene y el de imágenes no, y el motivo es el peso:
   * una derivada son 50 kB y un video 10 MB. `request.formData()` trae todo a memoria,
   * así que sin esta guarda alguien podría hacer que el Worker levante cientos de
   * megas antes de que la validación llegue a decir que no.
   *
   * `Content-Length` lo pone el navegador y se puede mentir, por eso NO reemplaza a
   * `validarVideo`: sólo evita el trabajo cuando el cliente dice la verdad, que es el
   * caso normal.
   */
  const largo = Number(request.headers.get('Content-Length') ?? '0');
  if (Number.isFinite(largo) && largo > MAXIMO_CUERPO) {
    const mb = (largo / 1024 / 1024).toFixed(1);
    return json(
      {
        error:
          `El video pesa ${mb} MB y el tope son ${MAXIMO_BYTES / 1024 / 1024} MB. ` +
          'Mandátelo por WhatsApp y subí el que te llega: queda liviano y se ve igual.',
      },
      413
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'Se esperaba un formulario multipart.' }, 400);
  }

  const ejecutar = ejecutorD1(env.DB);
  const ahora = new Date().toISOString();

  try {
    // Sacar el video no manda archivos: es el mismo endpoint porque es el mismo
    // recurso, y así la pantalla no tiene que conocer dos rutas.
    if (form.get('accion') === 'quitar') {
      const producto = await buscarPorCodigo(ejecutar, String(form.get('codigo') ?? ''));
      if (!producto) return json({ error: 'No existe ese producto.' }, 404);
      await quitarVideo(ejecutar, { productoId: producto.id, ahora });
      return json({ quitado: true });
    }

    const datos = await datosDesdeFormularioVideo(form);

    /**
     * El producto se busca ANTES de subir. Subir primero y descubrir después que el
     * código no existe dejaría un objeto de 10 MB en R2 sin fila que lo referencie —
     * justo la basura invisible que la recolección de huérfanas no puede ver, porque
     * sin fila en `videos` no hay nada que la delate.
     */
    const producto = await buscarPorCodigo(ejecutar, datos.codigo);
    if (!producto) return json({ error: `No existe el producto ${datos.codigo}.` }, 404);

    const resultado = await guardarVideo({ ejecutar, balde: env.IMAGENES }, datos, { ahora });
    await asignarVideo(ejecutar, {
      productoId: producto.id,
      hash16: resultado.hash16,
      ahora,
    });

    return json(resultado);
  } catch (error) {
    /**
     * 400 y no 500: todo lo que lanza el parseo y la validación es un problema de lo
     * que se mandó. El mensaje va al cuerpo porque quien lo lee es la pantalla del
     * admin, que lo muestra tal cual — están escritos en castellano para eso.
     */
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
};

/**
 * Cualquier otro método responde 405 con `Allow`, en vez del 404 que daría Astro.
 * Un 404 en un endpoint que existe manda a buscar el problema al lugar equivocado.
 */
export const ALL: APIRoute = () =>
  new Response('Sólo POST.', { status: 405, headers: { Allow: 'POST' } });
