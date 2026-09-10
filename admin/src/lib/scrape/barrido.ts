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
 * `rotacion` NO es lo mismo que `nada`: cuando ya no quedan productos vírgenes sigue
 * habiendo trabajo, porque el barrido es una rotación y lo revisado hace meses vuelve a
 * ser lo más viejo. Callarse ahí se leería como «ya está todo revisado».
 */
export type Resto =
  | { tipo: 'nada' }
  | { tipo: 'sin-revisar'; cuantos: number }
  | { tipo: 'rotacion'; enLaCorrida: number; total: number };

export interface DatosDelResto {
  /** Una selección tildada en la grilla, en vez de la cola automática. */
  aMano: boolean;
  /** Todos los barribles del catálogo. */
  total: number;
  /** Cuántos entran en esta corrida. */
  enLaCorrida: number;
  /** Barribles que no se revisaron nunca, en todo el catálogo. */
  sinRevisarNunca: number;
  /** De esos, cuántos entran en esta corrida. */
  sinRevisarEnLaCorrida: number;
}

/**
 * El renglón que anuncia lo que no entró en la corrida.
 *
 * EL BUG QUE ESTA FUNCIÓN CIERRA, reportado el 2026-09-10 con el síntoma «dice que
 * quedan 1157 y en la segunda corrida dice lo mismo». El cálculo vivía suelto en
 * `barrido.astro` y era `contarBarribles() - cola.length`: **los dos términos son
 * constantes**. El total no baja cuando se revisa —un producto revisado sigue siendo
 * barrible— y el tope de la corrida es fijo, así que el número decía 1157 para siempre.
 * El barrido avanzaba perfecto y la pantalla insistía en que no.
 *
 * Se mide contra lo que NUNCA se revisó, que es el único conteo que baja al trabajar.
 *
 * VIVE ACÁ Y NO EN LA PÁGINA por lo mismo que el resto de este archivo: la aritmética
 * que nadie puede testear es la que se equivoca callada durante meses.
 */
export function restoDelBarrido({
  aMano,
  total,
  enLaCorrida,
  sinRevisarNunca,
  sinRevisarEnLaCorrida,
}: DatosDelResto): Resto {
  // Quien tildó en la grilla ya eligió: no hay resto que anunciarle.
  if (aMano) return { tipo: 'nada' };

  /**
   * `Math.max` porque los conteos y la cola salen de tres consultas distintas: entre una
   * y otra puede entrar un alta o una baja desde otra pestaña, y «quedan -4» es peor que
   * no decir nada.
   */
  const cuantos = Math.max(0, sinRevisarNunca - sinRevisarEnLaCorrida);
  if (cuantos > 0) return { tipo: 'sin-revisar', cuantos };

  /**
   * `sinRevisarNunca === 0` y NO el resultado de la resta, aunque acá los dos valgan
   * cero. La diferencia aparece cuando los conteos llegan desfasados: la resta clampeada
   * también da cero, y caer en `rotacion` desde ahí anunciaría «ya se revisaron todos
   * alguna vez» habiendo productos vírgenes. Cambiar una mentira por otra más sutil no
   * es arreglar nada. `rotacion` significa que no queda ninguno sin revisar, y eso lo
   * dice el conteo, no una resta entre consultas que no son simultáneas.
   */
  if (sinRevisarNunca === 0 && total > enLaCorrida) {
    return { tipo: 'rotacion', enLaCorrida, total };
  }

  return { tipo: 'nada' };
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
