/**
 * Escribir la curaduría del catálogo viejo sobre un producto ya importado.
 *
 * ES LA ÚNICA PIEZA DE LA MIGRACIÓN QUE PUEDE DESTRUIR ALGO, y por eso vive sola y con
 * tests contra el esquema real. `nombre`, `precio` y `descripcion` son columnas de
 * CURADURÍA: `registrarFicha` no las toca en ningún UPDATE y eso es literalmente su
 * razón de existir. Acá se tocan, así que la guarda es el archivo entero.
 *
 * `scrape_id` NO sirve de guarda, aunque lo parezca: `registrarFicha` hace
 * `scrape_id = COALESCE(?, scrape_id)` también en el UPDATE, así que un producto viejo y
 * curado que esta corrida vuelva a visitar quedaría marcado con el id de la corrida y
 * pasaría el filtro.
 */
import type { Ejecutar } from '../grilla.ts';
import type { Curaduria } from './viejo.ts';

/**
 * Aplica la curaduría. Devuelve `true` si escribió, `false` si el producto no era
 * elegible — que no es un error y quien llama lo cuenta para el resumen.
 *
 * LAS DOS CONDICIONES DEL WHERE, y las dos importan:
 *
 *   `nombre IS NULL`      — el proveedor no publica nombres, así que un nombre no nulo lo
 *                           escribió una persona. Es la señal de que ese producto ya pasó
 *                           por manos humanas, y también lo que hace la corrida
 *                           reanudable: lo ya curado se saltea solo.
 *   `estado = 'importado'` — un aprobado tiene URL definitiva y alguien lo miró. Un
 *                           `nombre` nulo ahí es un producto roto, no una invitación.
 *
 * `descripcion = COALESCE(?, descripcion)` es el respaldo: cuando el catálogo viejo no
 * aporta descripción —pasa cuando toda su descripción era la lista de colores, que se
 * poda— quedan las medidas que sembró la ficha del proveedor.
 *
 * Los tres campos viajan JUNTOS. Un producto a medio curar, con precio y sin nombre,
 * pasaría la guarda de nuevo en la próxima corrida y se sobreescribiría a sí mismo.
 */
export async function aplicarCuraduria(
  ejecutar: Ejecutar,
  productoId: number,
  curaduria: Curaduria,
  { ahora }: { ahora: string }
): Promise<boolean> {
  const nombre = curaduria.nombre.trim();

  /**
   * Un nombre vacío no se escribe: dejaría el producto «con nombre» para la guarda de
   * arriba y no se podría volver a curar nunca. Mejor que quede sin nombre y visible en
   * la grilla como lo que es, algo que falta completar.
   */
  if (!nombre) return false;

  const filas = await ejecutar<{ id: number }>(
    `UPDATE productos
        SET nombre         = ?,
            precio         = ?,
            descripcion    = COALESCE(?, descripcion),
            actualizado_en = ?
      WHERE id = ?
        AND estado = 'importado'
        AND nombre IS NULL
    RETURNING id`,
    [nombre, curaduria.precio, curaduria.descripcion, ahora, productoId]
  );

  return filas.length > 0;
}
