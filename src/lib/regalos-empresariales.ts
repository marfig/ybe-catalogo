import { getCollection } from 'astro:content';
import { activos } from './productos.ts';
import { derivarProductoCorporativo, resolverSeleccion, type ProductoCorporativo } from './corporativo.ts';

/** Un producto del catalogo corporativo: la ficha impresa (seccion, codigo, medidas,
 * colores) ya emparejada con la foto de su producto. Ver `ProductoCorporativo`. */
export type Regalo = ProductoCorporativo;

/**
 * Los productos del catalogo corporativo, resueltos contra `productos` (solo para la
 * foto y el nombre) y con el resto de la ficha —seccion, codigo, medidas, colores—
 * tal como sale del catalogo impreso.
 *
 * FUENTE UNICA para el header, el banner de la home y la pagina propia: las tres
 * necesitan la MISMA respuesta a «¿hay algo cargado?» y el MISMO orden, o el header
 * terminaria anunciando una seccion que la pagina muestra vacia — el mismo motivo por
 * el que existe `categoriasNavegables()` en productos.ts.
 */
export async function regalosEmpresariales(): Promise<Regalo[]> {
  const seleccion = await getCollection('regalosEmpresariales');
  const productos = await activos();

  const entradas = seleccion.map((s) => ({ id: s.id, ...s.data }));

  return resolverSeleccion(entradas, productos).map(({ entrada, producto }) =>
    derivarProductoCorporativo(
      {
        id: producto.id,
        nombre: producto.data.nombre,
        variantes: producto.data.variantes,
      },
      entrada
    )
  );
}
