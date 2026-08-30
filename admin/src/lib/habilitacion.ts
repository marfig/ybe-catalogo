/**
 * Cuándo un botón de la grilla se puede apretar (SPEC-etapa2 §10.3).
 *
 * PIEZA PURA, sin DOM. El pegamento vive en `scripts/grilla-cliente.ts`; acá está lo que
 * se decide, para que se pueda probar sin un navegador.
 *
 * NO DEVUELVE UN BOOLEANO, por el mismo motivo que `validarParaAprobar`: devuelve QUÉ
 * bloquea, en texto mostrable. Un botón gris sin explicación es una pared — y estos
 * botones ya no tienen su nota al lado que la diera. El motivo termina en el `title`.
 *
 * Todo esto es MEJORA PROGRESIVA. Sin JavaScript no se deshabilita nada y la pantalla
 * sigue funcionando: el servidor valida igual, porque una guarda que sólo vive en el
 * navegador no es una guarda.
 */

/** Lo que un botón necesita para estar habilitado. */
export type Requisito =
  /** Al menos un producto tildado. */
  | 'seleccion'
  /**
   * Nada tipeado sin guardar.
   *
   * Los botones de aprobar lo piden porque la aprobación se decide con las validaciones
   * que el servidor rindió: los «✓ completo» de cada fila son de ese momento. Con cosas
   * tipeadas encima, esas insignias ya no describen lo que hay, y aprobar sería mirar un
   * tablero viejo. Guardar recarga la página y las vuelve verdaderas.
   */
  | 'guardado'
  /**
   * Algo que guardar. Es el INVERSO de `guardado`, y lo pide un solo botón: «Guardar».
   *
   * Un botón gris acá no es una traba, es un estado: dice «tu trabajo está guardado», que
   * es exactamente la pregunta que uno se hace al alejarse del teclado.
   *
   * OJO CON CÓMO SE CALCULA. Para los otros requisitos, equivocarse cuesta un clic de
   * más. Acá cuesta no poder guardar, y perder lo tipeado al irse de la página. Por eso
   * `sucio` se computa comparando cada campo con su valor inicial y no encendiendo un
   * flag cuando salta un evento: leer el estado real no depende de que el evento haya
   * saltado. Ver `scripts/grilla-cliente.ts`.
   */
  | 'cambios'
  /**
   * Al menos un producto de la página listo para aprobarse.
   *
   * Lo cuenta el SERVIDOR al rendir, con la misma validación que va a correr la acción.
   * El número queda viejo en cuanto se tipea algo — pero el mismo botón pide también
   * `guardado`, así que mientras el número no sea confiable el botón ya está apagado por
   * el otro motivo. Los dos requisitos juntos hacen que el contador nunca mienta.
   */
  | 'completos';

export interface EstadoGrilla {
  /** Si hay cambios tipeados sin guardar. */
  sucio: boolean;
  /** Cuántas filas están tildadas. */
  seleccionados: number;
  /** Cuántos productos de la página están listos para aprobarse, según el servidor. */
  completos: number;
}

export interface Habilitacion {
  habilitado: boolean;
  /** Lo que BLOQUEA al botón, en texto mostrable. Vacío ⇒ habilitado. */
  motivos: string[];
}

/**
 * Si una cadena del HTML es un requisito conocido.
 *
 * DERIVA DE `MOTIVOS`, que es la única lista de requisitos que existe. Antes esto era un
 * `r === 'seleccion' || r === 'guardado'` escrito a mano en el script del cliente, y pasó
 * exactamente lo que tenía que pasar: se agregaron dos requisitos, nadie actualizó la
 * lista, y los botones que sólo pedían los nuevos quedaron habilitados siempre. Un botón
 * que se habilita cuando no debería es peor que uno que no funciona: no falla, miente.
 *
 * Un requisito desconocido se DESCARTA en vez de reventar, y esto sí es a propósito: el
 * valor viene de un atributo del DOM, y un `data-requiere` mal tipeado no puede dejar la
 * pantalla inservible. El servidor valida igual.
 */
export function esRequisito(valor: string): valor is Requisito {
  return Object.hasOwn(MOTIVOS, valor);
}

const MOTIVOS: Record<Requisito, (estado: EstadoGrilla) => string | null> = {
  seleccion: ({ seleccionados }) =>
    seleccionados === 0 ? 'No hay ningún producto tildado.' : null,
  guardado: ({ sucio }) =>
    sucio ? 'Hay cambios escritos sin guardar. Guardá primero.' : null,
  cambios: ({ sucio }) => (sucio ? null : 'No hay nada para guardar.'),
  completos: ({ completos }) =>
    completos === 0 ? 'Ninguno de esta página está completo todavía.' : null,
};

/**
 * Si un botón con estos requisitos se puede apretar, y si no, por qué.
 *
 * Se acumulan TODOS los motivos y no se corta en el primero: con dos requisitos sin
 * cumplir, decir sólo uno hace que arreglarlo no alcance y el botón siga gris sin que se
 * entienda qué más falta.
 */
export function habilitacionDe(
  requisitos: readonly Requisito[],
  estado: EstadoGrilla
): Habilitacion {
  const motivos = requisitos
    .map((r) => MOTIVOS[r](estado))
    .filter((m): m is string => m !== null);
  return { habilitado: motivos.length === 0, motivos };
}

/**
 * Los campos de datos de una fila, para saber qué ensucia el formulario.
 *
 * Tildar una casilla NO ensucia nada: elegir sobre qué operar no es un cambio pendiente
 * de guardar. Tampoco el desplegable de categoría en lote, que es una elección de la
 * acción y no un dato del producto.
 *
 * Los nombres SON el contrato con el POST (`nombre-12`, `precio-12`…), así que se
 * reconocen por su forma. Si alguien los renombra, el servidor deja de parsearlos en el
 * mismo commit: no hay forma de que esto quede desincronizado en silencio.
 */
const CAMPOS_DE_FILA = /^(nombre|descripcion|precio|categoria)-\d+$/;

export function esCampoDeFila(nombre: string): boolean {
  return CAMPOS_DE_FILA.test(nombre);
}
