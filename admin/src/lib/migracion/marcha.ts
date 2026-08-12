/**
 * El avance de la migración, que se ve en la pestaña mientras corre.
 *
 * PIEZA PURA, igual que `marcha.ts` y `barrido.ts` y por el mismo motivo: el bucle vive
 * en el navegador (§7.1), así que las decisiones que tomaría un servidor las toma código
 * de cliente — y ese código no se puede testear si además hace `fetch` y toca el DOM.
 */

/** Qué pasó con un producto del catálogo viejo. */
export type Suerte =
  /** Entró con sus variantes y fotos, y quedó curado. */
  | 'migrado'
  /** El proveedor ya no lo publica. Se saltea: no tiene fotos ni colores de dónde salir. */
  | 'ausente'
  /** Ya estaba en el catálogo con nombre propio. La guarda de `aplicarCuraduria` lo dejó. */
  | 'yaEstaba'
  /** No se pudo resolver. NO es una baja: en otra corrida se vuelve a preguntar. */
  | 'indeterminado'
  /** Falló algo del camino. Queda anotado con su motivo. */
  | 'problema';

export interface AvanceMigracion {
  /** Cuántos productos tiene el catálogo viejo. Es el denominador. */
  total: number;
  migrados: number;
  ausentes: number;
  yaEstaban: number;
  indeterminados: number;
  problemas: number;
}

export const AVANCE_INICIAL: Readonly<AvanceMigracion> = Object.freeze({
  total: 0,
  migrados: 0,
  ausentes: 0,
  yaEstaban: 0,
  indeterminados: 0,
  problemas: 0,
});

/** Suma una suerte. Devuelve un avance nuevo; no toca el que recibe. */
export function sumar(avance: AvanceMigracion, suerte: Suerte): AvanceMigracion {
  switch (suerte) {
    case 'migrado':
      return { ...avance, migrados: avance.migrados + 1 };
    case 'ausente':
      return { ...avance, ausentes: avance.ausentes + 1 };
    case 'yaEstaba':
      return { ...avance, yaEstaban: avance.yaEstaban + 1 };
    case 'indeterminado':
      return { ...avance, indeterminados: avance.indeterminados + 1 };
    default:
      return { ...avance, problemas: avance.problemas + 1 };
  }
}

/** Cuántos se resolvieron ya, de cualquier manera. */
export function resueltos(a: AvanceMigracion): number {
  return a.migrados + a.ausentes + a.yaEstaban + a.indeterminados + a.problemas;
}

/**
 * Porcentaje de la barra.
 *
 * Todo lo resuelto cuenta, incluidos los ausentes y los problemas: la barra mide cuánto
 * queda del recorrido, no cuántos productos entraron. Dejar los ausentes afuera daría una
 * barra que nunca llega al final aunque no falte nada por hacer — y acá los ausentes son
 * la mitad del catálogo.
 */
export function porcentaje(a: AvanceMigracion): number {
  if (a.total <= 0) return 0;
  return Math.max(0, Math.min(100, (resueltos(a) / a.total) * 100));
}

/**
 * El renglón de progreso.
 *
 * LOS AUSENTES SE NOMBRAN SIEMPRE, incluso en cero, porque son la mitad del catálogo
 * viejo y quien mira necesita ver que eso es lo esperado y no una falla. Los otros tres
 * sólo si los hay: un «0 con problema» permanente enseña a ignorar el lugar donde después
 * aparece el aviso de verdad. Mismo criterio que `textoDeBarrido`.
 */
export function textoDeMigracion(a: AvanceMigracion): string {
  const partes = [
    `Revisados ${resueltos(a)} de ${a.total}`,
    `${a.migrados} importados`,
    `${a.ausentes} que el proveedor ya no publica`,
  ];

  if (a.yaEstaban > 0) partes.push(`${a.yaEstaban} que ya tenías`);
  if (a.indeterminados > 0) partes.push(`${a.indeterminados} sin respuesta`);
  if (a.problemas > 0) partes.push(`${a.problemas} con problema`);

  return partes.join(' · ');
}
