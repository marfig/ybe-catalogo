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

/** `videos/{16 hex}/video.mp4` o `.../poster.webp`, anclada de punta a punta. */
const RE_RUTA = /^videos\/([0-9a-f]{16})\/(video\.mp4|poster\.webp)$/;

/**
 * Valida una ruta que llegó por URL y dice con qué tipo servirla. `null` si no es un
 * objeto de video.
 *
 * DOS TRABAJOS EN UNA FUNCIÓN, y el segundo es el que importa. El primero es el mismo
 * que hace `claveDesdeRuta` para las imágenes: sin él, cualquier objeto del balde sería
 * descargable por su nombre desde el endpoint de desarrollo.
 *
 * El segundo es el tipo. El endpoint de imágenes puede hardcodear `image/webp` porque
 * todas sus claves terminan en `.webp`; acá conviven un MP4 y un WebP bajo el mismo
 * prefijo. Servir el video como `image/webp` no da error: el `<video>` se queda en
 * blanco, que es el modo de falla más caro de diagnosticar.
 */
export function rutaDeVideo(ruta: string): { clave: string; tipo: string } | null {
  const m = (ruta ?? '').match(RE_RUTA);
  if (!m) return null;
  return {
    clave: `videos/${m[1]}/${m[2]}`,
    tipo: m[2] === 'video.mp4' ? 'video/mp4' : 'image/webp',
  };
}

/**
 * URL pública del video y de su poster.
 *
 * Cuelgan de la MISMA base que las fotos —el bucket es uno solo— así que quien las use
 * ya la tiene de `baseDeImagenes()`, con su desvío a `/img-dev` en desarrollo.
 */
export function urlVideo(base: string, hash16: string): string {
  return `${base.replace(/\/+$/, '')}/${claveDeVideo(hash16)}`;
}

export function urlPoster(base: string, hash16: string): string {
  return `${base.replace(/\/+$/, '')}/${claveDePoster(hash16)}`;
}

// ---------------------------------------------------------------------------
// Las reglas del poster
//
// PIEZAS PURAS, con el mismo criterio que `imagen.ts`: lo que corre en el navegador es
// un `seek` y un `drawImage` con estos números, así que la parte que puede arruinar una
// portada se prueba sin canvas y sin video.
// ---------------------------------------------------------------------------

/** Lado mayor del poster. El mismo tope que la derivada más grande de una foto. */
const LADO_POSTER = 600;

/**
 * En qué segundo del video buscar el cuadro de portada.
 *
 * NO ES EL SEGUNDO 0, y esta es toda la razón de que la función exista. El primer cuadro
 * de un video de celular es casi siempre negro o un fundido de entrada: la ficha
 * mostraría un rectángulo oscuro como portada de un producto. Un segundo adentro ya hay
 * imagen real.
 *
 * En un video más corto que dos segundos, pedir el segundo 1 se pasaría del final —el
 * `seek` no dispara y el canvas dibuja un cuadro vacío—, así que ahí se va a la mitad.
 *
 * Una duración que el navegador no sabe cae al principio: `duration` es `Infinity` o
 * `NaN` hasta que llegan los metadatos, y en algunos MP4 se queda así para siempre. Un
 * `seek` a `Infinity` no lanza: deja el `<video>` esperando un evento que no llega.
 */
export function instanteDelPoster(duracionSegundos: number): number {
  if (!Number.isFinite(duracionSegundos) || duracionSegundos <= 0) return 0;
  return Math.min(1, duracionSegundos / 2);
}

/**
 * Cuánto mide el poster de un video de `ancho`×`alto`.
 *
 * Conserva la proporción del video, al revés que las fotos del catálogo, que se
 * recortan a 1:1. Un video vertical de celular recortado a cuadrado perdería la mitad
 * de lo que se ve al reproducirlo, y el poster dejaría de anticipar el video.
 *
 * NUNCA AMPLÍA, la misma regla que sostiene todo el pipeline de imagen: ampliar inventa
 * píxeles. Y el lado corto nunca baja de 1 — un video muy apaisado lo redondeaba a 0 y
 * el canvas lanza con una dimensión en cero.
 */
export function medidaDelPoster(ancho: number, alto: number): { ancho: number; alto: number } {
  const escala = Math.min(1, LADO_POSTER / Math.max(ancho, alto));
  return {
    ancho: Math.max(1, Math.round(ancho * escala)),
    alto: Math.max(1, Math.round(alto * escala)),
  };
}
