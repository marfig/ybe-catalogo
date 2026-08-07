/**
 * Recorte asistido y generación de derivadas en el navegador (SPEC-etapa2 §8.3).
 *
 * `sharp` no corre en Workers, así que el procesamiento vive en el único lugar del
 * sistema con un motor de imágenes completo y gratis: el navegador, vía `<canvas>`.
 *
 * POR QUÉ HAY RECORTE Y NO SÓLO RELLENO AUTOMÁTICO: una foto de celular son 4000×3000
 * con encuadre arbitrario. Encajarla en 1:1 con relleno blanco deja el producto chico
 * y descentrado. Quien saca la foto es la única persona que sabe qué parte importa.
 *
 * Las reglas —qué derivadas se generan, qué pedazo entra en el cuadrado, que nunca se
 * amplíe— viven en `lib/imagen.ts`, puras y con tests. Acá está sólo lo que necesita
 * un navegador: leer el archivo, dibujar y subir.
 */
import { anchosParaLado, calcularEncuadre, recorteCentrado, type Recorte } from '../lib/imagen.ts';

/** Calidad WebP del contrato (SPEC.md §5.2). */
const CALIDAD = 0.82;

export interface FotoLista {
  hash16: string;
  /** Miniatura local para la vista previa, sin ir a la red. */
  vistaPrevia: string;
}

/**
 * SHA-256 de los bytes ORIGINALES, primeros 16 hex.
 *
 * Sobre el ORIGINAL y nunca sobre el WebP que sale del canvas: el encoder varía entre
 * navegadores y versiones, así que hashear la salida daría hashes distintos según
 * quién cargue y rompería el dedupe y la idempotencia (§8.1).
 */
export async function hash16De(archivo: File): Promise<string> {
  const resumen = await crypto.subtle.digest('SHA-256', await archivo.arrayBuffer());
  return [...new Uint8Array(resumen)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

/**
 * Dibuja en un cuadrado de `lado` y devuelve el WebP.
 *
 * Sin `recorte` entra la imagen entera, escalada y centrada: es el camino del scrape.
 */
async function derivada(
  imagen: ImageBitmap,
  recorte: Recorte | undefined,
  lado: number
): Promise<Blob> {
  const lienzo = new OffscreenCanvas(lado, lado);
  const ctx = lienzo.getContext('2d');
  if (!ctx) throw new Error('El navegador no pudo crear el lienzo.');

  /**
   * El relleno va PRIMERO y es blanco.
   *
   * Sin esto, lo que no cubre la foto queda transparente, y WebP conserva el alfa: en
   * el catálogo se vería el fondo de la página a través de la foto. El blanco además
   * coincide con el fondo real de las fotos del proveedor (SPEC.md §6.10).
   */
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, lado, lado);

  const e = calcularEncuadre({
    anchoOrigen: imagen.width,
    altoOrigen: imagen.height,
    lado,
    recorte,
  });
  ctx.drawImage(imagen, e.sx, e.sy, e.sw, e.sh, e.dx, e.dy, e.dw, e.dh);

  return lienzo.convertToBlob({ type: 'image/webp', quality: CALIDAD });
}

/**
 * Procesa un archivo y sube sus derivadas. Devuelve el hash para vincularlo.
 *
 * Si el recorte queda por debajo de 300 px no se genera nada: ampliar inventaría
 * píxeles y el catálogo prefiere el placeholder (SPEC.md §5.4, §5.5).
 */
export async function subirFoto(archivo: File, recorte?: Recorte): Promise<FotoLista> {
  const imagen = await createImageBitmap(archivo);
  return subir(archivo, imagen, recorte ?? recorteCentrado(imagen.width, imagen.height));
}

/**
 * Lo mismo, pero para una foto que vino del proveedor: **entra entera y se rellena con
 * blanco** (§8.1).
 *
 * NO ES EL MISMO ENCUADRE QUE EL ALTA MANUAL, Y NO PUEDE SERLO. Una foto de celular son
 * 4000×3000 con encuadre arbitrario, y ahí el cuadrado centrado acerca el producto
 * (§8.3). Una foto del proveedor ya viene compuesta sobre fondo blanco: recortarle un
 * cuadrado centrado le corta los costados al producto — un sillón de 800×600 pierde los
 * apoyabrazos. Y nadie está mirando cuando pasa, porque el scrape corre solo.
 *
 * `null` como recorte es exactamente lo que `calcularEncuadre` entiende por «la imagen
 * completa, escalada y centrada en el cuadrado».
 */
export async function subirFotoDelOrigen(archivo: File): Promise<FotoLista> {
  const imagen = await createImageBitmap(archivo);
  return subir(archivo, imagen, undefined);
}

/** El tronco común: elegir derivadas, dibujarlas, subirlas. */
async function subir(archivo: File, imagen: ImageBitmap, marco?: Recorte): Promise<FotoLista> {
  /**
   * El lado que decide qué derivadas entran: el del RECORTE cuando hay recorte, y el
   * mayor del original cuando la imagen entra entera. Mirar siempre el original diría
   * que un recorte de 250 px puede dar `w300`, que son 50 píxeles inventados.
   */
  const lado = marco ? marco.lado : Math.max(imagen.width, imagen.height);

  const anchos = anchosParaLado(lado);
  if (anchos.length === 0) {
    imagen.close();
    throw new Error(
      `La imagen quedó en ${lado} px y hacen falta al menos 300. ` +
        'Ampliar inventaría píxeles: mejor una foto más grande.'
    );
  }

  const form = new FormData();
  form.set('hash16', await hash16De(archivo));
  form.set('anchoOrigen', String(imagen.width));
  form.set('altoOrigen', String(imagen.height));
  form.set('bytesOrigen', String(archivo.size));
  for (const ancho of anchos) {
    form.set(`w${ancho}`, await derivada(imagen, marco, ancho), `w${ancho}.webp`);
  }

  const respuesta = await fetch('/api/imagenes', { method: 'POST', body: form });
  const cuerpo = (await respuesta.json()) as { hash16?: string; error?: string };
  if (!respuesta.ok || !cuerpo.hash16) {
    throw new Error(cuerpo.error ?? `El servidor respondió ${respuesta.status}.`);
  }

  // La vista previa sale del canvas que ya se dibujó, no de la red: la foto todavía
  // no está en el CDN y pedirla daría 404 por unos segundos.
  const chica = await derivada(imagen, marco, Math.min(300, lado));
  imagen.close();

  return { hash16: cuerpo.hash16, vistaPrevia: URL.createObjectURL(chica) };
}
