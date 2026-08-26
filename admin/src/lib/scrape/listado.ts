/**
 * El listado de productos del proveedor (SPEC-etapa2 §7.1, §7.2).
 *
 * Misma división que la ficha: la decisión vive en un acumulador puro y testeable, y
 * `HTMLRewriter` sólo le pasa eventos.
 *
 * SIRVE DOS CLASES DE LISTADO, `/lanzamientos` y `/categoria/...`, y la diferencia entre
 * ellas es lo único no obvio de este archivo: **qué acota el recorrido**. Un lanzamiento
 * se acota por su `lz` porque la página enlaza los lanzamientos anteriores; una categoría
 * se acota por su ruta porque la página enlaza todas las demás categorías en el menú.
 * Sin acotar, cualquiera de las dos importa el catálogo entero sin que nadie lo pida.
 */
import {
  ORIGEN,
  type ClaseDeListado,
  claseDeListado,
  codigoDesdeUrl,
  normalizarUrl,
  totalDeclarado,
} from './origen.ts';
import { USER_AGENT, esDelOrigen } from './ficha.ts';

/**
 * Dónde vive el `431 Productos` de una categoría.
 *
 * Está una sola vez en la página, medido el 2026-08-26. `/lanzamientos` tiene el mismo
 * bloque con el `<p>` vacío, así que el selector sirve para las dos clases y es
 * `totalDeclarado` el que decide que ahí no hay número.
 */
const SELECTOR_TOTAL = '.page-header p';

export interface ListadoExtraido {
  /** La URL del listado, normalizada. */
  url: string;
  /** Qué clase de listado resultó ser. */
  clase: ClaseDeListado;
  /** Fichas de esta página, en orden de documento y sin repetir. */
  fichas: string[];
  /** Las páginas que ESTA página enlaza, ordenadas. */
  paginas: string[];
  /**
   * El mayor número que enlazó la paginación. Nunca menos de 1.
   *
   * OJO: en una categoría **no es el total**, es lo que se ve desde acá. Ver
   * `#verPaginacion`.
   */
  totalPaginas: number;
  /**
   * Cuántos productos declara la categoría, o `null` si no lo declara.
   *
   * Es lo que permite saber cuántas páginas hay de verdad cuando la paginación es una
   * ventana deslizante. Ver `totalDeclarado` en `origen.ts`.
   */
  totalProductos: number | null;
}

export class AcumuladorListado {
  readonly url: string;
  readonly clase: ClaseDeListado;

  /** El `lz` de ESTE lanzamiento, o `null` en una categoría. */
  readonly #lz: string | null;
  /** La ruta de ESTA categoría, sin barra final. Vacía en un lanzamiento. */
  readonly #ruta: string;

  readonly #fichas = new Set<string>();
  readonly #paginas = new Map<number, string>();
  #totalProductos: number | null = null;

  constructor(url: string) {
    const absoluta = normalizarUrl(url);
    const clase = absoluta ? claseDeListado(absoluta) : null;
    if (!absoluta || !clase) {
      throw new Error(`La URL no es un listado de productos del proveedor: ${url}`);
    }

    this.url = absoluta;
    this.clase = clase;

    const u = new URL(absoluta);
    this.#lz = u.searchParams.get('lz');
    this.#ruta = sinBarraFinal(u.pathname);
  }

  /** Un `<a href>` cualquiera de la página. */
  verEnlace(href: string | null): void {
    if (!href) return;
    const absoluta = normalizarUrl(href, this.url);
    // El listado enlaza redes sociales y otros dominios: el scrape no sale del origen.
    if (!absoluta || !esDelOrigen(absoluta)) return;

    if (codigoDesdeUrl(absoluta)) {
      this.#fichas.add(absoluta);
      return;
    }

    this.#verPaginacion(absoluta);
  }

  /**
   * El texto del encabezado, para sacarle el total declarado.
   *
   * Acumula el que encuentre y no lo pisa con nada: `HTMLRewriter` puede partir el texto
   * de un elemento en varios eventos, y el `<p>` vacío de `/lanzamientos` no tiene que
   * poder borrar un total ya leído.
   */
  verTotal(texto: string | null): void {
    if (this.#totalProductos !== null) return;
    this.#totalProductos = totalDeclarado(texto ?? '');
  }

  /**
   * Paginación del MISMO listado.
   *
   * EL FILTRO NO ES COSMÉTICO, y es distinto según la clase:
   *
   *  - Un lanzamiento enlaza los lanzamientos anteriores (`?lz=2026-07-14`,
   *    `?lz=2026-06-10`…), así que se acota por `lz`.
   *  - Una categoría enlaza TODAS las demás en su menú, y sus subcategorías y filtros en
   *    la barra lateral, así que se acota por ruta. Una subcategoría es una categoría más
   *    angosta: se recorre si es la que se pidió, y no por colgar de ella.
   *
   * En los dos casos, seguir esos enlaces convierte «importá esta tanda» o «importá las
   * carteras» en «importá el catálogo entero», que es una decisión de quien opera.
   */
  #verPaginacion(absoluta: string): void {
    const u = new URL(absoluta);

    if (this.clase === 'lanzamiento') {
      if (claseDeListado(absoluta) !== 'lanzamiento') return;
      if (u.searchParams.get('lz') !== this.#lz) return;
    } else {
      // Se compara sin barra final porque la paginación es RELATIVA (`?page=2`) y hereda
      // el pathname de la URL que se pegó: comparar los strings crudos partiría la misma
      // categoría en dos según cómo se escribió la dirección.
      if (sinBarraFinal(u.pathname) !== this.#ruta) return;
    }

    const pagina = Number(u.searchParams.get('page'));
    if (!Number.isInteger(pagina) || pagina < 1) return;

    this.#paginas.set(pagina, absoluta);
  }

  resultado(): ListadoExtraido {
    const numeros = [...this.#paginas.keys()].sort((a, b) => a - b);
    return {
      url: this.url,
      clase: this.clase,
      fichas: [...this.#fichas],
      paginas: numeros.map((n) => this.#paginas.get(n)!),
      // Un listado chico no emite paginación. Sin el piso, el progreso de §10.2
      // mostraría «página 1 de 0».
      totalPaginas: Math.max(1, ...numeros),
      totalProductos: this.#totalProductos,
    };
  }
}

/** `/categoria/1-cartera/` y `/categoria/1-cartera` son la misma rama. */
function sinBarraFinal(ruta: string): string {
  return ruta.length > 1 && ruta.endsWith('/') ? ruta.slice(0, -1) : ruta;
}

/**
 * Baja una página del listado y la extrae.
 *
 * El envoltorio no tiene decisiones: dos handlers, dos llamadas al acumulador.
 */
export async function extraerListado(
  url: string,
  { buscar = fetch }: { buscar?: typeof fetch } = {}
): Promise<ListadoExtraido> {
  if (!esDelOrigen(url)) throw new Error(`La URL no es de ${ORIGEN}: ${url}`);

  const acumulador = new AcumuladorListado(url);

  const respuesta = await buscar(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    redirect: 'follow',
  });
  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status} al pedir el listado.`);

  const reescritor = new HTMLRewriter()
    .on('a[href]', {
      element(el) {
        acumulador.verEnlace(el.getAttribute('href'));
      },
    })
    .on(SELECTOR_TOTAL, {
      text(fragmento) {
        acumulador.verTotal(fragmento.text);
      },
    });

  await reescritor.transform(respuesta).arrayBuffer();
  return acumulador.resultado();
}
