/**
 * Las URL del video de un producto.
 *
 * MÓDULO APARTE DE `imagenes.ts`, y no por prolijidad. Ese módulo está construido sobre
 * un contrato que el video no cumple: `urlImagen` exige un ancho de la lista `anchos` y
 * arma `w{ancho}.webp`, porque una imagen del catálogo SIEMPRE tiene derivadas. El video
 * no tiene ninguna — el navegador puede redimensionar una imagen pero no transcodificar
 * un video, así que el archivo es uno solo y entra tal cual se subió.
 *
 * Meterlo ahí habría significado agregarle una excepción a cada función de un módulo que
 * hoy no tiene ninguna. Lo único que se comparte es `validarBaseR2`, que es de dónde se
 * lee, no qué se lee.
 */
import { validarBaseR2 } from './imagenes.ts';

/** La forma que emite el volcado y valida `content.config.ts`. */
export interface Video {
  base: string;
  ancho: number;
  alto: number;
}

/**
 * `videos/{16 hex}`, la misma forma que declara el schema de la colección.
 *
 * Se revalida acá aunque el build ya lo haya hecho, por el mismo motivo que
 * `claveDeImagen` valida un hash que viene de la base: es la función que construye la
 * URL, y una clave que se escape del prefijo `videos/` apuntaría a cualquier objeto del
 * bucket.
 */
const RE_BASE = /^videos\/[0-9a-f]{16}$/;

function verificar(video: Video): string {
  if (!RE_BASE.test(video.base)) {
    throw new Error(`clave de video mal formada: ${JSON.stringify(video.base)}.`);
  }
  return video.base;
}

function unir(r2Base: string, resto: string): string {
  return `${validarBaseR2(r2Base).replace(/\/+$/, '')}/${resto}`;
}

/** El archivo que reproduce el `<video>`. */
export function urlVideo(r2Base: string, video: Video): string {
  return unir(r2Base, `${verificar(video)}/video.mp4`);
}

/**
 * El cuadro que se muestra antes de darle play.
 *
 * Se DERIVA del mismo `base` que el video en vez de viajar como un campo propio: una
 * sola fila en la base es dueña de los dos objetos en R2, así que dos campos serían el
 * mismo dato escrito dos veces, con la posibilidad de que discrepen.
 */
export function urlPoster(r2Base: string, video: Video): string {
  return unir(r2Base, `${verificar(video)}/poster.webp`);
}
