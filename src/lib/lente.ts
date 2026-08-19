/**
 * La lupa de la ficha: dónde hay que correr la imagen ampliada para que la lupa muestre lo
 * que está debajo del cursor.
 *
 * PIEZA PURA, sin DOM: un signo al revés acá no da ningún error, da una lupa que muestra la
 * esquina opuesta a donde está el cursor. Eso se descubre mirándola y no ejecutándola, así
 * que las cuentas viven separadas del `mousemove`.
 *
 * LO QUE ESTA LUPA ES Y LO QUE NO ES, dicho de frente porque se decidió con el dato a la
 * vista. Medido el 2026-08-19: de las 1.165 imágenes del catálogo, **1.130 son exactamente
 * 600×600**, el alto máximo es 600 en todas, y de cada una guardamos sólo `w300` y `w600` —
 * el original no se guarda—. La ficha ya muestra la foto en unos 530 px. O sea que **la lupa
 * amplía píxeles; no revela detalle que no esté a la vista.**
 *
 * Se hace igual, y es una decisión de producto tomada sabiendo eso: el efecto comunica
 * cuidado, es el que tiene el proveedor —cuya lupa amplía una foto de 601×600, o sea que le
 * pasa exactamente lo mismo— y para mirar la forma de un bolso, más grande ayuda aunque no
 * sea más nítido. El día que se quiera zoom de verdad, la conversación es sobre las
 * imágenes, no sobre este archivo.
 *
 * SÓLO PARA PUNTERO FINO. No se activa con el dedo: el hover no existe en táctil, y una
 * lupa que aparece donde tocaste tapa justo lo que querías ver.
 */

/**
 * Cuánto amplía.
 *
 * Con 600 px de origen, 2× muestra el equivalente a 1.200 px: es el doble de lo que hay, y
 * ahí la suavidad todavía se lee como una lupa. De 3× en adelante se lee como una foto mala,
 * que es peor que no tener lupa.
 */
export const FACTOR_LENTE = 2;

/**
 * El diámetro, en px.
 *
 * ES EL DEL PROVEEDOR, no un número elegido: su hoja de estilos declara `.glass` en
 * `width: 347px; height: 347px`, y esa lupa es la referencia que se pidió replicar. Leerlo
 * de ahí en vez de tantear deja el efecto igual al que alguien ya vio y le gustó.
 *
 * Sigue siendo más chica que la foto —la columna de la ficha ronda los 530 px— y eso
 * importa: una lupa del tamaño de la foto no es una lupa, es un reemplazo, y tapa la
 * referencia de dónde se está mirando.
 */
export const DIAMETRO_LENTE = 347;

/**
 * El anillo y la sombra que hacen que se lea como un vidrio y no como un recorte.
 *
 * TAMBIÉN DEL PROVEEDOR, y va como `box-shadow` y no como `border` por una razón concreta:
 * un borde vive DENTRO de la caja del elemento, así que se comería 14 px de diámetro de lo
 * que se está ampliando. La sombra se dibuja afuera y no le quita nada al vidrio.
 *
 * Las tres capas hacen tres cosas distintas: el anillo blanco separa la lupa de la foto, la
 * sombra difusa la despega del plano, y el `inset` le pone el viñeteado que un vidrio real
 * tiene en los bordes.
 */
export const SOMBRA_LENTE = [
  '0 0 0 7px rgba(255, 255, 255, 0.85)',
  '0 0 7px 7px rgba(0, 0, 0, 0.25)',
  'inset 0 0 40px 2px rgba(0, 0, 0, 0.25)',
].join(', ');

export interface Encuadre {
  /** Cuántos px hay que correr la imagen ampliada, hacia la izquierda si es negativo. */
  x: number;
  y: number;
}

export interface PedidoDeEncuadre {
  /** Posición del cursor DENTRO de la caja de la imagen, en px. */
  cursorX: number;
  cursorY: number;
  /** Lado de la caja de la imagen. Es cuadrada: `aspect-square` en la ficha. */
  lado: number;
  /** Diámetro de la lupa. */
  diametro: number;
  factor: number;
}

/**
 * Acota un valor a un rango, tolerando que el rango venga invertido.
 *
 * El rango se invierte cuando la lupa es más grande que la imagen ampliada —una foto de 300
 * px a factor 1,5 son 450, menos que una lupa de 500— y ahí lo correcto no es un extremo
 * sino el centro: pegarla a un borde dejaría vacío al lado.
 */
function acotar(valor: number, minimo: number, maximo: number): number {
  if (minimo > maximo) return (minimo + maximo) / 2;
  return Math.min(maximo, Math.max(minimo, valor));
}

/**
 * El desplazamiento de la imagen ampliada para que el punto bajo el cursor caiga en el
 * centro de la lupa.
 *
 * La cuenta, con el cursor en el medio de una caja de 500 y factor 2: ese punto está en el
 * píxel 500 de la imagen ampliada, y para que caiga en el centro de una lupa de 200 hay que
 * correrla 500 - 100 = 400 hacia arriba y a la izquierda.
 *
 * SE ACOTA, y no es cosmético: sin acotar, el cursor en una esquina da un desplazamiento
 * positivo y la lupa muestra un cuarto de imagen y tres cuartos de vacío. Acotada muestra la
 * esquina completa, que es lo que uno espera de una lupa de verdad apoyada en un borde.
 *
 * Los dos ejes se acotan por separado: el cursor puede estar pegado al borde izquierdo y a
 * media altura.
 */
export function encuadreDeLente({
  cursorX,
  cursorY,
  lado,
  diametro,
  factor,
}: PedidoDeEncuadre): Encuadre {
  const ampliada = lado * factor;
  const medio = diametro / 2;

  // El tope: mas que esto deja vacio del otro lado. Con `lado` en 0 da `diametro - 0`, o sea
  // un rango invertido, y `acotar` lo centra en vez de devolver NaN.
  const minimo = diametro - ampliada;

  const eje = (cursor: number): number => {
    // El cursor se trae adentro de la caja antes de ampliar: `mousemove` puede llegar con un
    // pixel de afuera al salir rapido.
    const dentro = acotar(Number.isFinite(cursor) ? cursor : 0, 0, lado);
    return acotar(-(dentro * factor - medio), minimo, 0);
  };

  return { x: eje(cursorX), y: eje(cursorY) };
}
