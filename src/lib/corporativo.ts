/**
 * Regalos empresariales: el catalogo corporativo (banner de la home + pagina propia).
 *
 * PIEZA PURA, mismo criterio que `buscar.ts`: nada de acá conoce `astro:content`, para
 * que el orden, el agrupamiento y la resolucion de foto se prueben con `node --test`
 * sin levantar Astro. Las paginas que SI necesitan `getCollection`/`getEntries`
 * (Header, el banner, la pagina `/regalos-empresariales`) resuelven la coleccion y le
 * pasan a estas funciones datos ya planos.
 */

import type { Imagen } from './imagenes.ts';

/** Un color de una ficha, tal como lo imprime el catalogo: codigo + nombre + si es
 * el color principal fotografiado o una alternativa que solo se nombra. */
export interface ColorImpreso {
  codigo: string;
  nombre: string;
  alternativo: boolean;
}

/**
 * Una entrada de `regalos-empresariales.json`: la ficha completa tal como sale del
 * catalogo impreso, con el `id` del producto que la ilustra.
 */
export interface RegaloSeleccionado {
  id: string;
  orden: number;
  seccion: string;
  ordenSeccion: number;
  codigo: string;
  medidas: string;
  consultarOtros: boolean;
  etiqueta?: string | undefined;
  fotoColor?: string | undefined;
  colores: ColorImpreso[];
}

/** Lo minimo que necesita `resolverSeleccion` de un producto para poder ubicarlo. */
export interface ProductoSeleccionable {
  id: string;
}

/** Un producto ya emparejado con la entrada impresa que lo selecciono. */
export interface Emparejado<T> {
  entrada: RegaloSeleccionado;
  producto: T;
}

/**
 * Resuelve la seleccion contra el catalogo de productos, en el orden curado, y
 * conserva la entrada impresa de cada match.
 *
 * MISMO CRITERIO QUE `resolverCategorias` (src/lib/productos.ts): un id sin producto
 * no rompe el build ni avisa, se descarta en silencio. La seleccion la carga a mano
 * quien arma el catalogo corporativo, y el producto detras de un id puede darse de baja
 * despues —`activo: false`, o borrarse del todo— sin que nadie vuelva a tocar este
 * archivo. Ese hueco lo nota quien revisa la pagina publicada, no un error de build que
 * tumba el sitio entero por una sola entrada vieja.
 *
 * DEVUELVE EL PAR (entrada, producto) y no solo el producto: `derivarProductoCorporativo`
 * necesita la entrada completa —seccion, codigo, medidas, colores impresos— para armar
 * la ficha, y esa entrada no se puede reconstruir despues de perder la referencia.
 *
 * Generica en `T` y no atada a `Producto` de astro:content: asi se prueba con objetos
 * planos, sin depender del runtime de Astro.
 */
export function resolverSeleccion<T extends ProductoSeleccionable>(
  seleccion: RegaloSeleccionado[],
  productos: T[]
): Emparejado<T>[] {
  const porId = new Map(productos.map((p) => [p.id, p]));

  return [...seleccion]
    .sort((a, b) => a.orden - b.orden || (a.id < b.id ? -1 : 1))
    .map((entrada) => ({ entrada, producto: porId.get(entrada.id) }))
    .filter((par): par is Emparejado<T> => Boolean(par.producto));
}

/** Una variante, en lo minimo que hace falta para resolver la foto de portada. */
export interface VarianteCorporativa {
  sku: string;
  /** Ausente se trata como activa: mismo default que el schema (`z.boolean().default(true)`). */
  activo?: boolean;
  imagenes: Imagen[];
}

/** Lo que `derivarProductoCorporativo` necesita leer de un producto del catalogo. */
export interface ProductoCorporativoOrigen {
  id: string;
  nombre: string;
  variantes: VarianteCorporativa[];
}

/** Lo que la vitrina corporativa muestra de un producto: la ficha impresa completa. */
export interface ProductoCorporativo {
  id: string;
  nombre: string;
  /** El codigo impreso (`RegaloSeleccionado.codigo`), NO `origen.ref` del producto:
   * el catalogo impreso es la fuente de este dato, no la ficha del producto. */
  codigo: string;
  medidas: string;
  consultarOtros: boolean;
  etiqueta: string | undefined;
  colores: ColorImpreso[];
  imagen: Imagen | undefined;
  seccion: string;
  ordenSeccion: number;
  orden: number;
}

/**
 * Resuelve la foto de portada de una ficha corporativa: la variante del color que el
 * catalogo impreso fotografio (`fotoColor`), no la primera variante activa del
 * producto —ese es el criterio de la ficha normal, y aca hay una foto elegida a mano.
 *
 * MATCH POR SEGMENTO Y NO POR PREFIJO SUELTO: el sku tiene que ser exactamente
 * `<codigo>-<fotoColor>`, o arrancar con `<codigo>-<fotoColor>-` (guion incluido). Sin
 * ese guion de cierre, un `startsWith` ingenuo hace que el color "3" matchee de
 * arrastre una variante "3-23" —otro color que por casualidad arranca con el mismo
 * digito— y la portada corporativa sale con la foto de un color que no es.
 *
 * Case-insensitive porque el codigo de color impreso y el sufijo del sku no siempre
 * coinciden en mayusculas (`R1` impreso vs `r1` cargado).
 *
 * SIN filtrar por `activo`: `fotoColor` es la foto que el catalogo IMPRIMIO, y sigue
 * siendo esa foto aunque el color se haya discontinuado despues. La variante inicial de
 * fallback (mas abajo) si filtra activas, porque esa es la foto de venta normal.
 */
function resolverImagenCorporativa(
  variantes: VarianteCorporativa[],
  codigo: string,
  fotoColor: string | undefined
): Imagen | undefined {
  if (fotoColor) {
    const prefijo = `${codigo}-${fotoColor}`.toLowerCase();
    const variante = variantes.find((v) => {
      const sku = v.sku.toLowerCase();
      return sku === prefijo || sku.startsWith(`${prefijo}-`);
    });
    if (variante?.imagenes[0]) return variante.imagenes[0];
  }

  // Sin `fotoColor`, o la variante que matchea no tiene fotos cargadas: la portada
  // normal del producto, primera imagen de la primera variante activa.
  return variantes.find((v) => v.activo !== false)?.imagenes[0];
}

/**
 * Deriva de un producto y su entrada impresa lo que la ficha corporativa necesita
 * mostrar.
 *
 * Colores, medidas, codigo, seccion y orden salen TODOS de `entrada` —el catalogo
 * impreso— y no del producto: el impreso es una pieza fija que ya paso por imprenta,
 * y el producto puede seguir editandose despues (nuevo color, nueva medida) sin que
 * la reproduccion de esta pagina tenga que seguirlo. Del producto solo se toma el
 * nombre (para el `alt` y el mensaje de WhatsApp) y las variantes (para resolver la
 * foto).
 */
export function derivarProductoCorporativo(
  producto: ProductoCorporativoOrigen,
  entrada: RegaloSeleccionado
): ProductoCorporativo {
  return {
    id: producto.id,
    nombre: producto.nombre,
    codigo: entrada.codigo,
    medidas: entrada.medidas,
    consultarOtros: entrada.consultarOtros,
    etiqueta: entrada.etiqueta,
    colores: entrada.colores,
    imagen: resolverImagenCorporativa(producto.variantes, entrada.codigo, entrada.fotoColor),
    seccion: entrada.seccion,
    ordenSeccion: entrada.ordenSeccion,
    orden: entrada.orden,
  };
}

/** Una seccion del catalogo impreso, con sus productos en el orden impreso. */
export interface GrupoCorporativo {
  seccion: string;
  productos: ProductoCorporativo[];
}

/**
 * Agrupa los productos resueltos por su seccion impresa (`BOLSO TÉRMICO`, `BOLSO`,
 * `PORTAFOLIOS`, `MOCHILAS`, `MOCHILA P/NOTEBOOK`), en el orden del catalogo impreso.
 *
 * `ordenSeccion` decide el orden de los GRUPOS, y `orden` el de los productos DENTRO
 * de cada grupo — ambos se ordenan aca y no se asume que `productos` ya venga
 * ordenado, para que esta funcion sea correcta sola, sin depender de que quien la
 * llama haya ordenado antes.
 */
export function agruparPorSeccion(productos: ProductoCorporativo[]): GrupoCorporativo[] {
  const grupos = new Map<string, { ordenSeccion: number; productos: ProductoCorporativo[] }>();

  for (const p of productos) {
    const grupo = grupos.get(p.seccion);
    if (grupo) {
      grupo.productos.push(p);
    } else {
      grupos.set(p.seccion, { ordenSeccion: p.ordenSeccion, productos: [p] });
    }
  }

  return [...grupos.entries()]
    .sort(([, a], [, b]) => a.ordenSeccion - b.ordenSeccion)
    .map(([seccion, grupo]) => ({
      seccion,
      productos: [...grupo.productos].sort((a, b) => a.orden - b.orden),
    }));
}
