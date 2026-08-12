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
