export interface ArgsEnlaceWa {
  /** Telefono en formato internacional. Se normaliza. */
  telefono: string;
  /** Nombre del producto. Obligatorio en el mensaje (SPEC §9.7). */
  nombre: string;
  /** URL canonica absoluta del producto. Obligatoria en el mensaje. */
  url: string;
  /** Color de la variante elegida, si hay una. */
  color?: string | undefined;
}

/**
 * Normaliza un telefono al formato que exige wa.me: solo digitos, con codigo de
 * pais, sin `+`, sin ceros iniciales, sin espacios, guiones ni parentesis.
 */
export function normalizarTelefono(telefono: string): string {
  const digitos = telefono.replace(/[^\d]/g, '');

  if (digitos.length === 0) {
    throw new TypeError('El telefono de WhatsApp esta vacio.');
  }

  // El formato local paraguayo (0971...) o el numero pelado (971...) abren un
  // chat equivocado o ninguno, y el boton principal del sitio queda roto en
  // silencio. Se exige largo de internacional y que no empiece en 0.
  if (digitos.startsWith('0') || digitos.length < 11) {
    throw new TypeError(
      `El telefono "${telefono}" no tiene codigo de pais. ` +
        'Formato esperado: codigo de pais + numero sin el 0 inicial, por ejemplo 595971878090.'
    );
  }

  return digitos;
}

/**
 * Arma el enlace de WhatsApp con el mensaje pre-cargado.
 *
 * El mensaje incluye SIEMPRE el nombre del producto y su URL canonica: es lo
 * que convierte una consulta en algo que el vendedor puede atender sin
 * preguntar de que producto se trata.
 */
export function construirEnlaceWa({ telefono, nombre, url, color }: ArgsEnlaceWa): string {
  const encabezado = color ? `${nombre} — ${color}` : nombre;
  const texto = `Hola! Me interesa este producto:\n\n${encabezado}\n${url}`;

  return `https://wa.me/${normalizarTelefono(telefono)}?text=${encodeURIComponent(texto)}`;
}
