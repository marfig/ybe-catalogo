import { getCollection } from 'astro:content';
import { activos, type Producto } from './productos.ts';
import { resolverSeleccion } from './corporativo.ts';

/** Un producto del catalogo corporativo. Es un `Producto` normal: mismas fotos,
 * colores y medidas — lo unico que cambia es que no se muestra el precio. */
export type Regalo = Producto;

/**
 * Los productos del catalogo corporativo, resueltos contra `productos` y en el
 * orden curado por `regalos-empresariales.json`.
 *
 * FUENTE UNICA para el header, el banner de la home y la pagina propia: las tres
 * necesitan la MISMA respuesta a «¿hay algo cargado?» y el MISMO orden, o el header
 * terminaria anunciando una seccion que la pagina muestra vacia — el mismo motivo por
 * el que existe `categoriasNavegables()` en productos.ts.
 */
export async function regalosEmpresariales(): Promise<Regalo[]> {
  const seleccion = await getCollection('regalosEmpresariales');
  const productos = await activos();

  return resolverSeleccion(
    seleccion.map((s) => ({ id: s.id, orden: s.data.orden })),
    productos
  );
}
