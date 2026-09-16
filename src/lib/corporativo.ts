/**
 * Regalos empresariales: el catalogo corporativo (banner de la home + pagina propia).
 *
 * PIEZA PURA, mismo criterio que `buscar.ts`: nada de acá conoce `astro:content`, para
 * que el orden y el agrupamiento se prueben con `node --test` sin levantar Astro. Las
 * paginas que SI necesitan `getCollection`/`getEntries` (Header, el banner, la pagina
 * `/regalos-empresariales`) resuelven la coleccion y le pasan a estas funciones datos
 * ya planos.
 */

import type { Imagen } from './imagenes.ts';

/** Una entrada de `regalos-empresariales.json`: que producto entra y en que orden. */
export interface RegaloSeleccionado {
  id: string;
  orden: number;
}

/** Lo minimo que necesita `resolverSeleccion` de un producto para poder ubicarlo. */
export interface ProductoSeleccionable {
  id: string;
}

/**
 * Resuelve la seleccion contra el catalogo de productos, en el orden curado.
 *
 * MISMO CRITERIO QUE `resolverCategorias` (src/lib/productos.ts): un id sin producto
 * no rompe el build ni avisa, se descarta en silencio. La seleccion la carga a mano
 * quien arma el catalogo corporativo, y el producto detras de un id puede darse de baja
 * despues —`activo: false`, o borrarse del todo— sin que nadie vuelva a tocar este
 * archivo. Ese hueco lo nota quien revisa la pagina publicada, no un error de build que
 * tumba el sitio entero por una sola entrada vieja.
 *
 * Generica en `T` y no atada a `Producto` de astro:content: asi se prueba con objetos
 * planos, sin depender del runtime de Astro.
 */
export function resolverSeleccion<T extends ProductoSeleccionable>(
  seleccion: RegaloSeleccionado[],
  productos: T[]
): T[] {
  const porId = new Map(productos.map((p) => [p.id, p]));

  return [...seleccion]
    .sort((a, b) => a.orden - b.orden || (a.id < b.id ? -1 : 1))
    .map((s) => porId.get(s.id))
    .filter((p): p is T => Boolean(p));
}

/** Una variante, en lo minimo que hace falta para derivar colores y foto. */
export interface VarianteCorporativa {
  color: string;
  /** Ausente se trata como activa: mismo default que el schema (`z.boolean().default(true)`). */
  activo?: boolean;
  imagenes: Imagen[];
}

/** Lo que `derivarProductoCorporativo` necesita leer de un producto del catalogo. */
export interface ProductoCorporativoOrigen {
  id: string;
  nombre: string;
  descripcion?: string | undefined;
  origen: { ref: string };
  variantes: VarianteCorporativa[];
}

/** Lo que la vitrina corporativa muestra de un producto: sin precio, con categoria. */
export interface ProductoCorporativo {
  id: string;
  nombre: string;
  descripcion: string | undefined;
  /** `origen.ref`: el codigo con el que se pregunta por WhatsApp (SPEC-etapa2 §5.3). */
  codigo: string;
  colores: string[];
  imagen: Imagen | undefined;
  categoriaId: string;
}

/**
 * Deriva de un producto lo que la ficha corporativa necesita mostrar.
 *
 * SOLO variantes activas, mismo criterio que `variantesActivas` en productos.ts: un
 * color discontinuado no puede ofrecerse en un pedido por cantidad que va a tardar en
 * producirse — para cuando llegue el pedido, ese color ya no esta.
 *
 * `categoriaId` entra como parametro y no se resuelve aca: la categoria principal sale
 * de `categoriaPrincipal()` (productos.ts), que depende de `getEntries` de
 * astro:content. Mantener esa dependencia FUERA de este archivo es lo que permite
 * testear esta funcion con un objeto armado a mano.
 */
export function derivarProductoCorporativo(
  producto: ProductoCorporativoOrigen,
  categoriaId: string
): ProductoCorporativo {
  const activas = producto.variantes.filter((v) => v.activo !== false);

  // Set y no un simple map: dos variantes pueden compartir nombre de color (un
  // proveedor repite "Negro" en dos telas distintas) y listarlo dos veces en la
  // vitrina se leeria como un error de carga, no como dos opciones.
  const colores = [...new Set(activas.map((v) => v.color))];

  return {
    id: producto.id,
    nombre: producto.nombre,
    descripcion: producto.descripcion,
    codigo: producto.origen.ref,
    colores,
    imagen: activas[0]?.imagenes[0],
    categoriaId,
  };
}

/** Una categoria, en lo minimo que hace falta para agrupar y titular. */
export interface CategoriaCorporativa {
  id: string;
  nombre: string;
}

export interface GrupoCorporativo {
  categoria: CategoriaCorporativa;
  productos: ProductoCorporativo[];
}

/**
 * Agrupa los productos resueltos por su categoria principal.
 *
 * El orden de `categorias` lo decide quien llama —normalmente `categoriasActivas()`,
 * que ya ordena por el `orden` de `categorias.json`— y se preserva tal cual: es el
 * mismo `orden` que gobierna el header y la home (productos.ts), y esta pagina no
 * inventa una prioridad propia.
 *
 * Una categoria sin productos en la seleccion NO genera un grupo vacio: la seleccion
 * es un subconjunto curado de apenas 5 categorias (ver la carga inicial), y un
 * encabezado sin tarjetas debajo se leeria como un error de carga.
 */
export function agruparPorCategoria(
  productos: ProductoCorporativo[],
  categorias: CategoriaCorporativa[]
): GrupoCorporativo[] {
  return categorias
    .map((categoria) => ({
      categoria,
      productos: productos.filter((p) => p.categoriaId === categoria.id),
    }))
    .filter((grupo) => grupo.productos.length > 0);
}
