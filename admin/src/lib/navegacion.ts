/**
 * Cómo se llama el lugar al que vuelve una pantalla.
 *
 * EXISTE PORQUE EL ROTULO MINTIÓ DOS VECES. La primera, el `Panel` tenía «Inicio» fijo
 * y el `href` era el que le pasaran: una pantalla que volvía a una lista intermedia
 * anunciaba un destino y llevaba a otro. Se agregó el parámetro `volverTexto` para
 * poder corregirlo… y se le dejó «Inicio» de default, así que la mentira siguió
 * disponible por omisión. Editar un producto y eliminar productos la heredaron: las dos
 * vuelven a `/productos` y las dos decían «Inicio».
 *
 * LA LECCION, Y ES LO QUE ESTE MODULO CAMBIA: el arreglo de la primera vez dejó la
 * decisión en manos de quien escribe la pantalla, y confiar en que alguien se acuerde
 * NO es un arreglo — es el mismo bug con un parámetro más. Acá el rótulo se DERIVA del
 * destino, así que no hay nada que recordar y no hay forma de que discrepen.
 */

/**
 * Los destinos con nombre propio.
 *
 * `/eliminados` se llama «Papelera» y no «Eliminados»: el rótulo nombra el lugar como
 * lo ve la persona, no como se llama el archivo.
 */
const ROTULOS = new Map([
  ['/', 'Inicio'],
  ['/productos', 'Productos'],
  ['/pedidos-especiales', 'Pedidos especiales'],
  ['/eliminados', 'Papelera'],
]);

/**
 * El rótulo del enlace de vuelta a `ruta`.
 *
 * LA INVARIANTE: sólo la raíz dice «Inicio». Cualquier otra ruta devuelve otra cosa,
 * aunque nadie la haya mapeado — y esa es justo la parte que importa, porque el modo de
 * falla que se está cerrando es un enlace que promete la portada y lleva a una lista.
 *
 * Una ruta sin mapear se deriva de su último segmento. Podría lanzar en su lugar, pero
 * el admin corre en SSR: un destino nuevo sin mapear se convertiría en un 500 en una
 * pantalla que por lo demás funciona. Derivar da algo razonable y, sobre todo, no
 * miente; si el resultado queda feo se agrega al mapa, que es una mejora y no un
 * arreglo urgente.
 */
export function rotuloDeVuelta(ruta: string): string {
  const limpia = (ruta ?? '').trim().replace(/\/+$/, '');
  if (limpia === '') return 'Inicio';

  const conocido = ROTULOS.get(limpia);
  if (conocido) return conocido;

  const ultimo = limpia.split('/').filter(Boolean).at(-1) ?? '';
  const palabras = ultimo.replace(/-/g, ' ').trim();
  return palabras.charAt(0).toUpperCase() + palabras.slice(1);
}
