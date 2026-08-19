/**
 * Lectura del catálogo VIEJO (`chensonasuncionybe.catalogst.com`), para la migración de
 * una sola vez.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO Y NO SE REUSA EL SCRAPE DEL PROVEEDOR. Son dos orígenes
 * con dos formas distintas, y son COMPLEMENTARIOS: el proveedor publica los colores como
 * fichas hermanas con su foto —o sea variantes de verdad— pero no publica nombre ni
 * precio ni descripción (SPEC §2.3). El catálogo viejo publica exactamente esos tres y
 * lista los colores como prosa. La migración toma de cada uno lo que el otro no tiene.
 *
 * PIEZA PURA, sin `fetch` ni `HTMLRewriter`: acá vive toda la decisión y por eso tiene
 * tests. El envoltorio que pide las páginas es el endpoint, que casi no decide nada.
 * Mismo reparto que `extractor.ts` con `ficha.ts`.
 *
 * ES CÓDIGO DE UN SOLO USO y vive aparte a propósito: cuando la migración termine, esta
 * carpeta se borra entera sin tocar nada del scrape que sigue corriendo todos los días.
 */

/** El catálogo viejo. Migración de una sola vez; cuando termine, esto se borra. */
export const ORIGEN_VIEJO = 'https://chensonasuncionybe.catalogst.com';

/**
 * ¿Esta URL es del catálogo viejo?
 *
 * La pantalla le pasa al Worker la URL de cada ficha, así que sin esta guarda el endpoint
 * sería un proxy abierto: cualquiera que pase por Access podría hacerle pedir cualquier
 * cosa a cualquier host, desde dentro de la red de Cloudflare. Es la misma regla que
 * `esDelOrigen` aplica al proveedor.
 */
export function esDelOrigenViejo(url: string): boolean {
  try {
    return new URL(url).origin === new URL(ORIGEN_VIEJO).origin;
  } catch {
    return false;
  }
}

/** Un producto del catálogo viejo, tal como sale del sitemap. */
export interface ProductoViejo {
  /** El código del proveedor. Es la identidad con la que se cruzan los dos orígenes. */
  codigo: string;
  url: string;
}

/** Lo único que la migración le pide al catálogo viejo. */
export interface Curaduria {
  nombre: string;
  /** Entero en guaraníes, o `null` si el origen no da un precio usable. */
  precio: number | null;
  /** Con sus saltos de línea, o `null` si no aporta nada. */
  descripcion: string | null;
}

/**
 * El código de un producto del catálogo viejo: la cola del slug.
 *
 * `/product/lonchera-termica-de-barbie-5551115` → `5551115`.
 *
 * Medido el 2026-08-12: el `sku` del JSON-LD coincide con la cola del slug en 15 de 15
 * fichas. Por eso los 368 códigos se derivan del sitemap sin pedir una sola ficha, y el
 * chequeo de presencia contra el proveedor puede correr antes de bajar nada.
 */
export function codigoDeUrlVieja(url: string): string | null {
  let ruta: string;
  try {
    ruta = new URL(url).pathname;
  } catch {
    return null;
  }

  const partes = ruta.split('/').filter(Boolean);
  if (partes[0] !== 'product' || partes.length < 2) return null;

  const cola = partes[partes.length - 1].split('-').pop();
  return cola ? cola.toUpperCase() : null;
}

/**
 * Los productos del sitemap, en su orden.
 *
 * EL SITEMAP ES LA LISTA DE TRABAJO Y NO LOS LISTADOS DEL SITIO. Medido: `/catalog` y
 * cada página de categoría devuelven 24 items y siguen con scroll infinito, así que
 * recorrerlas da un inventario incompleto —el mapa de categorías cubrió sólo el 48 %—.
 * El sitemap trae los 368 en un pedido, sin JavaScript.
 */
export function productosDelSitemap(xml: string): ProductoViejo[] {
  const salida: ProductoViejo[] = [];

  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    const url = m[1];
    const codigo = codigoDeUrlVieja(url);
    if (codigo) salida.push({ codigo, url });
  }

  return salida;
}

/** Las entidades que aparecen de verdad en este origen. */
const ENTIDADES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

function decodificar(texto: string): string {
  return texto
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (e) => ENTIDADES[e] ?? e)
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
}

/**
 * El renglón que titula la lista de colores. `<p>Colores disponibles:</p>`.
 *
 * Se lo lleva la misma poda que la lista: un título sin su lista no dice nada.
 *
 * NO CUBRE TODAS LAS REDACCIONES DEL ORIGEN, y se deja así a propósito. Medido el
 * 2026-08-19 sobre los 366 productos de la API, de los 54 con lista el origen titula
 * «Colores disponibles:» en 48, y en los 6 restantes escribe «Color disponible:»,
 * «Disponibles en color:» o «Colores disponibles varón:». Ampliar el patrón ahora no
 * arregla nada: la poda sólo corre por el camino de los 189, que ya terminó, y el de los
 * 177 conserva la lista entera (ver `podarColores`). El costo de un título huérfano es un
 * renglón de más en una descripción; el de tocar esto es volver a probarlo sin poder.
 */
const TITULO_COLORES = /^\s*colores\s+disponibles\s*:?\s*$/i;

/** Qué hacer con la lista de colores al redactar la descripción. */
export interface OpcionesDeDescripcion {
  /**
   * `true` —el valor por defecto, que es el de la migración de los 189— poda la lista de
   * colores y el renglón que la titula.
   *
   * SE PODA CUANDO LOS COLORES ENTRAN COMO VARIANTES DE VERDAD, con su SKU y su foto,
   * desde la ficha del proveedor: repetirlos como prosa los cuenta dos veces, y la lista
   * del catálogo viejo puede además no coincidir con lo que el proveedor publica hoy.
   *
   * `false` la CONSERVA, y es lo que necesitan los 177 productos que el proveedor ya no
   * publica: ahí no hay ficha del proveedor de dónde sacar variantes —`nombres_variantes`
   * viene vacío en los 366 de la API y las fotos son un array plano a nivel producto—, así
   * que esa línea es el único lugar donde dice de qué colores hay. Quien compra pide por
   * WhatsApp: sin ella no sabe qué pedir.
   */
  podarColores?: boolean;
}

/**
 * La descripción del catálogo viejo, en texto con sus saltos de línea.
 *
 * EL JSON-LD NO SIRVE PARA ESTO, y es el hallazgo que define esta función: ahí la
 * descripción viene aplanada con espacios —«Medidas: alto 25 x largo 21 x ancho 13 cm
 * Con asas largas»—. El cuerpo la guarda como HTML con `<p>`, y el sitio viejo la rinde
 * con `whitespace-pre-line`, la misma solución que nuestra ficha. Los saltos son del
 * autor: aplanarlos es perder información que alguien escribió.
 *
 * LOS COLORES SE DESCARTAN POR DEFECTO. En el modelo nuevo un color es una variante con su
 * SKU y su foto, que salen de la ficha del proveedor; repetirlos como prosa es contarlos
 * dos veces, y la lista del catálogo viejo puede además no coincidir con lo que el
 * proveedor publica hoy. Se podan por ESTRUCTURA —la `<ol>`/`<ul>` y el renglón que la
 * titula— y no cortando el texto hasta el final: si un producto escribiera algo después de
 * los colores, cortar lo perdería. Ver `podarColores` para cuándo NO se podan.
 *
 * Devuelve `null` y no cadena vacía cuando no queda nada, y de eso depende el `COALESCE`
 * del UPDATE: con `null` la descripción no se pisa y quedan las medidas que sembró la
 * ficha del proveedor. Es el caso de `cartuchera-doble-cierre-1734033`, cuya descripción
 * entera era la lista de colores.
 */
export function textoDeDescripcion(
  fragmento: string,
  { podarColores = true }: OpcionesDeDescripcion = {}
): string | null {
  let texto = fragmento;

  // Las listas de colores, enteras.
  if (podarColores) texto = texto.replace(/<(ol|ul)\b[^>]*>[\s\S]*?<\/\1>/gi, '');

  texto = texto
    // Cada bloque y cada salto explícito terminan en un renglón.
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/\r\n?/g, '\n');

  const renglones = decodificar(texto)
    .split('\n')
    // El origen deja espacios sueltos al final de varios párrafos.
    .map((r) => r.replace(/[^\S\n]+/g, ' ').trim())
    // El título huérfano se va con la lista; si la lista se queda, el título también.
    .filter((r) => !(podarColores && TITULO_COLORES.test(r)));

  const limpio = renglones
    .join('\n')
    // Más de una línea en blanco seguida es un hueco, no una separación. El origen mete
    // varios `<p><br></p>` juntos.
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return limpio || null;
}

/** El `<div class="descripcion-html …">` del cuerpo, con su HTML adentro. */
const BLOQUE_DESCRIPCION = /<div[^>]*\bdescripcion-html\b[^>]*>([\s\S]*?)<\/div>/i;

/** Un entero positivo, o `null`. El guaraní no tiene decimales. */
function precioEntero(crudo: unknown): number | null {
  const n = typeof crudo === 'string' ? Number(crudo) : crudo;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

/**
 * Nombre, precio y descripción de una ficha del catálogo viejo.
 *
 * Devuelve `null` si la página no trae el `Product` del JSON-LD. NO SE ADIVINA: si el
 * origen cambia de forma, es mejor no curar nada que curar mal 189 productos, que
 * después alguien tiene que revisar a mano uno por uno.
 *
 * El nombre y el precio salen del JSON-LD, que es un contrato declarado. La descripción
 * sale del CUERPO, porque el JSON-LD la aplana.
 */
export function curaduriaDeHtml(html: string): Curaduria | null {
  let producto: Record<string, unknown> | null = null;

  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1].trim()) as Record<string, unknown>;
      if (j['@type'] === 'Product') producto = j;
    } catch {
      // Un bloque roto no invalida los otros: la página trae varios.
    }
  }

  if (!producto) return null;

  const nombre = typeof producto.name === 'string' ? producto.name.trim() : '';
  if (!nombre) return null;

  const oferta = producto.offers as Record<string, unknown> | undefined;

  const bloque = html.match(BLOQUE_DESCRIPCION);

  return {
    nombre,
    precio: precioEntero(oferta?.price),
    descripcion: bloque ? textoDeDescripcion(bloque[1]) : null,
  };
}
