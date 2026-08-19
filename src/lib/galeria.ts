/**
 * El visor de fotos de la ficha: hasta donde se puede ampliar y como se recorre.
 *
 * PIEZA PURA, sin DOM: acá vive lo que se puede decidir sin una pantalla, y por eso tiene
 * tests. El `<dialog>`, el foco y el teclado los maneja `SelectorVariante.tsx`.
 *
 * POR QUE EL VISOR NO ES UNA LUPA. Medido el 2026-08-19 sobre las 1.165 imágenes del
 * catálogo: **1.130 son exactamente 600×600** y el alto máximo es 600 en todas. De cada
 * foto guardamos `w300` y `w600` y nada más — el original no se guarda—, así que 600 px es
 * el techo real. La ficha ya muestra la foto en una columna de unos 530 px: quedan 1,13×
 * de margen, y en una pantalla retina ya estamos escalando hacia arriba.
 *
 * O sea que **no hay detalle escondido para revelar**. Una lente que siga el cursor
 * mostraría los mismos píxeles más gordos, y encima el hover no existe en un celular, que
 * es de donde viene la mayoría. El proveedor tiene una lente y le pasa exactamente lo
 * mismo: su propia foto mide 601×600.
 *
 * Lo que el visor SÍ da, y no depende de la nitidez: la foto sola, sin el precio ni la
 * descripción ni los botones alrededor, y el pinch-zoom del navegador en táctil. Y no
 * cuesta un byte: apunta a la misma derivada que la ficha ya bajó.
 */
import { anchoMayor, type Imagen } from './imagenes.ts';

/**
 * Cuánto se puede estirar una foto antes de que se note.
 *
 * NO ES UN NUMERO SUELTO: es el limite de lo que un escalado bicubico sostiene. Con 600 px
 * de origen, 1,7× llega a unos 1.020 px, que llena a lo alto una pantalla de portátil sin
 * que el detalle se vea inventado. Llevarlo a 2,5× para «aprovechar» un monitor grande da
 * una foto mas grande y PEOR, y eso se lee como que la foto es mala.
 */
export const FACTOR_AMPLIACION = 1.7;

/**
 * El lado máximo, en px, al que se puede mostrar esta foto.
 *
 * Sale del ancho que TENEMOS y no del tamaño de la pantalla, que es toda la idea: el visor
 * se agranda hasta donde la imagen puede acompañar, y de ahí no pasa. En una pantalla más
 * grande la foto queda centrada con aire alrededor, que es honesto, en vez de estirada.
 *
 * Devuelve 0 si la imagen no declara ningún ancho. `anchoMayor` haría `Math.max()` sin
 * argumentos, que da `-Infinity`: puesto en un `max-width` en línea invalida la regla y la
 * foto se estira sin límite — justo lo contrario de lo que esta función existe para evitar.
 */
export function topeDeAmpliacion(imagen: Imagen): number {
  if (imagen.anchos.length === 0) return 0;
  return Math.round(anchoMayor(imagen) * FACTOR_AMPLIACION);
}

/**
 * La foto de al lado, dando la vuelta en los extremos.
 *
 * DA LA VUELTA Y NO SE FRENA. En un visor a pantalla completa, una flecha que deja de
 * responder al llegar al final se lee como que se colgó, y no queda ninguna pista de que
 * había que volver para el otro lado.
 *
 * Normaliza el índice de entrada en vez de confiar en él: el color puede cambiar mientras
 * el visor está abierto, y el nuevo puede tener menos fotos que el anterior.
 */
export function fotoVecina(actual: number, cantidad: number, paso: 1 | -1): number {
  if (!Number.isInteger(cantidad) || cantidad <= 0) return 0;

  const desde = Number.isInteger(actual) ? actual : 0;
  // El doble módulo es para los negativos: en JavaScript `-1 % 4` es `-1`, no `3`.
  return (((desde + paso) % cantidad) + cantidad) % cantidad;
}
