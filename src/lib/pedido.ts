import { normalizarTelefono } from './whatsapp.ts';

/** Las formas de pago que el comercio acepta. */
export type FormaPago = 'efectivo' | 'transferencia';

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
