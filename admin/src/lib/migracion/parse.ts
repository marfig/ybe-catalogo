/**
 * La API del catálogo VIEJO, para traer los productos que el proveedor ya no publica.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO Y NO ALCANZA CON `viejo.ts`. Ése lee el sitemap y el HTML
 * de las fichas, y sirvió para los 189 productos que el proveedor todavía publica: de ahí
 * salían nombre, precio y descripción, y del proveedor las variantes y las fotos. Los 177
 * que quedan NO tienen ficha en el proveedor —es exactamente la razón por la que no
 * entraron— así que el catálogo viejo tiene que dar TODO, fotos incluidas.
 *
 * Y para eso el HTML no alcanza, medido el 2026-08-19:
 *
 *   - El `sitemap.xml` del catálogo viejo devuelve `<urlset></urlset>` VACÍO. `viejo.ts`
 *     sacaba de ahí los 368 códigos; hoy sacaría cero.
 *   - Las fichas ya NO traen JSON-LD en el HTML del servidor: lo inyecta el JavaScript en
 *     el navegador. `curaduriaDeHtml` lee el `Product` del JSON-LD, así que hoy devolvería
 *     `null` en los 366.
 *   - Los listados del sitio cortan en 24 items, así que recorrerlos da un inventario
 *     incompleto.
 *
 * LA API RESUELVE LAS TRES COSAS DE UNA. El catálogo viejo corre sobre Parse Server y su
 * API es pública: la configuración de abajo viaja en el bundle JavaScript del propio
 * sitio, o sea que es lo mismo que usa cualquier visitante con el navegador abierto. Una
 * consulta devuelve los 366 productos completos —código, título, precio, descripción con
 * sus saltos y TODAS las fotos a resolución original— en cuatro pedidos.
 *
 * PIEZA PURA, sin `fetch`: acá vive toda la decisión y por eso tiene tests. El envoltorio
 * que pide las páginas es el endpoint, que casi no decide nada. Mismo reparto que
 * `extractor.ts` con `ficha.ts`, y que `viejo.ts` con `curar.ts`.
 *
 * ES CÓDIGO DE UN SOLO USO, igual que el resto de esta carpeta: cuando los 177 estén
 * dentro, se borra entera sin tocar nada del scrape que sigue corriendo todos los días.
 */
import { normalizarCodigo } from '../codigo.ts';
import { slugificar } from '../slug.ts';
import { ORIGEN_VIEJO, textoDeDescripcion } from './viejo.ts';

/** El servidor Parse del catálogo viejo. */
export const SERVIDOR_PARSE = 'https://ecured.ecunegocio.com/parse/';

/**
 * La aplicación, tal como la declara el sitio viejo.
 *
 * NO ES UN SECRETO: viaja en texto plano en el bundle JavaScript de
 * `chensonasuncionybe.catalogst.com`, que cualquiera baja abriendo la página. Es la clave
 * pública de cliente de Parse, el equivalente de una API key de navegador — no da permiso
 * de escritura ni de leer otras tiendas.
 */
export const APP_ID_PARSE = 'Ecu_Al@2019o_0708777z8A31qProt';

/**
 * La clase de Parse donde viven los productos: `Post`, no `Producto`.
 *
 * Sale de `class extends Parse.Object { constructor() { super('Post') } }` en el bundle
 * del sitio viejo. El nombre no describe lo que guarda, y por eso está anotado acá: es lo
 * primero que alguien va a buscar cuando esto se rompa.
 */
export const CLASE_PRODUCTOS = 'Post';

/** La tienda. Sin este filtro la consulta trae los productos de todas las tiendas. */
export const PLACE_VIEJO = 'KygQqU2BGC';

/** De dónde salen las fotos del catálogo viejo. */
export const CDN_VIEJO = 'https://cdn.catalog-store.link';

/**
 * Cuántos productos trae una página.
 *
 * 100 es el tope por defecto de Parse. Con 366 productos son cuatro pedidos, y el
 * inventario entero entra en un request del navegador al Worker.
 */
export const POR_PAGINA = 100;

/**
 * ¿Esta URL es una foto del catálogo viejo?
 *
 * Sin esta guarda el puente de imágenes sería un proxy abierto: cualquiera que pase por
 * Access podría hacerle pedir cualquier host desde dentro de la red de Cloudflare. Es la
 * misma regla que `esDelOrigen` aplica al proveedor y `esDelOrigenViejo` a las fichas.
 *
 * Compara el ORIGEN completo y no un prefijo de texto: `https://cdn.catalog-store.link.malo.com`
 * empieza igual y no es el mismo host.
 */
export function esDelCdnViejo(url: string): boolean {
  try {
    return new URL(url).origin === new URL(CDN_VIEJO).origin;
  } catch {
    return false;
  }
}

/** Lo que la migración le pide al catálogo viejo por cada producto. */
export interface ProductoDelViejo {
  /** El código del proveedor. Es la identidad con la que se cruza contra nuestra base. */
  codigo: string;
  nombre: string;
  /** Entero en guaraníes, o `null` si el origen no da un precio usable. */
  precio: number | null;
  /** Con sus saltos de línea, o `null` si no aporta nada. */
  descripcion: string | null;
  /** Todas las fotos del producto, a resolución original y en su orden. */
  fotos: string[];
  /** La ficha del catálogo viejo. Auditoría: de dónde salió este producto. */
  urlOrigen: string;
}

/** Qué se le pide a la API. */
export interface Consulta {
  /** Un solo producto, por código. Excluye el paginado. */
  codigo?: string;
  skip?: number;
  limit?: number;
  /**
   * Que la respuesta traiga además cuántos productos hay en total.
   *
   * SE PIDE JUNTO CON LAS FILAS, no en un pedido aparte, y de eso depende que la pestaña
   * sepa cuándo parar de paginar sin gastar un pedido de más. Verificado el 2026-08-19
   * contra la API: `count=1` con `limit=3` devuelve `count: 366` y tres filas.
   */
  contar?: boolean;
}

/**
 * La URL de una consulta a la API.
 *
 * `order=createdAt` NO ES DECORATIVO: sin un orden declarado, Parse no garantiza que dos
 * páginas de la misma consulta vean las filas en el mismo orden, y el paginado por `skip`
 * podría repetir un producto y omitir otro sin dar ningún error.
 */
export function urlDeConsulta({
  codigo,
  skip = 0,
  limit = POR_PAGINA,
  contar = false,
}: Consulta = {}): string {
  const url = new URL(`classes/${CLASE_PRODUCTOS}`, SERVIDOR_PARSE);

  const donde: Record<string, unknown> = {
    place: { __type: 'Pointer', className: 'Place', objectId: PLACE_VIEJO },
  };
  if (codigo) donde.codigo = codigo;

  url.searchParams.set('where', JSON.stringify(donde));
  if (contar) url.searchParams.set('count', '1');

  url.searchParams.set('limit', String(codigo ? 1 : limit));

  // Paginar sólo tiene sentido sobre una lista: con `codigo` la respuesta es una fila o nada.
  if (!codigo) {
    url.searchParams.set('skip', String(skip));
    url.searchParams.set('order', 'createdAt');
  }

  return url.href;
}

/** Un entero positivo, o `null`. El guaraní no tiene decimales. */
function precioEntero(crudo: unknown): number | null {
  if (typeof crudo !== 'number' || !Number.isFinite(crudo)) return null;
  if (!Number.isInteger(crudo) || crudo <= 0) return null;
  return crudo;
}

/** Las fotos del producto: sólo las del CDN del catálogo viejo, en su orden. */
function fotosDe(crudo: unknown): string[] {
  if (!Array.isArray(crudo)) return [];

  return crudo
    .map((f) => (f && typeof f === 'object' ? (f as { url?: unknown }).url : null))
    .filter((u): u is string => typeof u === 'string' && esDelCdnViejo(u));
}

/**
 * Un producto de la API, listo para guardar. `null` si no se puede leer.
 *
 * NO SE ADIVINA NADA. Un producto sin código, sin título o sin fotos no entra: el código
 * es la identidad, el nombre es lo que hace aprobable a un importado, y estos 177 no
 * tienen otra fuente de fotos —el proveedor ya no los publica, que es la razón por la que
 * no entraron en la primera migración—. Entrar a medias es crear trabajo manual que
 * alguien tiene que descubrir después mirando la grilla.
 *
 * LA LISTA DE COLORES SE CONSERVA en la descripción, al revés que en la migración de los
 * 189. Ver la nota de `podarColores` en `viejo.ts`: acá no hay variantes de verdad de
 * dónde sacar los colores, así que esa línea es el único lugar donde dice de qué colores
 * hay, y quien compra pide por WhatsApp.
 */
export function productoDeParse(crudo: unknown): ProductoDelViejo | null {
  if (!crudo || typeof crudo !== 'object') return null;
  const post = crudo as Record<string, unknown>;

  let codigo: string;
  try {
    codigo = normalizarCodigo(typeof post.codigo === 'string' ? post.codigo : '');
  } catch {
    return null;
  }

  const nombre = typeof post.titulo === 'string' ? post.titulo.trim() : '';
  if (!nombre) return null;

  const fotos = fotosDe(post.image);
  if (fotos.length === 0) return null;

  /**
   * El título canónico y no el título: es el que el sitio viejo usa para su propia URL.
   * Verificado el 2026-08-19 contra las 24 fichas que publica el listado: 24 de 24
   * exactas. Si faltara, el nombre da un slug razonable para lo que es un dato de
   * auditoría.
   */
  const canonico = typeof post.canonical_title === 'string' && post.canonical_title.trim()
    ? post.canonical_title
    : nombre;

  let slug: string;
  try {
    slug = slugificar(canonico);
  } catch {
    // Un título sin letras ni números. No vale perder el producto por la URL de auditoría.
    slug = 'producto';
  }

  return {
    codigo,
    nombre,
    precio: precioEntero(post.precio),
    descripcion:
      typeof post.body === 'string' ? textoDeDescripcion(post.body, { podarColores: false }) : null,
    fotos,
    urlOrigen: new URL(`/product/${slug}-${codigo}`, ORIGEN_VIEJO).href,
  };
}

export interface PaginaDelViejo {
  productos: ProductoDelViejo[];
  /** Cuántos productos tiene la tienda, si se pidió la cuenta. */
  total: number | null;
  /** Cuántas filas vinieron y no se pudieron leer. Se reportan, no se esconden. */
  descartados: number;
}

/**
 * Una página de la API. `null` si la respuesta no tiene la forma esperada.
 *
 * `null` Y NO UNA LISTA VACÍA, y la diferencia importa: una lista vacía haría que la
 * pantalla dijera «no falta nada por migrar», que es la conclusión opuesta a la
 * verdadera. Un cambio de forma del origen tiene que cortar, no tranquilizar.
 *
 * Las filas que no se pueden leer se descartan de a una —fallo tolerante de §7.4— y se
 * cuentan: que una página de 100 se pierda entera por una fila rara es peor que traer 99
 * y decir que faltó una.
 */
export function productosDeRespuesta(crudo: unknown): PaginaDelViejo | null {
  if (!crudo || typeof crudo !== 'object') return null;

  const cuerpo = crudo as Record<string, unknown>;
  if (!Array.isArray(cuerpo.results)) return null;

  const productos: ProductoDelViejo[] = [];
  let descartados = 0;

  for (const fila of cuerpo.results) {
    const producto = productoDeParse(fila);
    if (producto) productos.push(producto);
    else descartados++;
  }

  return {
    productos,
    total: typeof cuerpo.count === 'number' ? cuerpo.count : null,
    descartados,
  };
}
