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
  /**
   * La apertura del mensaje. Opcional, con el texto de siempre como default.
   *
   * Nace con «Regalos empresariales» (visual-first-pass): ese boton manda a un
   * comprador corporativo, y «Me interesa este producto» describe una compra al
   * detalle, no una cotizacion por cantidad — el vendedor del otro lado atenderia
   * distinto si supiera desde el primer mensaje que es un pedido por volumen.
   *
   * DEFAULT explicito y NO un cambio del texto existente: el boton de la ficha de
   * producto y el de pedidos especiales ya estan en produccion y su mensaje no puede
   * moverse un caracter sin que este archivo lo note en `whatsapp.test.ts`.
   */
  saludo?: string | undefined;
}

/** El saludo de siempre: se cambia aca y arrastra a todo el que no pasa el suyo. */
const SALUDO_POR_DEFECTO = 'Hola! Me interesa este producto:';

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
  saludo = SALUDO_POR_DEFECTO,
}: ArgsEnlaceWa): string {
  const encabezado = color ? `${nombre} — ${color}` : nombre;

  const lineas = [encabezado];
  // Un codigo en blanco es lo mismo que no tenerlo: «Código:» sin nada al lado se lee
  // como un error del sitio, no como un dato que falta.
  if ((codigo ?? '').trim() !== '') lineas.push(`Código: ${codigo!.trim()}`);
  lineas.push(url);

  const texto = `${saludo}\n\n${lineas.join('\n')}`;

  return `https://wa.me/${normalizarTelefono(telefono)}?text=${encodeURIComponent(texto)}`;
}
