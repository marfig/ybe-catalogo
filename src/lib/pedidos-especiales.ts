import { getCollection, type CollectionEntry } from 'astro:content';

export type PedidoEspecial = CollectionEntry<'pedidosEspeciales'>;

/**
 * Pedidos especiales visibles, en el orden configurado.
 *
 * Se ordena por `orden` y NO por fecha como `productos`: no hay novedades que
 * mostrar primero. Son pocas entradas curadas a mano, y quien edita el JSON es quien
 * decide cual va primero — el mismo criterio que `categoriasActivas()`.
 *
 * El desempate por `id` no es cosmetico, y es la misma razon que en `productos`: sin
 * el, dos entradas con el mismo `orden` podrian intercambiarse entre builds.
 */
export async function pedidosEspeciales(): Promise<PedidoEspecial[]> {
  // SIN filtro por `activo`, al reves que `activos()` de productos: esta coleccion no
  // tiene ese campo. Lo que esta cargado esta publicado (`content.config.ts`).
  const todos = await getCollection('pedidosEspeciales');
  return todos.sort((a, b) => a.data.orden - b.data.orden || (a.id < b.id ? -1 : 1));
}
