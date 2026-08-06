import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

import { ejecutorD1 } from '../../lib/d1.ts';
import { datosDesdeFormulario, guardarImagen } from '../../lib/subida.ts';

/**
 * Recibe las derivadas que produjo el canvas del navegador y las guarda
 * (SPEC-etapa2 §8.3).
 *
 * La ruta es delgada a propósito: todo lo que puede salir mal —el formato del hash,
 * que los bytes sean WebP, el dedupe, la protección contra sobreescritura— vive en
 * `lib/subida.ts` con sus tests. Acá sólo está el HTTP.
 *
 * NO lleva su propia autenticación: el middleware valida el JWT de Access en **cada**
 * request, sin lista de rutas exentas, y esta es una más. Y el `multipart/form-data`
 * queda cubierto por `security.checkOrigin`, que rechaza los POST de formulario de
 * otro origen — necesario porque Access autentica con cookie (ver astro.config.mjs).
 */

/** Respuesta JSON sin caché: son datos de una persona autenticada. */
const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

export const POST: APIRoute = async ({ request }) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    // Un cuerpo que no es multipart llega acá: es un cliente mal escrito, no un
    // problema del servidor.
    return json({ error: 'Se esperaba un formulario multipart.' }, 400);
  }

  try {
    const datos = await datosDesdeFormulario(form);
    const resultado = await guardarImagen(
      { ejecutar: ejecutorD1(env.DB), balde: env.IMAGENES },
      datos,
      { ahora: new Date().toISOString() }
    );
    return json(resultado);
  } catch (error) {
    /**
     * 400 y no 500: todo lo que lanza `datosDesdeFormulario` y `validarSubida` es un
     * problema de lo que se mandó, no del servidor. El mensaje va al cuerpo porque
     * quien lo va a leer es la pantalla del admin, que lo muestra tal cual — están
     * escritos en castellano para eso.
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
