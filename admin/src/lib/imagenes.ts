/**
 * La clave de R2 y la URL pública de una miniatura. Una sola definición.
 *
 * EL BUG QUE ORIGINÓ ESTE MÓDULO. La clave se armaba por concatenación en tres
 * lugares sueltos —el `put` de `subida.ts` y los `<img>` de dos páginas— y nada
 * obligaba a que coincidieran. El síntoma fue una foto rota, que es el peor síntoma
 * posible: no hay error, no hay log, y el producto igual se guarda.
 *
 * Todo lo que escriba o lea una imagen del catálogo pasa por acá.
 */
import { ANCHOS } from './imagen.ts';

/** 16 hex: los primeros 16 del SHA-256 de los bytes originales (SPEC.md §6.8). */
const RE_HASH16 = /^[0-9a-f]{16}$/;

/** `catalogo/{16 hex}/w{ancho}.webp`, anclada de punta a punta. */
const RE_CLAVE = /^catalogo\/([0-9a-f]{16})\/w(\d+)\.webp$/;

/**
 * Base de las imágenes en desarrollo.
 *
 * En `astro dev` el binding `IMAGENES` es un R2 **local** de miniflare, no el bucket
 * de Cloudflare. Apuntar los `<img>` al bucket público da 404 en todo lo que se acaba
 * de subir: se escribe en un lado y se lee del otro.
 *
 * El nombre viene del sitio público, que servía sus imágenes desde `public/img-dev/`
 * antes de que existiera R2. Ahí era una carpeta de archivos estáticos y se retiró en
 * la fase 2.1; acá es un endpoint que lee el binding local (`pages/img-dev/`). Se
 * conserva el nombre porque la ruta significa lo mismo —«las imágenes, en desarrollo»—
 * pero el mecanismo no tiene nada que ver.
 */
export const BASE_DEV = '/img-dev';

/**
 * La clave del objeto en R2.
 *
 * VALIDA EL HASH aunque venga de la base. Un hash con barras o puntos escribiría —o
 * leería— fuera del prefijo `catalogo/`, y esta función la usa tanto el `put` como el
 * endpoint que sirve por URL.
 */
export function claveDeImagen(hash16: string, ancho: number): string {
  if (!RE_HASH16.test(hash16)) {
    throw new Error(`Hash inválido: ${JSON.stringify(hash16)}. Son 16 hex en minúscula.`);
  }
  if (!(ANCHOS as readonly number[]).includes(ancho)) {
    throw new Error(`Ancho ${ancho} fuera del contrato. Sólo ${ANCHOS.join(' y ')}.`);
  }
  return `catalogo/${hash16}/w${ancho}.webp`;
}

/**
 * Valida una clave que llegó por URL. `null` si no es una miniatura del catálogo.
 *
 * El endpoint de desarrollo lee del binding con la clave que le pasan. Sin esto,
 * cualquier objeto del bucket sería descargable por su nombre.
 */
export function claveDesdeRuta(ruta: string): string | null {
  const m = (ruta ?? '').match(RE_CLAVE);
  if (!m) return null;
  try {
    return claveDeImagen(m[1], Number(m[2]));
  } catch {
    return null;
  }
}

/**
 * Elige de dónde se leen las imágenes.
 *
 * Falla ante una base vacía en vez de emitir `src="/catalogo/…"`, que daría una foto
 * rota sin ningún error — exactamente el bug que este módulo existe para no repetir.
 */
export function baseDeImagenes({ baseR2, dev }: { baseR2: string | undefined; dev: boolean }): string {
  if (dev) return BASE_DEV;

  const base = (baseR2 ?? '').trim();
  if (base === '') {
    throw new Error('PUBLIC_R2_BASE está vacía: sin ella las miniaturas del admin no cargan.');
  }
  // La escribe una persona en wrangler.jsonc; una barra de más no puede romper nada.
  return base.replace(/\/+$/, '');
}

/** URL pública de una miniatura. */
export function urlMiniatura(base: string, hash16: string, ancho: number): string {
  return `${base.replace(/\/+$/, '')}/${claveDeImagen(hash16, ancho)}`;
}

/**
 * El hash de dedupe: SHA-256 de los BYTES ORIGINALES, primeros 16 hex.
 *
 * NUNCA del WebP que produce el navegador. El encoder varía entre navegadores y
 * versiones, así que hashear la salida daría hashes distintos según quién cargue la
 * foto y rompería el dedupe y la idempotencia en silencio (§8.1).
 *
 * Tampoco se infiere del nombre del archivo: los del origen son IDs opacos de 80 hex
 * que no son hashes de contenido (`SPEC.md` §2.2-7).
 */
export async function hash16De(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest, 0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
