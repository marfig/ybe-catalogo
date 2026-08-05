/**
 * Categorias validas, importadas en tiempo de BUILD (SPEC-etapa2 §5.4a).
 *
 * Las categorias NO viven en D1: siguen en `src/data/categorias.json` del sitio
 * publico, escritas a mano y versionadas. Una tabla en D1 se desincronizaria de
 * `reference('categorias')` de Astro, que es lo que hoy rompe el build ante un slug
 * invalido — y esa red de seguridad no se toca.
 *
 * Se importa el MISMO archivo que consume el sitio. Copiarlo seria garantizar que
 * las dos copias se separen.
 */
import catalogoCategorias from '../../../src/data/categorias.json' with { type: 'json' };

export interface Categoria {
  id: string;
  nombre: string;
  orden: number;
}

/** En el orden de navegacion que define el archivo. */
export const CATEGORIAS: Categoria[] = [...(catalogoCategorias as Categoria[])].sort(
  (a, b) => a.orden - b.orden || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
);

/** Slugs validos, para `validarParaAprobar`. */
export const SLUGS_VALIDOS: Set<string> = new Set(CATEGORIAS.map((c) => c.id));

const NOMBRES = new Map(CATEGORIAS.map((c) => [c.id, c.nombre]));

/**
 * Nombre para mostrar de un slug.
 *
 * Un slug que no esta en el archivo se devuelve TAL CUAL en vez de caer a un
 * "Desconocido": la grilla tiene que poder mostrar el slug roto para que se pueda
 * arreglar, y esconderlo detras de una etiqueta generica lo volveria invisible.
 */
export function nombreCategoria(slug: string): string {
  return NOMBRES.get(slug) ?? slug;
}
