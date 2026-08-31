/**
 * Las claves de R2 del video de un producto. Una sola definición.
 *
 * Módulo aparte de `imagenes.ts` a propósito, y no por prolijidad: ese módulo está
 * construido sobre un contrato que el video no cumple. `claveDeImagen` exige un ancho
 * de `ANCHOS` y arma un `.webp`, porque una imagen del catálogo SIEMPRE tiene derivadas.
 * El video no tiene ninguna —sharp no corre en Workers y el canvas del navegador no
 * transcodifica— así que meterlo ahí obligaría a agregarle una excepción a cada función
 * de un módulo que hoy no tiene ninguna.
 *
 * EL PREFIJO NO ES `catalogo/`, y no es una decisión estética. `indice.json.ts` arma la
 * miniatura del buscador con `base.replace('catalogo/', '')`. Ese replace no valida
 * nada: una clave de video bajo `catalogo/` pasaría por ahí y saldría como una miniatura
 * rota, sin error y sin log. Bajo `videos/` no puede confundirse con una foto.
 */

/** 16 hex: los primeros 16 del SHA-256 de los bytes del archivo (SPEC.md §6.8). */
const RE_HASH16 = /^[0-9a-f]{16}$/;

/**
 * Valida el hash aunque venga de la base, mismo criterio que `claveDeImagen`.
 *
 * Un hash con barras o puntos escribiría —o borraría— fuera del prefijo `videos/`, y
 * estas funciones las usa tanto el `put` de la subida como la recolección de huérfanas.
 */
function verificarHash(hash16: string): string {
  if (!RE_HASH16.test(hash16)) {
    throw new Error(`Hash inválido: ${JSON.stringify(hash16)}. Son 16 hex en minúscula.`);
  }
  return hash16;
}

/** El archivo que reproduce el `<video>`. */
export function claveDeVideo(hash16: string): string {
  return `videos/${verificarHash(hash16)}/video.mp4`;
}

/**
 * El cuadro que se muestra antes de darle play.
 *
 * NO tiene columna propia en la base: se deriva del mismo hash que el video. Guardarla
 * sería guardar dos veces el mismo dato, con la posibilidad de que discrepen.
 */
export function claveDePoster(hash16: string): string {
  return `videos/${verificarHash(hash16)}/poster.webp`;
}

/**
 * TODAS las claves de un video. Lo que hay que borrar para que no quede nada.
 *
 * Emite las dos aunque un video pudiera no tener poster: `delete` de una clave que no
 * existe es un no-op, y consultar antes agregaría una forma de equivocarse — justo la
 * que deja un objeto sin dueño para siempre, invisible.
 */
export function clavesDeVideo(hash16: string): string[] {
  return [claveDeVideo(hash16), claveDePoster(hash16)];
}
