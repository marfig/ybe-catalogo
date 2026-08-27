import { normalizarTelefono } from './whatsapp.ts';

/** Las formas de pago que el comercio acepta. */
export type FormaPago = 'efectivo' | 'transferencia' | 'qr';

/**
 * Las opciones de pago, con la palabra que se muestra y la que va al mensaje.
 *
 * ES UN ARREGLO Y NO DOS CADENAS SUELTAS: el formulario itera esto para pintar las
 * opciones y el mensaje lo consulta para rotularlas. Con la lista en un solo lugar,
 * agregar «tarjeta» o «giro» el dia que haga falta es una linea y no una cacería por
 * los archivos que la mencionan.
 *
 * `etiqueta` en singular y capitalizada porque se usa en los dos lados: como texto de
 * la opcion en pantalla y como valor de «Pago:» en el mensaje. Dos cadenas para lo
 * mismo se desincronizan.
 */
export const FORMAS_PAGO = [
  { valor: 'efectivo', etiqueta: 'Efectivo' },
  { valor: 'transferencia', etiqueta: 'Transferencia' },
  // «QR» en mayúsculas y no «Qr»: es una sigla, y capitalizarla como palabra la hace
  // leer como un nombre propio. Por eso la etiqueta se escribe a mano y no se deriva
  // del valor con un `capitalizar()`.
  { valor: 'qr', etiqueta: 'QR' },
] as const satisfies readonly { valor: FormaPago; etiqueta: string }[];

/**
 * El pedido: los datos que el cliente carga en el formulario de `/pedir`.
 *
 * NO incluye el producto. Un pedido es «quién soy y dónde lo quiero»; el producto
 * llega por separado, desde la ficha. Mezclarlos haría que cada campo nuevo del
 * formulario obligara a tocar la ficha.
 */
export interface DatosPedido {
  nombre: string;
  /** Como lo tipeó el cliente. Se normaliza recién al validar. */
  telefono: string;
  direccion: string;
  ciudad: string;
  /** Cómo llegar. Opcional: en Asunción una dirección suele alcanzar. */
  referencia?: string | undefined;
  cantidad: number;
  /**
   * Cómo paga. `null` es «todavía no eligió», y NO TIENE DEFAULT a propósito.
   *
   * Preseleccionar «Efectivo» —que es lo más común— haría que todo pedido por
   * transferencia de quien no leyó el campo llegue como efectivo. Un default que se
   * acepta sin mirar no es una comodidad: es un dato equivocado con apariencia de
   * dato cargado.
   */
  pago: FormaPago | null;
  /**
   * ¿Quiere factura? `false` SÍ tiene default, al contrario de `pago`, y la asimetría
   * es deliberada.
   *
   * Un default equivocado en `pago` manda un dato FALSO —un pedido por transferencia
   * que llega como efectivo—. Acá el error posible es distinto: quien quería factura y
   * no tildó simplemente no la pide, y lo resuelve en el mismo chat con una línea. No
   * se corrompe nada, y a cambio la mayoría —que no factura— no tiene que contestar
   * una pregunta más.
   */
  factura: boolean;
  /** RUC. Obligatorio SÓLO con `factura: true`. */
  ruc: string;
  /** Razón social. Obligatoria SÓLO con `factura: true`. */
  razonSocial: string;
  notas?: string | undefined;
}

/** Los campos que el formulario exige. El resto es opcional. */
const OBLIGATORIOS = ['nombre', 'telefono', 'direccion', 'ciudad'] as const;

/** Un error por campo. Vacío = el pedido pasa. */
export type ErroresPedido = Partial<Record<keyof DatosPedido, string>>;

/**
 * El producto sobre el que se pide, tal como lo necesita el mensaje.
 *
 * `codigo` y `color` son opcionales A PROPÓSITO, con el mismo criterio que
 * `construirEnlaceWa`: si una ficha se rinde sin ellos, el botón principal del sitio
 * no puede quedar roto — se omite la línea y el mensaje sigue sirviendo.
 */
export interface ProductoPedido {
  nombre: string;
  /** URL canónica absoluta del producto. */
  url: string;
  codigo?: string | undefined;
  color?: string | undefined;
}

/**
 * Lo que la ficha le pasa al formulario por la URL.
 *
 * ES UN IDENTIFICADOR, NO UNA COPIA DEL PRODUCTO. El nombre, el código y el precio
 * los resuelve el formulario contra `/indice.json`, que es la única fuente de esos
 * datos en el cliente. Copiarlos en la query string sería un segundo lugar donde
 * viven, y el que se desincroniza siempre es la copia.
 */
export interface ContextoPedido {
  /** El `id` de la entrada de contenido, que es el slug de la ficha. */
  slug: string;
  sku?: string | undefined;
  /**
   * El color elegido. Viaja aunque se pueda deducir del sku porque el índice no
   * lleva variantes: sin esto el formulario no podría mostrar «Azul marino».
   */
  color?: string | undefined;
}

/**
 * Claves de una letra, misma razón que en `/indice.json`: es una URL que el cliente
 * ve y que puede terminar pegada en un chat. `?p=mochila&v=CG1-AZ` se lee de un
 * golpe; `?producto=...&variante=...` la parte en dos renglones en un teléfono.
 */
const PARAM = { slug: 'p', sku: 'v', color: 'c' } as const;

/** La ruta del formulario. Una sola constante para el botón y para el test. */
export const RUTA_PEDIDO = '/pedir';

/** Arma el `href` del botón «Pedí ahora» de la ficha. */
export function urlDeFormulario({ slug, sku, color }: ContextoPedido): string {
  const params = new URLSearchParams({ [PARAM.slug]: slug });

  // Un `?v=` vacío es peor que ninguno: el formulario tendría que distinguir «sin
  // variante» de «variante en blanco», y son lo mismo.
  if ((sku ?? '').trim() !== '') params.set(PARAM.sku, sku!.trim());
  if ((color ?? '').trim() !== '') params.set(PARAM.color, color!.trim());

  return `${RUTA_PEDIDO}?${params}`;
}

/**
 * Lee el contexto de la query string del formulario.
 *
 * Devuelve `null` SIN PRODUCTO, y eso no es un caso raro: `/pedir` es una URL
 * estática y alguien puede llegar de un enlace pegado a medias o de un marcador
 * viejo. La página tiene que poder decirlo en vez de renderizar una ficha fantasma.
 */
export function leerContextoPedido(search: string): ContextoPedido | null {
  const params = new URLSearchParams(search);
  const slug = params.get(PARAM.slug)?.trim();
  if (!slug) return null;

  const sku = params.get(PARAM.sku)?.trim();
  const color = params.get(PARAM.color)?.trim();

  return {
    slug,
    ...(sku ? { sku } : {}),
    ...(color ? { color } : {}),
  };
}

/**
 * Un RUC paraguayo: número base y dígito verificador, separados por guión.
 *
 * Se acepta un solo guión —el separador— y se toleran puntos y espacios: es cómo la
 * gente copia un RUC de una factura vieja. El verificador es UN dígito por definición;
 * dos serían parte del número base y entonces el guión estaría en otro lugar.
 *
 * NO se verifica el dígito con el algoritmo de la SET. Se descartó a propósito: un
 * cálculo mal implementado rechazaría RUCs reales, y el costo de dejar pasar uno con un
 * tipeo es que la persona que emite la factura lo lea y pregunte. Acá se valida la
 * FORMA, que es lo que resuelve la ambigüedad; la identidad la valida quien factura.
 */
function rucValido(ruc: string): boolean {
  const partes = ruc.trim().split('-');
  if (partes.length !== 2) return false;

  const base = (partes[0] ?? '').replace(/[.\s]/g, '');
  const verificador = (partes[1] ?? '').trim();

  if (!/^\d{6,}$/.test(base)) return false;
  return /^\d$/.test(verificador);
}

/**
 * Valida el pedido y devuelve un error por campo.
 *
 * Devuelve TODOS los errores de una vez y no el primero: un formulario que revela
 * un problema por intento hace que el cliente lo abandone en el tercero.
 */
export function validarPedido(datos: DatosPedido): ErroresPedido {
  const errores: ErroresPedido = {};

  for (const campo of OBLIGATORIOS) {
    if ((datos[campo] ?? '').trim() === '') errores[campo] = 'Completá este dato.';
  }

  // El teléfono se mide en DÍGITOS y no en caracteres: «(0981) 123-456» es un número
  // válido tipeado como lo tipea cualquiera, y contar su largo crudo lo aceptaría
  // igual que «------------». Un móvil paraguayo son 10 dígitos (0981123456); se pide
  // 9 para no rechazar un fijo de Asunción (021123456).
  if (!errores.telefono && datos.telefono.replace(/\D/g, '').length < 9) {
    errores.telefono = 'Parece incompleto. Ej.: 0981 123 456.';
  }

  // La forma de pago se valida por PERTENENCIA a la lista y no por `!= null`: asi un
  // valor viejo que quedo en un enlace guardado o en el estado de la isla no pasa
  // como valido y termina en el mensaje como «Pago: undefined».
  if (!FORMAS_PAGO.some((f) => f.valor === datos.pago)) {
    errores.pago = 'Elegí cómo vas a pagar.';
  }

  /**
   * Los datos de factura se exigen SÓLO si se la pidió.
   *
   * EL GUIÓN DEL DÍGITO VERIFICADOR ES OBLIGATORIO. No es rigor de más: un RUC sin
   * separar es ambiguo. En `800123456` no hay forma de saber si el contribuyente es el
   * 80012345 con verificador 6, o el 800123456 al que le falta el verificador — y quien
   * emite la factura tiene que saberlo, porque con el número equivocado la factura sale
   * a nombre de otro y hay que anularla.
   *
   * Lo que NO se exige es el formato completo: los puntos de miles y los espacios
   * alrededor del guión se aceptan, porque `4.567.890-1` y `80012345 - 6` son cómo la
   * gente copia un RUC de una factura vieja. Se pide el separador, no la prolijidad.
   *
   * Seis dígitos es el piso del número base —un RUC de persona física— sin contar el
   * verificador; por debajo de eso no hay tipeo posible que sea un RUC.
   */
  if (datos.factura) {
    if (!rucValido(datos.ruc)) {
      errores.ruc = 'Escribilo con el guion del dígito verificador. Ej.: 80012345-6.';
    }
    if (datos.razonSocial.trim() === '') {
      errores.razonSocial = 'Completá este dato.';
    }
  }

  // `Number.isInteger` cubre el NaN que devuelve un `<input type="number">` vacío: sin
  // esto un pedido sin cantidad pasaría la validación y llegaría con «Cantidad: NaN».
  if (!Number.isInteger(datos.cantidad) || datos.cantidad < 1) {
    errores.cantidad = 'Tiene que ser 1 o más.';
  }

  return errores;
}

/**
 * Arma el texto del pedido.
 *
 * MISMA FORMA que el mensaje de consulta (`construirEnlaceWa`) y por las mismas
 * razones: los rótulos en su propia línea porque quien atiende escanea la
 * conversación en vez de leerla, y la URL SIEMPRE al final porque es lo que los
 * clientes de chat convierten en vista previa, y texto después la parte al medio.
 *
 * Va en tres bloques —producto, cliente, enlace— porque son tres cosas distintas que
 * quien atiende usa en momentos distintos: buscar el artículo, cargar el envío,
 * confirmar que es ese.
 */
export function construirMensajePedido({
  producto,
  datos,
}: {
  producto: ProductoPedido;
  datos: DatosPedido;
}): string {
  const encabezado = producto.color ? `${producto.nombre} — ${producto.color}` : producto.nombre;

  const delProducto = [encabezado];
  if ((producto.codigo ?? '').trim() !== '') {
    delProducto.push(`Código: ${producto.codigo!.trim()}`);
  }
  // La cantidad se rotula sólo cuando dice algo. «Cantidad: 1» es el caso normal:
  // escribirlo en cada pedido entrena a quien atiende a saltear esa línea, y el día
  // que diga 3 la va a saltear igual.
  if (datos.cantidad > 1) delProducto.push(`Cantidad: ${datos.cantidad}`);

  // El pago va con el PRODUCTO y no con el cliente: es parte de cómo se cierra esta
  // venta, no un dato de quién la hace. Quien atiende lo lee junto al monto.
  const pago = FORMAS_PAGO.find((f) => f.valor === datos.pago);
  if (pago) delProducto.push(`Pago: ${pago.etiqueta}`);

  const delCliente = [
    `Nombre: ${datos.nombre.trim()}`,
    `Teléfono: ${datos.telefono.trim()}`,
    `Dirección: ${datos.direccion.trim()}`,
    `Ciudad: ${datos.ciudad.trim()}`,
  ];
  if ((datos.referencia ?? '').trim() !== '') {
    delCliente.push(`Referencia: ${datos.referencia!.trim()}`);
  }
  /**
   * La factura va con el CLIENTE porque es quién es fiscalmente, no cómo se entrega.
   *
   * Se consulta `datos.factura` y NO la presencia de `ruc`: la isla conserva lo tipeado
   * al destildar, para no hacerle perder el dato a quien duda y vuelve. Quien arma el
   * mensaje es el que tiene que respetar el «no quiero factura».
   *
   * No se emite «Factura: No» en los pedidos sin factura, por el mismo motivo que no se
   * emite «Cantidad: 1»: una línea que dice lo normal en todos los mensajes entrena a
   * quien atiende a saltearla, y el día que diga otra cosa la va a saltear igual. La
   * presencia del RUC ES el pedido de factura.
   */
  if (datos.factura) {
    delCliente.push(`RUC: ${datos.ruc.trim()}`);
    delCliente.push(`Razón social: ${datos.razonSocial.trim()}`);
  }

  if ((datos.notas ?? '').trim() !== '') delCliente.push(`Nota: ${datos.notas!.trim()}`);

  return [
    'Hola! Quiero hacer un pedido:',
    delProducto.join('\n'),
    delCliente.join('\n'),
    producto.url,
  ].join('\n\n');
}

/**
 * El enlace con el que se envía el pedido.
 *
 * VA POR WHATSAPP Y NO A UN ENDPOINT, y es una decisión del sitio y no una comodidad:
 * el catálogo es `output: 'static'` —eso es lo que lo hace costar $0 y no caerse—, así
 * que no hay dónde recibir un POST. Y el pedido termina igual en la conversación donde
 * el vendedor lo atiende, con la diferencia de que ahora llega con los datos completos
 * en vez de con un «hola, cuánto sale».
 *
 * El día que haya un endpoint que persista pedidos, esta función es el único punto que
 * cambia.
 */
export function enlacePedidoWa({
  telefono,
  producto,
  datos,
}: {
  telefono: string;
  producto: ProductoPedido;
  datos: DatosPedido;
}): string {
  const texto = construirMensajePedido({ producto, datos });
  return `https://wa.me/${normalizarTelefono(telefono)}?text=${encodeURIComponent(texto)}`;
}
