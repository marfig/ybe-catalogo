/**
 * Las convenciones del sitio de origen (SPEC-etapa2 §7.2, SPEC.md §6.6).
 *
 * Todo lo que sabe cómo está armado el sitio del proveedor vive acá y en ningún otro
 * lado. Es lo primero que se rompe cuando el proveedor rediseña, así que ese día hay
 * un solo archivo que mirar y una sola tanda de tests que se pone roja.
 *
 * Nada de esto toca la red ni el DOM: son funciones puras sobre strings, y por eso
 * corren bajo `node --test` sin `HTMLRewriter` ni `fetch`.
 */
import { normalizarCodigo } from '../codigo.ts';
import { slugificar } from '../slug.ts';

/** Origen permitido. El scrape no sigue enlaces fuera de acá. */
export const ORIGEN = 'https://www.chenson.com.py';

/** Ruta de las imágenes del proveedor. */
export const RUTA_IMAGENES = '/Prelude-images/product/';

/** Ruta del listado de lanzamientos: una tanda con fecha. */
export const RUTA_LANZAMIENTOS = '/lanzamientos';

/** Ruta de un listado por categoría: `/categoria/{id}-{slug}`, con subcategoría opcional. */
const RE_CATEGORIA = /^\/categoria\/[^/]+/;

/**
 * Los dos listados que el proveedor sabe servir.
 *
 * Se distinguen porque SE PAGINAN DISTINTO, y esa diferencia es la que decide qué acota
 * el recorrido. Un lanzamiento se acota por su `lz` —la página enlaza los lanzamientos
 * anteriores—; una categoría se acota por su ruta —la página enlaza todas las demás
 * categorías en el menú—. Sin acotar, cualquiera de los dos importa el catálogo entero.
 */
export type ClaseDeListado = 'lanzamiento' | 'categoria';

/**
 * Qué clase de listado es esta URL, o `null` si no es ninguno.
 *
 * `null` en vez de lanzar: el acumulador es el que decide si eso es un error, y para el
 * resto del scrape «esto no es un listado» es una respuesta normal.
 */
export function claseDeListado(url: string): ClaseDeListado | null {
  let ruta: string;
  try {
    const u = new URL(url);
    // El scrape no sale del origen, ni siquiera para clasificar.
    if (!/^https?:$/.test(u.protocol) || u.host !== new URL(ORIGEN).host) return null;
    ruta = u.pathname;
  } catch {
    return null;
  }

  if (ruta === RUTA_LANZAMIENTOS || ruta.startsWith(`${RUTA_LANZAMIENTOS}/`)) {
    return 'lanzamiento';
  }
  // `RE_CATEGORIA` exige una rama después de `/categoria/`: `/categoria` sola no lista
  // nada, y `/categorias/...` no es una ruta del proveedor.
  if (RE_CATEGORIA.test(ruta)) return 'categoria';

  return null;
}

/**
 * Cuántos productos declara el encabezado de una categoría: `431 Productos`.
 *
 * ES EL ÚNICO DATO QUE DICE CUÁNTAS PÁGINAS HAY, y hace falta por el hallazgo del
 * 2026-08-26: la paginación de una categoría es una VENTANA DESLIZANTE.
 * `/categoria/1-cartera` enlaza sólo las páginas 1 a 6, y la categoría tiene 36. El
 * recorrido llega igual —la cola se resiembra con cada respuesta— pero el progreso
 * diría «página 5 de 6» a un séptimo del camino.
 *
 * Devuelve `null` y no 0 cuando no hay número: `/lanzamientos` sirve el MISMO `<p>`
 * vacío, así que ese caso es el camino normal de la otra clase de listado y no una
 * defensa. Quien estima páginas necesita distinguir «no lo sé» de «no hay ninguno»
 * antes de dividir.
 */
export function totalDeclarado(texto: string): number | null {
  // Los separadores de miles se descartan antes de parsear: `Number('1.234')` da 1.234,
  // que redondeado son 1 producto.
  const m = (texto ?? '').trim().match(/^([\d.,]+)\s+Productos?\b/i);
  if (!m) return null;

  const n = Number(m[1].replace(/[.,]/g, ''));
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * El `alt` con que el sitio etiqueta sus fotos de galería.
 *
 * HALLAZGO DEL SPIKE, y el más importante del análisis: la ficha lista imágenes que
 * NO son del producto — un carrusel de recomendados que **rota en cada request**.
 * Barrerlas rompe la idempotencia sin producir ningún error.
 *
 * Se probó la hipótesis «un recomendado siempre cuelga de un `<a>` a otro producto» y
 * SE MIDIÓ FALSA. Lo que sí los distingue es este `alt`, que es semántico y no depende
 * de contenedores ni de posiciones.
 */
export const ALT_GALERIA = 'product-thumb';

/** Ficha de producto: `/producto/{idColor}-{codigo}`. */
const RE_FICHA = /\/producto\/(\d+)-([a-z0-9]+)\/?$/i;

/** Igual, pero sin anclar: sirve sobre un `href` relativo o con querystring. */
const RE_FICHA_SUELTA = /\/producto\/(\d+)-([a-z0-9]+)/i;

/** Prefijo `(X)` del proveedor: código interno de color. */
const RE_PREFIJO_COLOR = /^\(\s*([A-Za-z0-9]+)\s*\)\s*(.*)$/;

/**
 * Título de la ficha: `Producto: {CODIGO} ({X}) {NOMBRE}`.
 *
 * Verificado el 2026-08-06 sobre 5 fichas reales, en `og:title` y en `<title>`.
 */
const RE_TITULO_FICHA = /^\s*Producto:\s*([A-Za-z0-9_-]+)\s+(\(.+)$/;

/**
 * El código del modelo, sacado de la URL de la ficha.
 *
 * La URL es lo más estable que expone el sitio: el markup se rediseña, el patrón de
 * ruta no. Devuelve `null` en vez de lanzar porque un enlace que no es ficha es un
 * caso normal al recorrer un listado, no un error.
 */
export function codigoDesdeUrl(url: string): string | null {
  let ruta: string;
  try {
    ruta = new URL(url, ORIGEN).pathname;
  } catch {
    return null;
  }

  const m = ruta.match(RE_FICHA);
  if (!m) return null;

  try {
    // Se pasa por la forma canónica compartida para que el código que sale del scrape
    // sea idéntico al que escribe una persona: el índice `upper(codigo)` de la
    // migración 0002 los compara sin distinguir mayúsculas.
    return normalizarCodigo(m[2]);
  } catch {
    return null;
  }
}

/**
 * ¿Este enlace apunta a otra ficha del MISMO modelo?
 *
 * Es la regla que separa un color hermano de un recomendado del carrusel, y vive en
 * la estructura de la URL a propósito: `SPEC.md` §2.3 especificaba el selector
 * `#other-colors-tbl`, pero sobre una ficha alcanzada desde lanzamientos ese `id` no
 * se pudo confirmar — el bloque aparece rotulado «Colores Disponibles».
 *
 * Y si igual se rompiera, la red de seguridad está en el esquema: `productos.codigo
 * UNIQUE` agrupa solo las fichas que entren sueltas (§7.5).
 */
export function esFichaDelMismoModelo(href: string, codigo: string): boolean {
  const m = href.match(RE_FICHA_SUELTA);
  return Boolean(m && m[2].toUpperCase() === codigo.trim().toUpperCase());
}

/** Un color del origen, partido en su código interno y su nombre. */
export interface ColorDeOrigen {
  /** El `X` de `(X)`, o `null` si el color viene sin prefijo. */
  prefijo: string | null;
  /** El nombre sin el prefijo, tal cual lo escribe el proveedor. */
  nombre: string;
}

/**
 * Parte `(E) CREMA` en su código de color y su nombre.
 *
 * El prefijo es código interno del proveedor y no se muestra nunca (`SPEC.md` §2.3),
 * pero **sí se conserva** porque es de donde sale el SKU.
 */
export function separarColor(colorOrigen: string): ColorDeOrigen {
  const limpio = (colorOrigen ?? '').trim();
  const m = limpio.match(RE_PREFIJO_COLOR);
  if (!m) return { prefijo: null, nombre: limpio };
  return { prefijo: m[1], nombre: m[2].trim() };
}

/**
 * SKU de una variante scrapeada: `{codigo}-{codigoColor}` (`SPEC.md` §6.6).
 *
 * NO es lo mismo que `skuDe()` de `../imagen.ts`, que implementa sólo la rama del
 * fallback. Un producto del proveedor tiene SKU `CG85527-E`; recomputarlo con
 * `slug(color)` daba `CG85527-crema`, que no coincide con nada.
 *
 * El SKU se asigna una vez y no se vuelve a derivar: ya viajó en pedidos por WhatsApp.
 * Nunca sale de un índice posicional — si el proveedor agrega un color, los SKU
 * existentes no se pueden mover.
 */
export function skuDeOrigen(codigo: string, colorOrigen: string): string {
  const { prefijo, nombre } = separarColor(colorOrigen);
  if (prefijo) return `${codigo}-${prefijo}`;

  try {
    return `${codigo}-${slugificar(nombre)}`;
  } catch {
    throw new Error(
      `No se puede armar el SKU: el color ${JSON.stringify(colorOrigen)} no tiene letras ni números.`
    );
  }
}

/**
 * El color de LA PROPIA ficha, sacado de su título.
 *
 * HALLAZGO DEL 2026-08-06, medido sobre fichas reales y **ausente de la spec**.
 *
 * El bloque de colores de una ficha lista únicamente a los HERMANOS: la ficha abierta
 * no se enlaza a sí misma. Sobre `/producto/71163-cg85700` se ven `(T) MARRON CLARO` y
 * `(B) MARRON`, pero en ningún lado del bloque aparece `(3) NEGRO`, que es el color de
 * esa misma página.
 *
 * Sin esta función, de un modelo de 3 colores entrarían 2 y el que falta sería siempre
 * el que estabas mirando. No daría ningún error: entraría un producto incompleto.
 *
 * Se valida que el código del título COINCIDA con el de la URL. Si el proveedor cambia
 * la plantilla y el título pasa a ser de otra cosa, es preferible quedarse sin el color
 * — y que el aviso lo levante quien cure — que colgarle a la variante un color ajeno.
 */
export function colorDesdeTitulo(titulo: string, codigo: string): string | null {
  const m = (titulo ?? '').trim().match(RE_TITULO_FICHA);
  if (!m) return null;
  if (m[1].toUpperCase() !== codigo.trim().toUpperCase()) return null;
  return m[2].trim();
}

/**
 * Absolutiza y normaliza una URL del origen.
 *
 * Hace falta de verdad: los `src` del sitio traen el **puerto explícito** `:443`, y
 * comparar los strings crudos duplicaría cada imagen contra la misma ya guardada.
 * `new URL()` saca el puerto por defecto y resuelve las rutas relativas.
 */
export function normalizarUrl(href: string, base: string = ORIGEN): string | null {
  // `new URL('', base)` NO lanza: devuelve la base. Sin este corte, un `src` vacío
  // se convertiria en una "imagen" que apunta a la portada del proveedor.
  if (!href || !href.trim()) return null;
  try {
    return new URL(href.trim(), base).href;
  } catch {
    return null;
  }
}
