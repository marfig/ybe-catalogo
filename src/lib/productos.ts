import { getCollection, getEntries, type CollectionEntry } from 'astro:content';

export type Producto = CollectionEntry<'productos'>;
export type Categoria = CollectionEntry<'categorias'>;
export type Variante = Producto['data']['variantes'][number];

/**
 * Orden estable de productos: novedades primero, y ante empate por `id`.
 *
 * El desempate por `id` no es cosmetico: sin el, dos productos con la misma
 * fecha podrian intercambiarse entre builds y saltar de pagina en los listados
 * paginados (SPEC §9.5).
 */
function ordenar(a: Producto, b: Producto): number {
  if (a.data.actualizado !== b.data.actualizado) {
    return a.data.actualizado < b.data.actualizado ? 1 : -1;
  }
  return a.id < b.id ? -1 : 1;
}

/** Productos publicables. Un `activo: false` no aparece en ninguna vista. */
export async function activos(): Promise<Producto[]> {
  const todos = await getCollection('productos', (p) => p.data.activo);
  return todos.sort(ordenar);
}

/** Categorias visibles en la navegacion, en el orden configurado. */
export async function categoriasActivas(): Promise<Categoria[]> {
  const todas = await getCollection('categorias', (c) => c.data.activa);
  return todas.sort((a, b) => a.data.orden - b.data.orden || (a.id < b.id ? -1 : 1));
}

/** Productos activos de una categoria, en el orden estable global. */
export async function porCategoria(slug: string): Promise<Producto[]> {
  const todos = await activos();
  return todos.filter((p) => p.data.categorias.some((ref) => ref.id === slug));
}

/**
 * Categorias que ademas tienen al menos un producto publicado.
 *
 * Fuente unica para el header, la home y getStaticPaths del listado. Si una
 * categoria activa no tiene productos:
 *   - no se enlaza (un chip que lleva a un listado vacio decepciona)
 *   - no se genera su pagina (contenido vacio que Google trata como thin content)
 *
 * Las tres vistas deben coincidir o el header enlazaria a un 404.
 */
export async function categoriasNavegables(): Promise<{ categoria: Categoria; cantidad: number }[]> {
  const categorias = await categoriasActivas();
  const productos = await activos();

  return categorias
    .map((categoria) => ({
      categoria,
      cantidad: productos.filter((p) => p.data.categorias.some((r) => r.id === categoria.id)).length,
    }))
    .filter((c) => c.cantidad > 0);
}

/** Destacados de la home. */
export async function destacados(): Promise<Producto[]> {
  const todos = await activos();
  return todos.filter((p) => p.data.destacado);
}

/**
 * Resuelve las referencias de categoria de un producto a sus entradas.
 *
 * `reference()` devuelve `{ collection, id }`, no la entrada: hay que resolver.
 * Se filtran las inactivas para no enlazar a un listado oculto, pero se conserva
 * el orden del array, porque `categorias[0]` define el breadcrumb (SPEC §4.3).
 */
export async function resolverCategorias(producto: Producto): Promise<Categoria[]> {
  const entradas = await getEntries(producto.data.categorias);
  return entradas.filter((c): c is Categoria => Boolean(c) && c.data.activa);
}

/** Categoria principal: la primera activa. Define el breadcrumb (SPEC §4.3). */
export async function categoriaPrincipal(producto: Producto): Promise<Categoria | undefined> {
  return (await resolverCategorias(producto))[0];
}

/** Variantes visibles. Un color discontinuado se oculta sin romper el producto. */
export function variantesActivas(producto: Producto): Variante[] {
  return producto.data.variantes.filter((v) => v.activo);
}

/**
 * Variante que se renderiza en el HTML.
 *
 * Con `output: 'static'` la pagina esta prerenderizada y `Astro.url.searchParams`
 * no tiene valor en build, asi que el HTML sale siempre con la primera variante
 * activa y la isla se encarga del resto (SPEC §9.6).
 */
export function varianteInicial(producto: Producto): Variante | undefined {
  return variantesActivas(producto)[0];
}

/** Primera imagen de la variante inicial. Sirve para la card y el og:image. */
export function imagenPrincipal(producto: Producto) {
  return varianteInicial(producto)?.imagenes[0];
}
