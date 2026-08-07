/**
 * Lo mínimo compartido entre los endpoints del admin.
 *
 * No es una capa de framework: son dos helpers que se repetían en cada ruta y que
 * conviene que digan lo mismo en todas.
 */

/** Respuesta JSON sin caché: son datos de una sola persona autenticada. */
export const json = (cuerpo: unknown, status = 200): Response =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

/**
 * 405 con `Allow`, en vez del 404 que daría Astro.
 *
 * Un 404 en un endpoint que SÍ existe manda a buscar el problema al lugar equivocado.
 */
export const soloPost = (): Response =>
  new Response('Sólo POST.', { status: 405, headers: { Allow: 'POST' } });

/** Lee el cuerpo JSON. Devuelve `null` si no era JSON: es un cliente mal escrito. */
export async function cuerpoJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
