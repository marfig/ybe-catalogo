/** Anchos del contrato de imagenes (SPEC §5.2). */
export const ANCHOS = [300, 600] as const;
export type Ancho = (typeof ANCHOS)[number];

/**
 * Una imagen del catalogo.
 *
 * `base` es la clave direccionada por contenido, sin el sufijo de tamano:
 * `catalogo/{sha256[:16]}`. Los tamanos se derivan de `anchos`.
 *
 * `anchos` es explicito y NO se asume: segun §5.5 un origen de menos de 600 px
 * genera solo `w300`. Guardarlo evita que el srcset apunte a un archivo que no
 * existe.
 */
export interface Imagen {
  base: string;
  anchos: number[];
}

/**
 * `sizes` de la card de grilla. Describe el ancho REAL que ocupa la imagen en
 * cada breakpoint; sin esto el navegador asume 100vw y baja el w600 siempre,
 * desperdiciando datos en movil.
 */
export const SIZES_CARD = '(min-width: 1024px) 280px, (min-width: 640px) 45vw, 90vw';

/** `sizes` de la imagen principal de la ficha. Tope 600 px: es el techo del origen. */
export const SIZES_FICHA = '(min-width: 640px) 600px, 100vw';

function unirBase(r2Base: string, resto: string): string {
  return `${r2Base.replace(/\/+$/, '')}/${resto}`;
}

/** URL absoluta (o relativa en dev) de una derivada concreta. */
export function urlImagen(r2Base: string, imagen: Imagen, ancho: number): string {
  if (!imagen.anchos.includes(ancho)) {
    throw new RangeError(
      `La imagen ${imagen.base} no tiene ancho ${ancho}. Disponibles: ${imagen.anchos.join(', ')}.`
    );
  }
  return unirBase(r2Base, `${imagen.base}/w${ancho}.webp`);
}

/** El mayor ancho disponible. Sirve de `src` de fallback del `<img>`. */
export function anchoMayor(imagen: Imagen): number {
  return Math.max(...imagen.anchos);
}

/** `srcset` con unicamente los anchos que existen, de menor a mayor. */
export function srcSetImagen(r2Base: string, imagen: Imagen): string {
  return [...imagen.anchos]
    .sort((a, b) => a - b)
    .map((ancho) => `${urlImagen(r2Base, imagen, ancho)} ${ancho}w`)
    .join(', ');
}
