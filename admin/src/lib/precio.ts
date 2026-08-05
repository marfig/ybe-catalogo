/**
 * Precio tipeado en la grilla: texto libre -> INTEGER de guaranies.
 *
 * PIEZA PURA.
 *
 * El peor resultado posible no es un error, es un precio INVENTADO: si "285.OOO" —
 * con la letra O por el cero — entrara como 285 o como 0, el producto se publica con
 * un precio que nadie escribio. Por eso todo lo que no sea inequivocamente un numero
 * se rechaza en vez de interpretarse.
 */

/**
 * Tope de cordura.
 *
 * No hay un maximo real de precio; lo que hay es un maximo plausible. Veinte digitos
 * no son un precio, son un dedo apoyado en una tecla. Gs. 9.999.999.999 son unos
 * USD 1.300.000 al cambio de 2026: nada del catalogo se le acerca.
 */
const MAXIMO = 9_999_999_999;

/** Separadores de miles que se escriben en Paraguay, mas el espacio. */
const SEPARADORES = /[.\s]/g;

/**
 * Parsea el precio. Devuelve `null` para vacio — que significa "Consultar precio"
 * (SPEC.md §7.3) — y LANZA ante cualquier cosa ambigua.
 */
export function parsearPrecio(texto: string): number | null {
  const original = texto ?? '';
  // El prefijo se saca primero: "Gs. 285.000" es lo que se copia y pega del catalogo.
  const limpio = original.trim().replace(/^gs\.?\s*/i, '');

  if (limpio === '') return null;

  // La coma solo aparece como separador decimal en un precio en guaranies, y el
  // guarani no tiene centavos. Se rechaza antes de limpiar para poder decir por que.
  if (/,/.test(limpio)) {
    throw new Error(
      `Precio invalido: ${JSON.stringify(original)}. El guarani no lleva centavos; ` +
        'escribir el monto entero, por ejemplo 285.000.'
    );
  }

  const digitos = limpio.replace(SEPARADORES, '');

  // Un punto usado como decimal cae aca: "285000.50" queda "28500050", que seria un
  // precio mil veces mayor. Se distingue mirando el original: un punto seguido de
  // menos de tres digitos no es separador de miles.
  if (/\.\d{1,2}$/.test(limpio)) {
    throw new Error(
      `Precio invalido: ${JSON.stringify(original)}. Parece llevar decimales y el ` +
        'guarani no los tiene.'
    );
  }

  if (!/^\d+$/.test(digitos)) {
    throw new Error(
      `Precio invalido: ${JSON.stringify(original)}. Solo numeros, con punto para los ` +
        'miles: 285.000. Vacio significa "Consultar precio".'
    );
  }

  const valor = Number(digitos);
  if (valor > MAXIMO) {
    throw new Error(
      `Precio invalido: ${JSON.stringify(original)}. Es mas alto que ` +
        `${formatearPrecio(MAXIMO)}, asi que parece un error de tipeo.`
    );
  }

  return valor;
}

/**
 * Formatea para pintar en el input.
 *
 * Usa `Intl` con `es-PY`, que separa los miles con punto. El ida y vuelta
 * `parsear(formatear(n)) === n` esta cubierto por test: si el formato no se pudiera
 * volver a parsear, abrir la grilla y guardar sin tocar nada cambiaria los precios.
 */
export function formatearPrecio(valor: number | null): string {
  if (valor === null) return '';
  return new Intl.NumberFormat('es-PY').format(valor);
}
