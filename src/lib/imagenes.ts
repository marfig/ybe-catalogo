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

/**
 * `sizes` de la card en grilla densa (3/4/6 columnas, ver `GrillaPedidosEspeciales`).
 *
 * Va aparte y no calculado: `sizes` describe el hueco REAL que ocupa la imagen, y ese
 * hueco depende de cuantas columnas tiene la grilla. Con el `sizes` de la grilla normal
 * el navegador pediria el w600 para un hueco de 180 px.
 */
export const SIZES_CARD_DENSO = '(min-width: 1024px) 180px, (min-width: 640px) 25vw, 30vw';

/** `sizes` de la imagen principal de la ficha. Tope 600 px: es el techo del origen. */
export const SIZES_FICHA = '(min-width: 640px) 600px, 100vw';

/**
 * Valida PUBLIC_R2_BASE. Devuelve la base para poder encadenar.
 *
 * Existe porque una base mal seteada NO produce ningun error: produce una
 * pagina entera de imagenes rotas, que es mucho mas caro de diagnosticar.
 *
 * El caso que motivo esto: Git Bash (MSYS) traduce cualquier variable con pinta
 * de ruta POSIX antes de pasarla al proceso, asi que
 *   PUBLIC_R2_BASE=/img-dev npm run build
 * llega a Astro como "C:/Program Files/Git/img-dev". Desde un archivo .env no
 * pasa, porque lo lee Vite sin intervencion del shell.
 */
export function validarBaseR2(r2Base: string): string {
  const base = r2Base.trim();

  if (base === '') {
    throw new Error('PUBLIC_R2_BASE esta vacia. Completala en .env.');
  }

  // Ruta de Windows: letra de unidad, o cualquier backslash.
  if (/^[a-z]:[/\\]/i.test(base) || base.includes('\\')) {
    throw new Error(
      `PUBLIC_R2_BASE parece una ruta de Windows: "${base}".\n` +
        'Causa tipica: Git Bash (MSYS) traduce las variables con pinta de ruta POSIX. ' +
        'Defini PUBLIC_R2_BASE en el archivo .env en vez de pasarla por linea de comandos, ' +
        'o prefija el comando con MSYS_NO_PATHCONV=1.'
    );
  }

  if (!/^https?:\/\//i.test(base) && !base.startsWith('/')) {
    throw new Error(
      `PUBLIC_R2_BASE debe ser una URL absoluta (https://...) o empezar con barra (/img-dev). Recibio: "${base}".`
    );
  }

  return base;
}

function unirBase(r2Base: string, resto: string): string {
  return `${validarBaseR2(r2Base).replace(/\/+$/, '')}/${resto}`;
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

/**
 * URL ABSOLUTA de una derivada, para Open Graph y JSON-LD.
 *
 * Open Graph y schema.org exigen URLs absolutas: WhatsApp, Facebook y Twitter no
 * resuelven rutas relativas, y una vista previa sin imagen es justo lo que no
 * puede pasar en un sitio cuyo objetivo es que compartan productos.
 *
 * No alcanza con urlImagen(): con PUBLIC_R2_BASE relativo (`/img-dev` en
 * desarrollo) devuelve una ruta relativa. Cuando R2 este configurado la base va
 * a ser absoluta y esto sera un no-op, pero el contrato no puede depender de eso.
 */
export function urlImagenAbsoluta(
  r2Base: string,
  imagen: Imagen,
  ancho: number,
  site: URL | undefined
): string {
  const url = urlImagen(r2Base, imagen, ancho);
  if (/^https?:\/\//i.test(url)) return url;

  if (!site) {
    throw new Error(
      'Astro.site es undefined: no se puede absolutizar la URL de imagen para og:image.'
    );
  }
  return new URL(url, site).href;
}

/** `srcset` con unicamente los anchos que existen, de menor a mayor. */
export function srcSetImagen(r2Base: string, imagen: Imagen): string {
  return [...imagen.anchos]
    .sort((a, b) => a - b)
    .map((ancho) => `${urlImagen(r2Base, imagen, ancho)} ${ancho}w`)
    .join(', ');
}
