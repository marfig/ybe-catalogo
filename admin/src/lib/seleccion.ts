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

/** Lo mínimo que esto necesita de una casilla. Ni `HTMLInputElement`, ni el DOM. */
export interface CasillaMinima {
  checked: boolean;
}

/** La casilla de encabezado: además escucha. */
export interface ControlMarcarTodo extends CasillaMinima {
  addEventListener(tipo: string, oyente: () => void): void;
}

/**
 * Hace que la casilla de encabezado escriba sobre las filas de la página.
 *
 * ESCUCHA `click` Y NO `change`, y esa palabra es el arreglo de un bug real: «marcar
 * todos» no marcaba nada, y desde una selección parcial DESMARCABA lo que había.
 *
 * El motivo es el orden de la spec. Al activar un checkbox el navegador togglea el
 * estado y despacha `click`; recién cuando ese `click` terminó de propagarse salen
 * `input` y después `change`. Y el formulario de la grilla repinta con LOS DOS. Con el
 * handler colgado de `change`, el repintado del `input` previo corría primero, veía las
 * filas todavía sin tocar, concluía «no hay nada seleccionado» y le devolvía la casilla
 * a `false` — así que el handler leía el estado ya deshecho y lo escribía en las 50.
 *
 * Con `click` se escribe ANTES de que exista un repintado que pisar, y los dos que
 * vienen después leen las filas ya sincronizadas. Sigue funcionando con teclado: activar
 * con la barra espaciadora despacha un `click` igual.
 *
 * Y por eso está acá y no suelto en el script: es una regla con un modo de fallar, no
 * pegamento. Los tests fijan el orden con un doble que modela al navegador.
 */
export function conectarMarcarTodo(
  control: ControlMarcarTodo,
  casillas: () => CasillaMinima[]
): void {
  control.addEventListener('click', () => {
    for (const casilla of casillas()) casilla.checked = control.checked;
  });
}
