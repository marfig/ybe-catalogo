/**
 * Extracción de una ficha del proveedor (SPEC-etapa2 §7.2).
 *
 * POR QUÉ ES UN ACUMULADOR DE EVENTOS Y NO UN PARSER.
 *
 * El runtime parsea con `HTMLRewriter`, que es streaming y nativo de Workers — no
 * carga el DOM ni suma una dependencia. Pero `HTMLRewriter` NO EXISTE en Node, así
 * que un extractor que lo use por dentro es un extractor que no se puede testear con
 * `node --test`. Y la Fase 2.5 pide reimplementar el spike **con tests**.
 *
 * La salida es separar las dos cosas: acá vive toda la decisión, alimentada por los
 * mismos eventos que emite `HTMLRewriter` (`ficha.ts` es el envoltorio, y no tiene ni
 * un `if` adentro). Los tests empujan los eventos a mano.
 */
import {
  ALT_GALERIA,
  RUTA_IMAGENES,
  codigoDesdeUrl,
  colorDesdeTitulo,
  esFichaDelMismoModelo,
  normalizarUrl,
  skuDeOrigen,
} from './origen.ts';

/** Otra ficha del mismo modelo: un color hermano. */
export interface Hermano {
  /** URL absoluta de la ficha del hermano. */
  url: string;
  /** El color tal cual lo escribe el proveedor, con prefijo: `(T) MARRON CLARO`. */
  colorOrigen: string | null;
  /**
   * Su foto, la del bloque de colores. `null` si ese `<a>` no llevaba imagen.
   *
   * NO ES UNA MINIATURA DE BAJA RESOLUCIÓN, y esto se midió el 2026-08-07 sobre
   * `/producto/71163-cg85700`: es el MISMO archivo de 600×600 que sirve la ficha propia
   * del hermano — mismo hash de 80 hex, mismo peso al byte. Por eso alcanza con visitar
   * una sola ficha por modelo y todos los colores igual se quedan con su foto.
   */
  foto: string | null;
}

export interface FichaExtraida {
  codigo: string;
  url: string;
  /** El color de ESTA ficha. Sale del título; ver `colorDesdeTitulo`. */
  colorOrigen: string | null;
  /** Fotos del producto, en orden de aparición y sin repetir. */
  fotos: string[];
  hermanos: Hermano[];
  /**
   * Las medidas ya redactadas, listas para leer.
   *
   * `null` cuando la ficha no las trae. Las ocho fichas medidas el 2026-08-12 las
   * traían todas, así que el nullable NO es un caso observado sino una falla segura:
   * una ficha sin medidas entra igual, con descripción vacía, en vez de romper la
   * importación de la tanda entera.
   */
  medidas: string | null;
}

/**
 * La redacción del catálogo, no la del proveedor.
 *
 * Él escribe de DOS formas —`Medidas: ( alto x largo x ancho ):` y
 * `Medidas aprox. (alto x largo x ancho):`—, con espacios sueltos dentro del paréntesis.
 * Esto es lo que va a leer el cliente en la ficha, así que se escribe acá una vez y no se
 * copia del origen.
 */
export const ETIQUETA_MEDIDAS = 'Medidas aprox. (alto x largo x ancho)';

/**
 * Reconoce la celda de la etiqueta. Basta con la palabra: la llave es el orden.
 *
 * ERA `/^\s*medidas\s*:/i` Y COSTÓ 427 PRODUCTOS. Ese patrón exigía el `:` pegado a la
 * palabra, así que reconocía `Medidas: (…)` y NO `Medidas aprox. (…)` — que es la forma
 * mayoritaria del proveedor. Medido el 2026-08-19 sobre lo importado de lanzamientos: 427
 * productos sin descripción contra 31 con ella, con las medidas presentes en las fichas de
 * los dos grupos y en el mismo marcado. La diferencia era la palabra `aprox.`.
 *
 * El comentario de arriba ya decía «basta con la palabra»; el patrón no lo implementaba. El
 * `\b` es lo que ahora lo cumple, y a la vez evita que `Medidasx` cuele — aunque si colara,
 * `normalizarMedidas` devuelve `null` ante un valor que no son medidas.
 */
const ES_ETIQUETA_MEDIDAS = /^\s*medidas\b/i;

/**
 * Deja el valor del proveedor legible: `18 X 27 X 8cm` -> `18 x 27 x 8 cm`.
 *
 * Devuelve `null` si no hay ni un dígito. Una celda vacía con la etiqueta delante
 * dejaría «Medidas aprox. (alto x largo x ancho):» y nada después, que es peor que no
 * tener medidas.
 */
function normalizarMedidas(bruto: string): string | null {
  const limpio = bruto.replace(/\s+/g, ' ').trim();
  if (!/\d/.test(limpio)) return null;

  return limpio
    .replace(/\s*[xX×]\s*/g, ' x ')
    .replace(/(\d)\s*(cm|mm|m)\b/gi, '$1 $2');
}

/** Atributos de un `<img>`, tal como los devuelve `getAttribute`. */
export interface AtributosImagen {
  src: string | null;
  alt?: string | null;
  title?: string | null;
}

export class AcumuladorFicha {
  readonly codigo: string;
  readonly url: string;

  /** Por URL, para colapsar el mismo hermano enlazado desde varios `<a>`. */
  readonly #hermanos = new Map<string, Hermano>();
  /** `Set` y no array: la misma foto viene dos veces, normal y `magniflier`. */
  readonly #fotos = new Set<string>();

  #colorOrigen: string | null = null;
  /** Bandera de contexto. Los `<a>` no anidan, así que una referencia alcanza. */
  #hermanoActual: Hermano | null = null;
  /**
   * Estamos dentro de un `<a>` a la ficha de OTRO producto.
   *
   * Es una segunda barrera, no la principal: la regla que separa los recomendados es
   * el `alt` (§7.2), porque la hipótesis estructural se midió falsa. Pero una imagen
   * que esté a la vez dentro del enlace a otro producto y con nuestro `alt` de
   * galería no es nuestra bajo ninguna lectura, y dejarla pasar le colgaría al
   * producto la foto de otro.
   */
  #enlaceAjeno = false;
  /** Texto acumulado del `<a>` hermano en curso. */
  #textoEnlace = '';
  /** Texto acumulado de la `<td>` en curso. Las celdas no anidan en este HTML. */
  #textoCelda = '';
  /** La celda anterior era la etiqueta de medidas, así que ésta trae el valor. */
  #esperandoMedidas = false;

  #medidas: string | null = null;

  constructor(url: string) {
    const codigo = codigoDesdeUrl(url);
    if (!codigo) throw new Error(`La URL no tiene forma de ficha: ${url}`);
    this.codigo = codigo;
    this.url = normalizarUrl(url) ?? url;
  }

  /** `<meta property="..." content="...">`. Sólo interesa `og:title`. */
  verMeta(property: string | null, content: string | null): void {
    if ((property ?? '').toLowerCase() !== 'og:title') return;
    this.#tomarTitulo(content ?? '');
  }

  /** Texto de `<title>`. Trae lo mismo que `og:title`; sirve de respaldo. */
  verTitulo(texto: string): void {
    this.#tomarTitulo(texto);
  }

  #tomarTitulo(texto: string): void {
    // El primero que sirva gana: `og:title` y `<title>` traen lo mismo, y si el
    // proveedor los desincroniza no hay forma de saber cuál miente.
    if (this.#colorOrigen) return;
    this.#colorOrigen = colorDesdeTitulo(texto, this.codigo);
  }

  /** `<a href>` de apertura. */
  abrirEnlace(href: string | null): void {
    this.#hermanoActual = null;
    this.#enlaceAjeno = false;
    this.#textoEnlace = '';
    if (!href) return;

    const absoluta = normalizarUrl(href);
    if (!absoluta) return;

    // La ficha no se enlaza a sí misma — medido — pero si algún día lo hiciera se
    // duplicaría el color actual como si fuera un hermano.
    if (absoluta === this.url) return;

    // Un enlace a OTRO código es un recomendado del carrusel, que rota en cada
    // request. Tomarlo rompería la idempotencia sin dar ningún error (§7.2).
    if (!esFichaDelMismoModelo(absoluta, this.codigo)) {
      this.#enlaceAjeno = absoluta.includes('/producto/');
      return;
    }

    let hermano = this.#hermanos.get(absoluta);
    if (!hermano) {
      hermano = { url: absoluta, colorOrigen: null, foto: null };
      this.#hermanos.set(absoluta, hermano);
    }
    this.#hermanoActual = hermano;
  }

  /** Cierre del `<a>` abierto. */
  cerrarEnlace(): void {
    const hermano = this.#hermanoActual;
    const texto = this.#textoEnlace.trim();
    this.#hermanoActual = null;
    this.#enlaceAjeno = false;
    this.#textoEnlace = '';

    // El proveedor emite DOS `<a>` por hermano: uno con la miniatura y otro con el
    // nombre como texto. Se aprovechan los dos, con el `title` de la miniatura como
    // fuente primaria porque es la que la spec verificó.
    if (hermano && !hermano.colorOrigen && texto) hermano.colorOrigen = texto;
  }

  /** Texto suelto. Sólo cuenta si estamos dentro de un `<a>` hermano. */
  verTexto(texto: string): void {
    if (this.#hermanoActual) this.#textoEnlace += texto;
  }

  /** `<td>` de apertura. */
  abrirCelda(): void {
    this.#textoCelda = '';
  }

  /** Texto dentro de la `<td>` en curso. Llega en trozos, y a veces dentro de un `<span>`. */
  verTextoCelda(texto: string): void {
    this.#textoCelda += texto;
  }

  /**
   * Cierre de la `<td>`. Acá está toda la decisión de las medidas.
   *
   * LA LLAVE ES EL ORDEN, NO LA ESTRUCTURA, y eso es deliberado. La página tiene tres
   * tablas y las celdas de `#other-colors-tbl` pasan por el mismo handler: sin exigir
   * la etiqueta en la celda anterior, el nombre de un color hermano terminaría en la
   * descripción del producto. Es la misma lección que las fotos de la galería, donde
   * la hipótesis estructural se midió falsa y ganó la regla por contenido (§7.2).
   */
  cerrarCelda(): void {
    const texto = this.#textoCelda;
    this.#textoCelda = '';

    if (ES_ETIQUETA_MEDIDAS.test(texto)) {
      this.#esperandoMedidas = true;
      return;
    }

    if (!this.#esperandoMedidas) return;
    this.#esperandoMedidas = false;

    // La primera gana, igual que el título y la foto del hermano: si apareciera una
    // segunda tabla de medidas, pisar la primera daría un dato equivocado en vez de
    // un error, y eso llega hasta el cliente.
    if (this.#medidas) return;

    const valor = normalizarMedidas(texto);
    if (valor) this.#medidas = `${ETIQUETA_MEDIDAS}: ${valor}`;
  }

  /** `<img src>`. Decide si es foto del producto, miniatura de color, o ruido. */
  verImagen({ src, alt, title }: AtributosImagen): void {
    if (!src || !src.includes(RUTA_IMAGENES)) return;
    const absoluta = normalizarUrl(src);
    if (!absoluta) return;

    /**
     * Dentro de un `<a>` hermano: la imagen es DEL HERMANO, no de esta variante.
     *
     * Se queda con él y no entra a `#fotos`. Colgársela a esta variante le pondría la
     * foto del color equivocado, y eso llega hasta el cliente que pide por WhatsApp.
     *
     * La primera gana, igual que con el título: si un segundo `<a>` del bloque trajera
     * un icono de la ruta de imágenes, pisaría la foto de verdad y el síntoma sería una
     * foto equivocada, no un error.
     */
    if (this.#hermanoActual) {
      const nombre = (title ?? '').trim();
      if (nombre) this.#hermanoActual.colorOrigen = nombre;
      if (!this.#hermanoActual.foto) this.#hermanoActual.foto = absoluta;
      return;
    }

    // Dentro del enlace a otro producto no hay nada nuestro, tenga el `alt` que tenga.
    if (this.#enlaceAjeno) return;

    // Fuera de un hermano, sólo `alt="product-thumb"` es foto del producto. Se probó
    // la hipótesis estructural («un recomendado cuelga de un `<a>` a otro producto»)
    // y se midió FALSA: los recomendados no están dentro de un enlace. Por eso ESTA
    // es la regla principal y la de arriba sólo un refuerzo.
    if ((alt ?? '').trim() !== ALT_GALERIA) return;

    this.#fotos.add(absoluta);
  }

  resultado(): FichaExtraida {
    return {
      codigo: this.codigo,
      url: this.url,
      colorOrigen: this.#colorOrigen,
      // El orden de inserción se conserva y es el del documento: dos corridas sobre
      // el mismo HTML dan el mismo array, que es lo que hace verificable §7.5.
      fotos: [...this.#fotos],
      hermanos: [...this.#hermanos.values()],
      medidas: this.#medidas,
    };
  }
}

/** Las fotos de un color y la variante a la que pertenecen. */
export interface FotosDeColor {
  sku: string;
  fotos: string[];
}

/**
 * Reparte las fotos de la ficha entre las variantes de TODOS los colores del modelo.
 *
 * EL BUG QUE ESTA FUNCIÓN CIERRA. Antes sólo el color de la ficha visitada recibía
 * fotos. Los colores hermanos entraban como variantes desde el bloque de colores y se
 * quedaban vacíos, porque su ficha nunca se visita: la saltea el corte por código de la
 * cortesía (§7.4). En pantalla se veían todos los colores y sólo uno con imagen.
 *
 * Y no hacía falta ir a buscarlas: la foto del hermano ya viene en esta misma página, en
 * el bloque de colores, y es el mismo archivo de 600×600 que sirve su propia ficha
 * (medido el 2026-08-07 sobre `/producto/71163-cg85700`). Un modelo de tres colores
 * sigue costando UNA ficha.
 *
 * El SKU sale de `skuDeOrigen`, la misma función con la que `registrarFicha` crea la
 * variante. Si fueran dos caminos distintos, la foto se vincularía a un SKU que no
 * existe y el error aparecería lejos de la causa.
 */
export function fotosPorColor(ficha: FichaExtraida): FotosDeColor[] {
  const salida: FotosDeColor[] = [];

  const agregar = (colorOrigen: string | null, fotos: string[]): void => {
    if (!colorOrigen || fotos.length === 0) return;
    try {
      salida.push({ sku: skuDeOrigen(ficha.codigo, colorOrigen), fotos });
    } catch {
      /**
       * Un color del que no sale SKU tampoco generó variante: `registrarFicha` lo contó
       * en `coloresSinNombre` y no hay dónde colgar la foto. Se saltea en silencio
       * porque el producto YA se registró, y lanzar acá lo perdería entero por una foto.
       */
    }
  };

  agregar(ficha.colorOrigen, ficha.fotos);
  for (const hermano of ficha.hermanos) {
    agregar(hermano.colorOrigen, hermano.foto ? [hermano.foto] : []);
  }

  return salida;
}
