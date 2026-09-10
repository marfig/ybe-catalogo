/**
 * El progreso del barrido, que se ve en la pestaña mientras corre.
 *
 * PIEZA PURA, igual que `marcha.ts` y por el mismo motivo: el bucle vive en el
 * navegador (§7.1), así que las decisiones que tomaría un servidor las toma código de
 * cliente — y ese código no se puede testear si además hace `fetch` y toca el DOM.
 * Acá está todo lo que decide; en `scripts/barrido-cliente.ts`, sólo lo que necesita
 * un navegador.
 *
 * La ESPERA entre pedidos no se redefine acá: sale de `marcha.ts`, que ya la tiene
 * medida y testeada. Un barrido que se inventara su propio paso podría ir más rápido
 * que la importación sin que nadie lo hubiera decidido.
 */
import type { Presencia } from './presencia.ts';

/** Lo que puede pedir un POST a `/barrido`. */
export type PostDeBarrido =
  | { tipo: 'cerrar'; scrapeId: number }
  | { tipo: 'seleccion'; ids: number[] };

/**
 * Qué pide un POST a `/barrido`.
 *
 * DOS FORMULARIOS DISTINTOS LE PEGAN A LA MISMA RUTA. El de la pantalla del barrido
 * cierra una corrida que quedó colgada y manda `scrapeId`. El de la grilla manda los
 * productos tildados como `id`, y no manda `scrapeId` en absoluto.
 *
 * EL BUG QUE ESTA FUNCIÓN CIERRA, reportado el 2026-08-12 con el síntoma «tildé dos y
 * dice que va a revisar 6». La decisión era `Number.isInteger(Number(scrapeId))`, y
 * **`Number(null)` es `0`, que es un entero**: todo POST de la grilla se leía como
 * «cerrá la corrida 0», redirigía a `/barrido`, y la selección se perdía en el camino.
 * La pantalla se rendía por GET con la cola automática, así que «Verificar en el
 * proveedor» nunca revisó lo que alguien había tildado — y el `try/catch` del cierre se
 * comía el error de la corrida inexistente sin dejar rastro.
 *
 * `> 0` y no sólo `isInteger`: `Number('')` también es 0, y no existe ninguna corrida 0,
 * así que un cero nunca es un cierre legítimo.
 */
export function interpretarPostDeBarrido(
  scrapeId: string | null,
  ids: readonly string[]
): PostDeBarrido {
  const n = scrapeId === null ? Number.NaN : Number(scrapeId);
  if (Number.isInteger(n) && n > 0) return { tipo: 'cerrar', scrapeId: n };

  return {
    tipo: 'seleccion',
    ids: ids.map(Number).filter((i) => Number.isInteger(i) && i > 0),
  };
}

/**
 * Qué queda para después de esta corrida.
 *
 * `ultima` NO es lo mismo que `nada`: la corrida que cierra la vuelta merece anunciarse,
 * porque es la que convierte el barrido en algo que se termina en vez de una rueda que
 * gira para siempre.
 */
export type Resto =
  | { tipo: 'nada' }
  | { tipo: 'resto'; cuantos: number }
  | { tipo: 'ultima' };

export interface DatosDelResto {
  /** Una selección tildada en la grilla, en vez de la cola automática. */
  aMano: boolean;
  /** Lo que le falta a la vuelta en curso, ya contado contra su `iniciada_en`. */
  pendientes: number;
  /** Cuántos entran en esta corrida. */
  enLaCorrida: number;
}

/**
 * El renglón que anuncia lo que no entró en la corrida.
 *
 * TERCERA VERSIÓN, y las dos anteriores fallaron por la misma razón de fondo: las dos
 * intentaban derivar «cuánto falta» del estado de `productos`, y de ahí no se puede.
 * El barrido es una ROTACIÓN — se revisan los 300 más viejos, esos pasan a ser los más
 * nuevos, y el catálogo queda tan barrible como estaba. El estado después de una corrida
 * es equivalente al de antes, así que toda cuenta derivada de él da lo mismo siempre.
 *
 *   1. `contarBarribles() - cola.length`: dos constantes. Decía 1157 en la primera
 *      corrida y 1157 en la quinta, con el barrido avanzando perfecto.
 *   2. `revisado_en_origen IS NULL`: baja de verdad, pero UNA SOLA VEZ en la vida del
 *      catálogo. Llega a cero y no vuelve a subir. Mide el arranque en frío, no el trabajo.
 *
 * Lo que faltaba era el ANCLA, y no estaba en los productos: está en cuándo se decidió
 * empezar la vuelta (`vuelta.ts`, migración `0009`). Con eso, `pendientes` llega ya
 * calculado y esta función sólo decide qué se dice.
 */
export function restoDelBarrido({ aMano, pendientes, enLaCorrida }: DatosDelResto): Resto {
  // Quien tildó en la grilla ya eligió: no hay resto que anunciarle.
  if (aMano) return { tipo: 'nada' };

  /**
   * `Math.max` porque el pendiente y la cola son dos consultas distintas: entre una y otra
   * puede entrar un alta o una baja desde otra pestaña, y «quedan -4» es peor que nada.
   */
  const cuantos = Math.max(0, pendientes - enLaCorrida);
  if (cuantos > 0) return { tipo: 'resto', cuantos };

  // Si hay algo para revisar y no queda resto, esta corrida cierra la vuelta.
  return enLaCorrida > 0 ? { tipo: 'ultima' } : { tipo: 'nada' };
}

export interface Avance {
  /** Cuántos productos entraron a esta corrida. */
  total: number;
  presentes: number;
  /** Los que el proveedor ya no publica. Es lo que se va a mirar. */
  ausentes: number;
  /** Los que no se pudieron resolver. NO son bajas (ver `presencia.ts`). */
  indeterminados: number;
}

export const AVANCE_INICIAL: Readonly<Avance> = Object.freeze({
  total: 0,
  presentes: 0,
  ausentes: 0,
  indeterminados: 0,
});

/** Suma una respuesta. Devuelve un avance nuevo; no toca el que recibe. */
export function sumar(avance: Avance, presencia: Presencia): Avance {
  if (presencia === 'presente') return { ...avance, presentes: avance.presentes + 1 };
  if (presencia === 'ausente') return { ...avance, ausentes: avance.ausentes + 1 };
  return { ...avance, indeterminados: avance.indeterminados + 1 };
}

/** Cuántos se pidieron ya, resueltos o no. */
export function revisados(avance: Avance): number {
  return avance.presentes + avance.ausentes + avance.indeterminados;
}

/**
 * Porcentaje de la barra.
 *
 * Los indeterminados CUENTAN como recorrido: la barra mide cuánto falta del recorrido,
 * no cuántas respuestas sirvieron. Un producto que no se pudo resolver ya se pidió y no
 * se vuelve a pedir en esta corrida — dejarlo afuera haría una barra que nunca llega al
 * final aunque no quede nada por hacer.
 */
export function porcentaje(avance: Avance): number {
  if (avance.total <= 0) return 0;
  return Math.max(0, Math.min(100, (revisados(avance) / avance.total) * 100));
}

/** `n` con su participio en singular o plural. */
function plural(n: number, singular: string, muchos: string): string {
  return `${n} ${n === 1 ? singular : muchos}`;
}

/**
 * El renglón de progreso.
 *
 * Las bajas se nombran SIEMPRE, incluso en cero —«ninguno dado de baja»— porque es el
 * resultado bueno y el más frecuente: un renglón que se calla deja a quien mira sin
 * saber si el barrido llegó a revisar algo. Los sin respuesta, en cambio, sólo si los
 * hay: un «0 sin respuesta» permanente enseña a ignorar el lugar donde después aparece
 * el aviso de verdad.
 */
export function textoDeBarrido(avance: Avance): string {
  const partes = [
    `Revisados ${revisados(avance)} de ${avance.total}`,
    avance.ausentes === 0
      ? 'ninguno dado de baja'
      : plural(avance.ausentes, 'dado de baja', 'dados de baja'),
  ];

  if (avance.indeterminados > 0) partes.push(`${avance.indeterminados} sin respuesta`);

  return partes.join(' · ');
}

/**
 * Qué se ofrece cuando la corrida termina.
 *
 * `vuelta-completa` NO es `nada`: haber cubierto el catálogo entero es el final del
 * trabajo y merece decirse ahí mismo, sin obligar a recargar para enterarse.
 */
export type Continuar =
  | { tipo: 'nada' }
  | { tipo: 'seguir'; cuantos: number }
  | { tipo: 'vuelta-completa' };

/**
 * Cuánto falta después de esta corrida, según lo que devolvió `/api/scrape/cerrar`.
 *
 * EL AGUJERO QUE ESTO TAPA: `correr()` deshabilita «Empezar a revisar» al arrancar y
 * `cerrar()` no lo vuelve a habilitar —sólo lo hace `terminar()`, que es el camino de
 * error—. Al terminar bien, la pantalla se quedaba sin ninguna salida y había que
 * recargar a mano para seguir. Una vuelta de cinco corridas obligaba a adivinar eso cinco
 * veces, sobre una pantalla que justo abajo te decía que quedaban 1157.
 *
 * `automatico` DECIDE ANTES QUE EL NÚMERO, y la primera versión se equivocó feo. Un
 * comentario acá afirmaba que una selección tildada en la grilla «no mueve la vuelta», y
 * es FALSO: no la abre, pero si hay una abierta y el producto tildado estaba pendiente,
 * `marcar()` le escribe `revisado_en_origen` y la cuenta baja igual. Un chequeo puntual de
 * tres productos podía terminar anunciando «con esto se completó la vuelta».
 *
 * Que la cuenta baje está BIEN —a esos productos se les preguntó de verdad—; atribuirle el
 * final de la vuelta a quien tildó tres filas, no. El servidor manda el número siempre,
 * porque es un dato de la vuelta y no de la corrida; acá se decide a quién le corresponde.
 *
 * `null` llega cuando no hay vuelta abierta, y también cuando el cierre salió bien pero el
 * conteo falló (ver el `try` propio de `api/scrape/cerrar.ts`). Los dos casos quieren lo
 * mismo: no ofrecer nada. La salida de la pantalla la da el «volver» del panel.
 *
 * Cualquier cosa que no sea un entero se trata igual, a propósito: el servidor puede
 * contestar un error con forma de JSON, y un botón que promete «seguir con 857» sobre un
 * dato inventado es peor que no ofrecer nada.
 */
export function continuarDespuesDe(
  pendientes: number | null | undefined,
  { automatico }: { automatico: boolean }
): Continuar {
  if (!automatico) return { tipo: 'nada' };
  if (!Number.isInteger(pendientes)) return { tipo: 'nada' };

  const cuantos = pendientes as number;
  if (cuantos <= 0) return { tipo: 'vuelta-completa' };

  return { tipo: 'seguir', cuantos };
}
