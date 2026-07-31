/**
 * Espacio duro (U+00A0) que el ICU inserta entre el simbolo y el monto.
 *
 * Es deliberado: evita que "Gs." quede al final de una linea y el numero salte
 * a la siguiente. Se exporta para que los tests puedan afirmarlo explicitamente
 * en vez de esconder un caracter invisible en un literal.
 */
export const ESPACIO_DURO = ' ';

/**
 * Formateador de guaranies.
 *
 * El locale es exactamente 'es-PY'. No es intercambiable:
 *   es-PY  -> "Gs. 285.000"   correcto
 *   es-419 -> "PYG 285,000"   la coma se leeria como decimal
 *   es     -> "285.000 PYG"   simbolo al final
 *
 * `maximumFractionDigits: 0` es explicito aunque el guarani ya tenga 0 decimales
 * en los datos de CLDR: deja la intencion escrita.
 */
const formateador = new Intl.NumberFormat('es-PY', {
  style: 'currency',
  currency: 'PYG',
  maximumFractionDigits: 0,
});

/**
 * Formatea un monto en guaranies.
 *
 * Corre en BUILD, no en el cliente (SPEC §9.3): el simbolo y el espaciado que
 * produce Intl dependen de la version de ICU del runtime, y formatear en el
 * navegador daria salidas distintas entre Chrome, Safari y WebViews viejos.
 * En build hay un solo ICU y el resultado es estable por deploy.
 */
export function formatearGs(monto: number): string {
  if (!Number.isInteger(monto) || monto <= 0) {
    // El schema define precio como z.number().int().positive().nullable()
    // (SPEC §4.1). Un valor fuera de eso es un bug del importador, no un dato:
    // fallar es mejor que renderizar "Gs. NaN" en produccion.
    throw new TypeError(
      `formatearGs espera un entero positivo en guaranies, recibio: ${String(monto)}`
    );
  }
  return formateador.format(monto);
}
