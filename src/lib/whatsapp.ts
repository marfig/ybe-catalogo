export interface ArgsEnlaceWa {
  /** Telefono en formato internacional. Se normaliza. */
  telefono: string;
  /** Nombre del producto. Obligatorio en el mensaje (SPEC §9.7). */
  nombre: string;
  /** URL canonica absoluta del producto. Obligatoria en el mensaje. */
  url: string;
  /** Color de la variante elegida, si hay una. */
  color?: string | undefined;
  /**
   * Codigo del producto (SPEC-etapa2 §5.3). Opcional a proposito.
   *
   * Es el dato con el que el cliente pregunta y con el que quien atiende lo busca en
   * el sistema. Si un dia una ficha se rinde sin el, el boton principal del sitio no
   * puede quedar roto: se omite la linea y el mensaje sigue sirviendo.
   */
  codigo?: string | undefined;
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
        'Formato esperado: codigo de pais + numero sin el 0 inicial, por ejemplo 595981857213.'
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
 *
 * El codigo va ROTULADO y en su propia linea, no pegado al nombre: quien atiende
 * escanea la conversacion en vez de leerla, y un `CG85527` suelto entre parentesis se
 * confunde con parte del nombre del producto.
 *
 * La URL queda SIEMPRE al final: es lo que la mayoria de los clientes de chat
 * convierten en vista previa, y texto despues la parte al medio.
 */
export function construirEnlaceWa({
  telefono,
  nombre,
  url,
  color,
  codigo,
}: ArgsEnlaceWa): string {
  const encabezado = color ? `${nombre} — ${color}` : nombre;

  const lineas = [encabezado];
  // Un codigo en blanco es lo mismo que no tenerlo: «Código:» sin nada al lado se lee
  // como un error del sitio, no como un dato que falta.
  if ((codigo ?? '').trim() !== '') lineas.push(`Código: ${codigo!.trim()}`);
  lineas.push(url);

  const texto = `Hola! Me interesa este producto:\n\n${lineas.join('\n')}`;

  return `https://wa.me/${normalizarTelefono(telefono)}?text=${encodeURIComponent(texto)}`;
}
