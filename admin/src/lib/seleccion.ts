/**
 * En qué estado va la casilla de «marcar todos» del encabezado (SPEC-etapa2 §10.3).
 *
 * PIEZA PURA, sin DOM, igual que `habilitacion.ts`: el pegamento vive en
 * `scripts/grilla-cliente.ts` y acá está lo que se decide, para poder probarlo sin
 * navegador.
 *
 * Son TRES estados y no dos, y el tercero es el que hace que la casilla no mienta. Con 3
 * de 50 tildados, una casilla vacía dice «no hay nada seleccionado» y una llena dice
 * «están los 50»: las dos son falsas, y la segunda es peligrosa al lado de un botón de
 * eliminar. `indeterminate` es el estado que el navegador ya sabe dibujar para eso.
 */

export interface EstadoMarcarTodo {
  /** Si la casilla se ve llena. Sólo con TODAS las filas de la página tildadas. */
  marcada: boolean;
  /** El guion del medio: hay algo tildado, pero no todo. */
  indeterminada: boolean;
}

/**
 * @param marcados Cuántas filas de la página están tildadas.
 * @param total Cuántas filas rindió la página.
 */
export function estadoDeMarcarTodo(marcados: number, total: number): EstadoMarcarTodo {
  // `total > 0` no es defensivo: 0 de 0 satisface «están todos» por vacuidad, y una
  // casilla llena sobre una tabla vacía invita a apretar un botón que no tiene sobre
  // qué operar.
  return {
    marcada: total > 0 && marcados === total,
    indeterminada: marcados > 0 && marcados < total,
  };
}
