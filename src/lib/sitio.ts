/**
 * Constantes del comercio.
 *
 * `MARCA` vive aca y no como campo del producto: el catalogo es de una sola
 * marca, asi que un campo tendria el mismo valor en todos los productos y no
 * discriminaria nada (SPEC §4.2).
 */
export const COMERCIO = 'YBE';
export const MARCA = 'Chenson';

export const DESCRIPCION_SITIO =
  'Catálogo de mochilas, carteras, bolsos y accesorios. Consultá por WhatsApp.';

/** Leyenda obligatoria junto a todo monto publicado (SPEC §7.3). */
export const LEYENDA_PRECIO = 'Precio de referencia — confirmalo por WhatsApp';

/** Texto cuando el producto no tiene precio cargado. */
export const SIN_PRECIO = 'Consultar precio';

/** Redes sociales para `sameAs` de Organization y el footer. Pendiente. */
export const REDES: string[] = [];
