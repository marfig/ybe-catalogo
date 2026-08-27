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

/**
 * La descripcion del sitio, en frases separadas.
 *
 * Es un ARREGLO y no una cadena con `<br>` adentro porque el mismo texto va a dos
 * destinos con reglas opuestas: la `<meta name="description">` y `og:description`,
 * donde el marcado no se renderiza y solo ensucia lo que leen los buscadores y las
 * redes, y el parrafo de la portada, donde cortar la linea es una decision visual.
 *
 * Y aunque los destinos fueran uno solo, el marcado en la constante no funcionaria:
 * Astro ESCAPA las expresiones, asi que `{DESCRIPCION_SITIO}` imprimiria el `<br>`
 * como texto. Para que no lo hiciera habria que pedir `set:html`, que es abrir la
 * puerta a inyeccion para conseguir un salto de linea.
 *
 * La fuente es una: cada destino la arma como le sirve.
 */
export const DESCRIPCION_LINEAS = [
  'Mochilas, carteras, bolsos, maletas, billeteras, escolares y regalos empresariales. Descuentos para mayoristas de 30 a 40%. Consultá por WhatsApp.',
] as const;

/** Una linea, sin marcado: la version para metadatos y JSON-LD. */
export const DESCRIPCION_SITIO = DESCRIPCION_LINEAS.join(' ');

/** Leyenda obligatoria junto a todo monto publicado (SPEC §7.3). */
export const LEYENDA_PRECIO = 'Precio de referencia — confirmalo por WhatsApp';

/** Texto cuando el producto no tiene precio cargado. */
export const SIN_PRECIO = 'Consultar precio';

/**
 * La cuenta a la que se transfiere.
 *
 * VA COMO DATOS Y NO COMO LA IMAGEN QUE LOS TRAE. La diferencia no es de prolijidad:
 * de una captura no se copia un número de cuenta, y copiarlo a la app del banco es
 * exactamente lo que el cliente vino a hacer. En texto además se lee con un lector de
 * pantalla, se agranda con el zoom del sistema y pesa unos cientos de bytes en vez de
 * 44 KB.
 *
 * `numero` y `alias` SIN separadores ni espacios: son los dos campos que se copian, y
 * un `555 021 663` bonito en pantalla se pega roto en el formulario del banco. Si algún
 * día se los quiere agrupar visualmente, se agrupa al renderizar y se copia el valor
 * de acá.
 */
export const CUENTA_BANCARIA = {
  banco: 'Banco Atlas',
  numero: '555021663',
  titular: 'Ydalia Benitez',
  cedula: '5007059',
  /** El alias del banco, que casualmente es un número de teléfono. */
  alias: '0981857213',
} as const;

/** Redes sociales para `sameAs` de Organization y el footer. Pendiente. */
export const REDES: string[] = [];
