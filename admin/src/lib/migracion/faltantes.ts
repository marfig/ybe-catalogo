/**
 * El avance de la migración de los faltantes, que se ve en la pestaña mientras corre.
 *
 * PIEZA PURA, igual que `marcha.ts` y `barrido.ts` y por el mismo motivo: el bucle vive en
 * el navegador (§7.1), así que las decisiones que tomaría un servidor las toma código de
 * cliente — y ese código no se puede testear si además hace `fetch` y toca el DOM.
 *
 * POR QUÉ NO SE REUSA `marcha.ts`, que cuenta lo mismo con otros nombres: ése tiene
 * casilleros para `ausente` e `indeterminado`, que son la mitad de su historia —le pregunta
 * al proveedor si todavía publica cada producto— y acá no existen. Estos 177 son TODOS
 * ausentes del proveedor: es la definición del lote, no un resultado de la corrida. Un
 * contador que siempre vale cero es una pregunta que alguien va a hacerse en vano.
 */

/** Qué pasó con un producto del catálogo viejo. */
export type Suerte =
  /** Entró con su nombre, su precio, su descripción y sus fotos. */
  | 'creado'
  /** Ya estaba en el catálogo. La guarda de `crearDesdeViejo` lo dejó intacto. */
  | 'yaEstaba'
  /** Falló algo del camino. Queda anotado con su motivo. */
  | 'problema';

export interface AvanceFaltantes {
  /** Cuántos productos hay que traer. Es el denominador. */
  total: number;
  creados: number;
  yaEstaban: number;
  problemas: number;
}

export const AVANCE_INICIAL: Readonly<AvanceFaltantes> = Object.freeze({
  total: 0,
  creados: 0,
  yaEstaban: 0,
  problemas: 0,
});

/** Suma una suerte. Devuelve un avance nuevo; no toca el que recibe. */
export function sumar(avance: AvanceFaltantes, suerte: Suerte): AvanceFaltantes {
  switch (suerte) {
    case 'creado':
      return { ...avance, creados: avance.creados + 1 };
    case 'yaEstaba':
      return { ...avance, yaEstaban: avance.yaEstaban + 1 };
    default:
      return { ...avance, problemas: avance.problemas + 1 };
  }
}

/** Cuántos se resolvieron ya, de cualquier manera. */
export function resueltos(a: AvanceFaltantes): number {
  return a.creados + a.yaEstaban + a.problemas;
}

/**
 * Porcentaje de la barra.
 *
 * Todo lo resuelto cuenta, incluidos los problemas: la barra mide cuánto queda del
 * recorrido, no cuántos productos entraron. Dejar afuera lo que falló daría una barra que
 * nunca llega al final aunque no quede nada por hacer.
 */
export function porcentaje(a: AvanceFaltantes): number {
  if (a.total <= 0) return 0;
  return Math.max(0, Math.min(100, (resueltos(a) / a.total) * 100));
}

/**
 * El renglón de progreso.
 *
 * Lo importado se nombra SIEMPRE, y el resto sólo si lo hay: un «0 con problema» permanente
 * enseña a ignorar el lugar donde después aparece el aviso de verdad. Mismo criterio que
 * `textoDeMigracion` y `textoDeBarrido`.
 */
export function textoDeFaltantes(a: AvanceFaltantes): string {
  const partes = [`Revisados ${resueltos(a)} de ${a.total}`, `${a.creados} importados`];

  if (a.yaEstaban > 0) partes.push(`${a.yaEstaban} que ya tenías`);
  if (a.problemas > 0) partes.push(`${a.problemas} con problema`);

  return partes.join(' · ');
}
