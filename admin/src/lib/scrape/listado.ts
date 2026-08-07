/**
 * El listado de lanzamientos (SPEC-etapa2 §7.1, §7.2).
 *
 * Misma división que la ficha: la decisión vive en un acumulador puro y testeable, y
 * `HTMLRewriter` sólo le pasa eventos.
 */
import { ORIGEN, codigoDesdeUrl, normalizarUrl } from './origen.ts';
import { USER_AGENT, esDelOrigen } from './ficha.ts';

/** Ruta del listado de lanzamientos. */
const RUTA_LISTADO = '/lanzamientos';

export interface ListadoExtraido {
  /** La URL del listado, normalizada. */
  url: string;
  /** Fichas de esta página, en orden de documento y sin repetir. */
  fichas: string[];
  /** Todas las páginas del lanzamiento, ordenadas. */
  paginas: string[];
  /** Cuántas páginas tiene el lanzamiento. Nunca menos de 1. */
  totalPaginas: number;
}

export class AcumuladorListado {
  readonly url: string;
  /** El `lz` de ESTE lanzamiento. Es lo que acota el recorrido. */
  readonly #lz: string | null;

  readonly #fichas = new Set<string>();
  readonly #paginas = new Map<number, string>();

  constructor(url: string) {
    const absoluta = normalizarUrl(url);
    if (!absoluta || !new URL(absoluta).pathname.startsWith(RUTA_LISTADO)) {
      throw new Error(`La URL no es un listado de lanzamientos: ${url}`);
    }
    this.url = absoluta;
    this.#lz = new URL(absoluta).searchParams.get('lz');
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
   * Paginación del MISMO lanzamiento.
   *
   * El filtro por `lz` no es cosmético: la página enlaza los lanzamientos anteriores
   * (`?lz=2026-07-14`, `?lz=2026-06-10`…), y seguirlos convertiría «importar la tanda
   * del 16 de julio» en «importar el catálogo entero» sin que nadie lo pidiera.
   */
  #verPaginacion(absoluta: string): void {
    const u = new URL(absoluta);
    if (!u.pathname.startsWith(RUTA_LISTADO)) return;
    if (u.searchParams.get('lz') !== this.#lz) return;

    const pagina = Number(u.searchParams.get('page'));
    if (!Number.isInteger(pagina) || pagina < 1) return;

    this.#paginas.set(pagina, absoluta);
  }

  resultado(): ListadoExtraido {
    const numeros = [...this.#paginas.keys()].sort((a, b) => a - b);
    return {
      url: this.url,
      fichas: [...this.#fichas],
      paginas: numeros.map((n) => this.#paginas.get(n)!),
      // Un lanzamiento chico no emite paginación. Sin el piso, el progreso de §10.2
      // mostraría «página 1 de 0».
      totalPaginas: Math.max(1, ...numeros),
    };
  }
}

/**
 * Baja una página del listado y la extrae.
 *
 * El envoltorio no tiene decisiones: un handler, una llamada al acumulador.
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

  const reescritor = new HTMLRewriter().on('a[href]', {
    element(el) {
      acumulador.verEnlace(el.getAttribute('href'));
    },
  });

  await reescritor.transform(respuesta).arrayBuffer();
  return acumulador.resultado();
}
