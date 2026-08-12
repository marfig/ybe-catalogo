/**
 * ¿Este producto sigue en el catálogo del proveedor?
 *
 * EL STATUS HTTP NO SIRVE, y no es una precaución teórica: medido el 2026-08-11, el
 * sitio devuelve **200 en todo**. `/search/?q=cg15510` de un producto dado de baja
 * responde 200, y una ficha inexistente también, con `<title>Producto no
 * encontrado.</title>`. Un `respuesta.ok` diría que todo el catálogo está vivo.
 *
 * SE CONSULTA POR CÓDIGO Y NO POR `url_origen`. La ficha guardada apunta a UN color
 * (`/producto/{idColor}-{codigo}`): si el proveedor discontinúa ese color pero el
 * modelo sigue, esa URL muere y el producto no. Buscar por código pregunta por el
 * modelo, que es la identidad real del producto (§5.3).
 *
 * LAS TRES RESPUESTAS, y la del medio es la que importa:
 *
 *   presente      — está enlazada la ficha de ESE código.
 *   ausente       — la página de resultados es la correcta y no lo trae.
 *   indeterminado — no se pudo saber. NO es una baja.
 *
 * `indeterminado` existe porque un bloqueo, un mantenimiento o una página de error
 * tienen exactamente cero enlaces de ficha, igual que una baja real. Sin esa
 * distinción, un mal día del proveedor marcaría el catálogo entero como dado de baja
 * en una sola corrida — y del otro lado hay alguien mirando esa lista para borrar.
 *
 * Igual que `ficha.ts`, este archivo casi no tiene decisiones: viven en el acumulador,
 * que es puro y tiene tests. Lo que no se puede probar sin `HTMLRewriter` es sólo el
 * envoltorio.
 */
import { normalizarCodigo } from '../codigo.ts';
import { ORIGEN, codigoDesdeUrl, normalizarUrl } from './origen.ts';
import { USER_AGENT, esDelOrigen } from './ficha.ts';

/** Ruta del buscador del proveedor. */
const RUTA_BUSQUEDA = '/search/';

/**
 * El `og:title` de la página de resultados.
 *
 * Es un MARCADOR DE CONFIRMACIÓN, no la señal principal: sirve para saber que la
 * respuesta es de verdad el buscador y no una página de error que se le parece en lo
 * único que miramos, que es la ausencia de enlaces.
 */
const TITULO_RESULTADOS = 'Resultados de búsqueda';

export type Presencia = 'presente' | 'ausente' | 'indeterminado';

export interface ResultadoPresencia {
  /** El código consultado, en su forma canónica. */
  codigo: string;
  presencia: Presencia;
  /** En castellano: va a la pantalla del barrido y a `scrape_errores`. */
  motivo: string;
  /**
   * La ficha que lo confirma vivo, o `null`.
   *
   * Sirve para refrescar `url_origen`: el proveedor le cambia el `idColor` a un
   * producto cuando le mueve los colores, y la URL guardada queda vieja sin que nada
   * lo note.
   */
  url: string | null;
}

/** La búsqueda del proveedor para un código. Lanza si el código no es válido. */
export function urlDeBusqueda(codigo: string): string {
  const u = new URL(RUTA_BUSQUEDA, ORIGEN);
  u.searchParams.set('q', normalizarCodigo(codigo));
  return u.href;
}

/**
 * Junta la evidencia de una página de búsqueda y decide.
 *
 * Sin estado de red y sin DOM: recibe eventos y devuelve un veredicto, así que corre
 * bajo `node --test`. Es la misma división que sostiene `extractor.ts` frente a
 * `ficha.ts`.
 */
export class AcumuladorPresencia {
  readonly codigo: string;

  /** La ficha del código buscado, si apareció. */
  #encontrada: string | null = null;
  #titulo: string | null = null;
  #urlDeclarada: string | null = null;

  constructor(codigo: string) {
    // Valida ACÁ y no en el envoltorio: un código roto no tiene que llegar a ser un
    // pedido al proveedor.
    this.codigo = normalizarCodigo(codigo);
  }

  /** Un `<meta property>` de la cabecera. */
  verMeta(property: string | null, content: string | null): void {
    if (!property || content === null) return;
    if (property === 'og:title') this.#titulo = content.trim();
    if (property === 'og:url') this.#urlDeclarada = content.trim();
  }

  /**
   * Un `<a href>` de la página.
   *
   * Compara el código EXACTO, nunca «hay algún resultado». Si el buscador algún día
   * devuelve parecidos —`cg85528` cuando se pidió `cg85527`— contarlos como presencia
   * resucitaría un producto que el proveedor dio de baja.
   */
  verEnlace(href: string | null): void {
    if (!href || this.#encontrada) return;

    const absoluta = normalizarUrl(href);
    if (!absoluta || !esDelOrigen(absoluta)) return;

    if (codigoDesdeUrl(absoluta) === this.codigo) this.#encontrada = absoluta;
  }

  /**
   * ¿La respuesta corresponde a la consulta que se hizo?
   *
   * El `og:url` del sitio trae el puerto explícito (`...com.py:443/search/?q=…`), así
   * que se compara parseado y no como string. Sin este chequeo, un caché mal
   * configurado o un redirect servirían la página de otro producto, y su vacío no
   * dice nada sobre éste.
   */
  #consultaCoincide(): boolean {
    if (!this.#urlDeclarada) return false;
    try {
      const q = new URL(this.#urlDeclarada).searchParams.get('q');
      return q !== null && normalizarCodigo(q) === this.codigo;
    } catch {
      return false;
    }
  }

  resultado(): ResultadoPresencia {
    const base = { codigo: this.codigo, url: null } as const;

    /**
     * La evidencia positiva manda sobre los marcadores. Si la ficha del código está
     * enlazada, la página ES la correcta, diga lo que diga el `og:title`. Los
     * marcadores existen para poder creerle a un VACÍO, que es lo ambiguo.
     */
    if (this.#encontrada) {
      return {
        codigo: this.codigo,
        presencia: 'presente',
        motivo: 'El proveedor lo sigue publicando.',
        url: this.#encontrada,
      };
    }

    if (this.#titulo !== TITULO_RESULTADOS) {
      return {
        ...base,
        presencia: 'indeterminado',
        motivo: 'La respuesta no es la página de resultados del buscador.',
      };
    }

    if (!this.#consultaCoincide()) {
      return {
        ...base,
        presencia: 'indeterminado',
        motivo: 'La respuesta corresponde a otra consulta.',
      };
    }

    return {
      ...base,
      presencia: 'ausente',
      motivo: 'El buscador del proveedor no lo encuentra.',
    };
  }
}

export interface OpcionesPresencia {
  /** Inyectable para los tests del endpoint. */
  buscar?: typeof fetch;
}

/**
 * Consulta el buscador del proveedor por un código.
 *
 * NO LANZA ANTE UN PROBLEMA DE RED. Un error acá no es una baja, y convertirlo en una
 * excepción obligaría a quien llama a acordarse de que atraparla significa «no sé».
 * Se devuelve `indeterminado` con el motivo, que es lo que después se muestra.
 *
 * Sí lanza ante un código inválido, y antes de tocar la red: es un error de programa,
 * no del proveedor.
 */
export async function consultarPresencia(
  codigo: string,
  { buscar = fetch }: OpcionesPresencia = {}
): Promise<ResultadoPresencia> {
  const acumulador = new AcumuladorPresencia(codigo);
  const url = urlDeBusqueda(acumulador.codigo);

  let respuesta: Response;
  try {
    respuesta = await buscar(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      redirect: 'follow',
    });
  } catch (error) {
    return {
      codigo: acumulador.codigo,
      presencia: 'indeterminado',
      motivo: error instanceof Error ? error.message : String(error),
      url: null,
    };
  }

  if (!respuesta.ok) {
    return {
      codigo: acumulador.codigo,
      presencia: 'indeterminado',
      motivo: `El proveedor respondió HTTP ${respuesta.status}.`,
      url: null,
    };
  }

  const reescritor = new HTMLRewriter()
    .on('meta[property]', {
      element(el) {
        acumulador.verMeta(el.getAttribute('property'), el.getAttribute('content'));
      },
    })
    /**
     * Sólo `element`, sin handler de texto. §7.3 midió que quien se lleva el
     * presupuesto de CPU es `HTMLRewriter` sobre el HTML, y acá el texto no aporta
     * nada: la señal es estructural —el `href` de la ficha— y la confirmación son dos
     * metas. «Su búsqueda no ha generado resultados» es una copy que el proveedor
     * puede reescribir mañana; el patrón de la URL es lo más estable que expone.
     */
    .on('a[href]', {
      element(el) {
        acumulador.verEnlace(el.getAttribute('href'));
      },
    });

  // Los handlers no corren hasta que se consume el cuerpo transformado.
  await reescritor.transform(respuesta).arrayBuffer();

  return acumulador.resultado();
}
