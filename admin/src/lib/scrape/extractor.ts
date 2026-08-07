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
} from './origen.ts';

/** Otra ficha del mismo modelo: un color hermano. */
export interface Hermano {
  /** URL absoluta de la ficha del hermano. */
  url: string;
  /** El color tal cual lo escribe el proveedor, con prefijo: `(T) MARRON CLARO`. */
  colorOrigen: string | null;
}

export interface FichaExtraida {
  codigo: string;
  url: string;
  /** El color de ESTA ficha. Sale del título; ver `colorDesdeTitulo`. */
  colorOrigen: string | null;
  /** Fotos del producto, en orden de aparición y sin repetir. */
  fotos: string[];
  hermanos: Hermano[];
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
      hermano = { url: absoluta, colorOrigen: null };
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

  /** `<img src>`. Decide si es foto del producto, miniatura de color, o ruido. */
  verImagen({ src, alt, title }: AtributosImagen): void {
    if (!src || !src.includes(RUTA_IMAGENES)) return;
    const absoluta = normalizarUrl(src);
    if (!absoluta) return;

    // Dentro de un `<a>` hermano: es la miniatura del selector de color, no una foto
    // de esta variante. Colgársela le pondría la foto del color equivocado, y eso
    // llega hasta el cliente que pide por WhatsApp.
    if (this.#hermanoActual) {
      const nombre = (title ?? '').trim();
      if (nombre) this.#hermanoActual.colorOrigen = nombre;
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
    };
  }
}
