/**
 * La marcha de una importación: qué falta pedir, cuánto se lleva hecho y cuándo
 * toca el próximo pedido (SPEC-etapa2 §7.1, §7.4, §10.2).
 *
 * PIEZA PURA, Y LA ÚNICA DEL SCRAPE QUE CORRE EN EL NAVEGADOR. El bucle vive en la
 * pestaña (§7.1), así que las decisiones que antes tomaba un servidor —a qué página ir,
 * qué ficha saltear, cuándo esperar— ahora las toma código de cliente. Ese código no se
 * puede testear con `node --test` si además hace `fetch` y toca el DOM: por eso acá está
 * TODO lo que decide, y en `scripts/importar-cliente.ts` sólo lo que no se puede probar
 * sin un navegador.
 *
 * Es la misma división que ya sostiene `extractor.ts` frente a `ficha.ts`.
 */
import { normalizarCodigo } from '../codigo.ts';
import { codigoDesdeUrl } from './origen.ts';

/** 1 request por segundo al proveedor. Sin excepciones (§7.4). */
export const PASO_MS = 1000;

/**
 * Identidad de una página del listado.
 *
 * EXISTE POR UNA TRAMPA CONCRETA: quien importa pega `?lz=2026-07-16`, sin `page`, y la
 * paginación de esa misma página se enlaza a sí misma como `?lz=2026-07-16&page=1`. Son
 * dos strings distintos y la misma página. Sin esta clave, la primera página del
 * lanzamiento se pide dos veces —un viaje de más al proveedor— y sus fichas se cuentan
 * dos veces en el progreso.
 *
 * Una URL que no parsea se devuelve tal cual: no se puede decidir nada sobre ella, y
 * mentir con una clave inventada la haría chocar contra otra.
 */
export function clavePagina(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const lz = u.searchParams.get('lz') ?? '';
  const pagina = u.searchParams.get('page') ?? '1';
  return `${u.origin}${u.pathname}?lz=${lz}&page=${pagina}`;
}

/**
 * Las páginas del listado que todavía no se visitaron, en el orden en que vinieron.
 *
 * El orden del proveedor se respeta —es el orden de la paginación— y no se reordena por
 * número: si el sitio algún día enlaza las páginas de otra forma, seguirlo es más
 * seguro que imponerle un criterio propio.
 */
export function paginasPendientes(paginas: string[], vistas: Iterable<string>): string[] {
  const conocidas = new Set(vistas);
  const pendientes: string[] = [];

  for (const pagina of paginas) {
    const clave = clavePagina(pagina);
    if (conocidas.has(clave)) continue;
    conocidas.add(clave);
    pendientes.push(pagina);
  }

  return pendientes;
}

/**
 * Las fichas que hay que pedirle al proveedor, salteando las que ya están cubiertas.
 *
 * ESTE FILTRO ES LA CORTESÍA, NO UNA OPTIMIZACIÓN. La ficha de un color ya revela a
 * todos sus hermanos (§7.2), así que pedir la del hermano es un viaje al proveedor por
 * datos que ya están. El servidor también corta por código, pero recién DESPUÉS de
 * bajar la ficha: para cuando se entera, el pedido ya se hizo. El único corte que
 * ahorra tráfico al proveedor es este.
 *
 * Se compara por CÓDIGO y no por URL porque un mismo modelo se alcanza por la URL de
 * cualquiera de sus colores: `/producto/71803-cg86003` y `/producto/71804-cg86003` son
 * el mismo producto.
 */
export function sinVisitar(fichas: string[], codigosVistos: Iterable<string>): string[] {
  const vistos = new Set<string>();
  for (const codigo of codigosVistos) {
    // Un código roto en la lista de vistos no puede tumbar el recorrido: no filtra nada.
    try {
      vistos.add(normalizarCodigo(codigo));
    } catch {
      continue;
    }
  }

  const pendientes: string[] = [];
  for (const ficha of fichas) {
    const codigo = codigoDesdeUrl(ficha);
    // Un enlace que no es ficha de producto no se pide: al listado llegan «quiénes
    // somos», redes y demás.
    if (!codigo || vistos.has(codigo)) continue;
    vistos.add(codigo);
    pendientes.push(ficha);
  }

  return pendientes;
}

/**
 * Los códigos de una lista de URLs de ficha, sin los que no son ficha.
 *
 * Es lo que se le suma a los códigos vistos cuando una ficha revela a sus hermanos: a
 * partir de ahí, cualquier URL de esos modelos deja de pedirse.
 */
export function codigosDe(urls: string[]): string[] {
  const codigos: string[] = [];
  for (const url of urls) {
    const codigo = codigoDesdeUrl(url);
    if (codigo && !codigos.includes(codigo)) codigos.push(codigo);
  }
  return codigos;
}

/** Lo que lleva hecho la corrida. */
export interface Marcha {
  paginasHechas: number;
  totalPaginas: number;
  /** Fichas que el proveedor sirvió, incluidas las que el servidor omitió. */
  leidas: number;
  /** Productos que no existían. */
  nuevos: number;
  /** Productos que ya estaban y se actualizaron sin pisar curaduría (§7.5). */
  repetidos: number;
  /** Productos a los que el origen les sumó un color: hay que mirarlos (§7.5). */
  avisados: number;
  errores: number;
  /**
   * Fichas que NO se le pidieron al proveedor porque su código ya estaba en el
   * catálogo.
   *
   * Va aparte de `leidas` justamente porque no se leyeron: sumarlas ahí diría que se
   * hicieron 50 pedidos cuando se hicieron 12, y el número que importa para la
   * cortesía de §7.4 es cuántos salieron de verdad.
   */
  salteados: number;
}

export const MARCHA_INICIAL: Readonly<Marcha> = Object.freeze({
  paginasHechas: 0,
  totalPaginas: 1,
  leidas: 0,
  nuevos: 0,
  repetidos: 0,
  avisados: 0,
  errores: 0,
  salteados: 0,
});

/** Lo que devuelve `/api/scrape/ficha`, en lo que le importa a la contabilidad. */
export interface RespuestaFicha {
  codigo?: string;
  creado?: boolean;
  omitida?: boolean;
  avisoDeCambio?: boolean;
  error?: string;
}

/**
 * Suma una ficha al progreso. Devuelve una marcha nueva; no toca la que recibe.
 *
 * Una ficha OMITIDA cuenta como leída pero no como producto: el proveedor igual la
 * sirvió —el corte del servidor pasa después de bajarla— y contarla como nueva o
 * repetida mentiría sobre cuántos productos entraron al catálogo.
 */
export function contarFicha(marcha: Marcha, respuesta: RespuestaFicha): Marcha {
  if (respuesta.error) {
    return { ...marcha, errores: marcha.errores + 1 };
  }

  const siguiente = { ...marcha, leidas: marcha.leidas + 1 };
  if (respuesta.omitida) return siguiente;

  if (respuesta.creado) siguiente.nuevos += 1;
  else siguiente.repetidos += 1;

  if (respuesta.avisoDeCambio) siguiente.avisados += 1;

  return siguiente;
}

/** `n` con su sustantivo en singular o plural. */
function plural(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * El renglón de progreso de §10.2.
 *
 * «Página 3 de 7» y no «3 de 7 páginas» porque quien mira quiere saber DÓNDE está el
 * recorrido, no cuánto midió. Los errores se nombran sólo si los hay: un «0 con error»
 * permanente enseña a ignorar el lugar donde después aparece el aviso de verdad.
 */
export function textoDeMarcha(marcha: Marcha): string {
  const { paginasHechas, totalPaginas, leidas, nuevos, errores, salteados } = marcha;

  // Terminada la última página el contador se quedaría en «página 8 de 7».
  const actual = Math.min(paginasHechas + 1, totalPaginas);

  const partes = [
    `Página ${actual} de ${totalPaginas}`,
    plural(leidas, 'ficha leída', 'fichas leídas'),
    plural(nuevos, 'producto nuevo', 'productos nuevos'),
  ];
  // Los salteados van ANTES de los errores: son la noticia buena y la mayoría del
  // recorrido cuando la opción está tildada.
  if (salteados > 0) partes.push(`${salteados} que ya tenía`);
  if (errores > 0) partes.push(`${errores} con error`);

  return partes.join(' · ');
}

/**
 * Porcentaje de la barra: páginas enteras más la fracción de la que se está haciendo.
 *
 * No se mide en fichas totales porque no se saben hasta terminar de recorrer todas las
 * páginas. Una barra que crece y de golpe retrocede porque apareció una página nueva es
 * peor que una barra un poco gruesa.
 */
export function avance({
  paginasHechas,
  totalPaginas,
  fichasDePagina,
  fichasHechas,
}: {
  paginasHechas: number;
  totalPaginas: number;
  fichasDePagina: number;
  fichasHechas: number;
}): number {
  if (totalPaginas <= 0) return 0;

  // Una página sin fichas está hecha en cuanto se leyó: dividir por cero daría NaN y la
  // barra desaparecería.
  const fraccion = fichasDePagina > 0 ? fichasHechas / fichasDePagina : 0;
  const bruto = ((paginasHechas + fraccion) / totalPaginas) * 100;

  return Math.max(0, Math.min(100, bruto));
}

/**
 * Cuánto falta esperar antes del próximo pedido al proveedor (§7.4).
 *
 * El piso en 0 no es defensivo por costumbre: `Date.now()` puede RETROCEDER con un
 * ajuste de hora, y una resta negativa haría disparar el `setTimeout` al instante —
 * justo la cortesía que hay que sostener sin que nadie esté mirando.
 */
export function esperaMs(ultimoPedido: number | null, ahora: number, paso = PASO_MS): number {
  if (ultimoPedido === null) return 0;

  const transcurrido = ahora - ultimoPedido;
  if (transcurrido < 0) return paso;

  return Math.max(0, paso - transcurrido);
}
