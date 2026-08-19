/**
 * En qué orden se ven los colores de un producto (SPEC.md §6.4, SPEC-etapa2 §5.1).
 *
 * POR QUÉ ESTO ALCANZA PARA DECIDIR QUÉ SE VE. `variantes.orden` ya manda en toda la
 * cadena, de la base al sitio:
 *
 *   - el volcado ordena las variantes por `orden`, con `color` y `sku` de desempate;
 *   - `varianteInicial()` toma la PRIMERA y con eso rinde la ficha, su galería y el
 *     mensaje de WhatsApp;
 *   - `imagenPrincipal()` toma su primera foto, que es la miniatura de la tarjeta del
 *     listado y la del índice del buscador;
 *   - la miniatura de la grilla del admin sale del mismo orden.
 *
 * Así que **el color principal no es un campo: es el que está primero.** No se agrega una
 * marca aparte a propósito — dos fuentes de verdad para «cuál se ve primero» pueden
 * contradecirse, y no habría forma de saber cuál gana. Con la posición sola hay un solo
 * modelo mental, y es el que la pantalla puede mostrar: el de arriba es el que se ve.
 *
 * Y `orden` ES CURADURÍA: la importación nunca lo pisa —un color nuevo se agrega al final—
 * así que acomodar los colores no se deshace en la próxima corrida del scrape.
 *
 * PIEZA PURA, sin DOM: acá vive toda la decisión y por eso tiene tests. Quien mueve los
 * nodos es `scripts/alta-cliente.ts`, que no decide nada. Mismo reparto que `marcha.ts` con
 * su cliente.
 *
 * OJO CON UN CASO QUE HOY NO EXISTE: `varianteInicial()` toma la primera variante ACTIVA,
 * no la primera. Hoy da lo mismo —no hay ninguna inactiva y `activo` no se puede editar
 * desde el admin— pero el día que se pueda, poner como principal una inactiva no cambiaría
 * nada visible y la pantalla tendría que decirlo.
 */

/** Los movimientos posibles sobre la lista de colores. */
export const MOVIMIENTOS = ['subir', 'bajar', 'principal'] as const;

export type Movimiento = (typeof MOVIMIENTOS)[number];

/**
 * El orden nuevo, expresado como la lista de POSICIONES VIEJAS.
 *
 * `ordenTrasMover(4, 3, 'principal')` devuelve `[3, 0, 1, 2]`: «primero el que estaba
 * cuarto, después los otros tres como estaban». Quien llama reacomoda su lista con eso.
 *
 * DEVUELVE SIEMPRE UNA PERMUTACIÓN COMPLETA de `cantidad`, y eso no es prolijidad: el
 * formulario manda los colores en el orden del DOM y `actualizarProducto` reescribe las
 * variantes con lo que llega. Una lista más corta le borraría un color a un producto
 * publicado, sin ningún error a la vista. Ante cualquier duda —un índice fuera de rango, un
 * movimiento que no existe— devuelve el orden intacto: no hacer nada es siempre seguro.
 */
export function ordenTrasMover(cantidad: number, desde: number, movimiento: Movimiento): number[] {
  const total = Number.isInteger(cantidad) && cantidad > 0 ? cantidad : 0;
  const original = Array.from({ length: total }, (_, i) => i);

  // Con un solo color no hay nada que ordenar, y con ninguno tampoco.
  if (total <= 1) return original;
  if (!Number.isInteger(desde) || desde < 0 || desde >= total) return original;

  switch (movimiento) {
    case 'subir':
      return desde === 0 ? original : intercambiar(original, desde, desde - 1);
    case 'bajar':
      return desde === total - 1 ? original : intercambiar(original, desde, desde + 1);
    case 'principal':
      /**
       * Al frente, y el resto CONSERVA su orden relativo. Quien decidió que el negro va
       * antes que el gris no pidió que eso cambie por elegir otro principal — y por eso no
       * es un simple intercambio con el primero, que sí lo cambiaría.
       */
      return desde === 0 ? original : [desde, ...original.filter((i) => i !== desde)];
    default:
      // Llega de un `data-` del DOM, que cualquiera puede editar desde el inspector.
      return original;
  }
}

function intercambiar(orden: number[], a: number, b: number): number[] {
  const copia = [...orden];
  [copia[a], copia[b]] = [copia[b], copia[a]];
  return copia;
}

/**
 * ¿Este orden deja todo donde estaba?
 *
 * Sirve para no tocar el DOM al vacío: reacomodar nodos mueve el foco y dispara trabajo de
 * layout, así que un movimiento que no mueve nada no debería verse como si algo pasó.
 */
export function esIdentidad(orden: readonly number[]): boolean {
  return orden.every((posicion, i) => posicion === i);
}
