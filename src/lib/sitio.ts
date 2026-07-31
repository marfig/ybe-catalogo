/**
 * Constantes del comercio.
 *
 * `MARCA` vive aca y no como campo del producto: el catalogo es de una sola
 * marca, asi que un campo tendria el mismo valor en todos los productos y no
 * discriminaria nada (SPEC §4.2).
 */
/**
 * Nombre completo del comercio. Alimenta el <title>, og:site_name, el
 * Organization del JSON-LD y el `seller` de la oferta.
 */
export const COMERCIO = 'Chenson Asunción';

/**
 * Version corta para lugares apretados (header en movil, aria-labels).
 * No reemplaza a COMERCIO en metadatos: ahi va el nombre completo.
 */
export const NOMBRE_CORTO = 'YBE';

/**
 * Marca de los productos, para `brand` del JSON-LD.
 *
 * NO es lo mismo que COMERCIO: uno es el local que vende, el otro el fabricante.
 * Que compartan la palabra "Chenson" es correcto y no es redundancia.
 */
export const MARCA = 'Chenson';

export const DESCRIPCION_SITIO =
  'Mochilas, carteras, bolsos y accesorios Chenson en Asunción. Consultá por WhatsApp.';

/** Leyenda obligatoria junto a todo monto publicado (SPEC §7.3). */
export const LEYENDA_PRECIO = 'Precio de referencia — confirmalo por WhatsApp';

/** Texto cuando el producto no tiene precio cargado. */
export const SIN_PRECIO = 'Consultar precio';

/** Redes sociales para `sameAs` de Organization y el footer. Pendiente. */
export const REDES: string[] = [];
