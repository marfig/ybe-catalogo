/**
 * Subida del video de un producto a R2 y alta en `videos`.
 *
 * ES EL HERMANO DE `subida.ts`, NO SU REEMPLAZO, y hereda su riesgo central: el hash
 * lo calcula el NAVEGADOR y con él se arma la clave de R2. Un hash equivocado, por un
 * bug de nuestro propio cliente, escribiría encima del video de otro producto. De ahí
 * las dos mismas defensas: **se valida el formato del hash** y **nunca se sobreescribe**
 * una clave existente. El peor caso deja de ser «destruiste un archivo» y pasa a ser
 * «te devolvió el que ya estaba».
 *
 * LO QUE ESTE MÓDULO TIENE Y AQUEL NO. Una imagen se procesa antes de subirse: el
 * canvas del navegador la redimensiona y la reescribe como WebP, así que a R2 nunca
 * llegan los bytes que la persona eligió. Un video no se puede procesar —sharp no corre
 * en Workers y el canvas no transcodifica— así que entra TAL CUAL. Es el único punto
 * del sistema donde bytes que nadie tocó terminan en un bucket público, y por eso la
 * validación de contenido es lo que más se prueba acá.
 *
 * El poster sí pasa por el canvas: es un cuadro del video dibujado con `drawImage` y
 * exportado a WebP, o sea el mismo camino que cualquier foto.
 */
import type { Ejecutar } from './grilla.ts';
import { esWebp } from './subida.ts';
import { claveDePoster, claveDeVideo } from './video.ts';

/** Mismo `Cache-Control` que las imágenes: la clave lleva el hash, el contenido no cambia. */
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * Tope del archivo de video.
 *
 * NO ES UNA LIMITACIÓN TÉCNICA, ES LA DECISIÓN DE NO TRANSCODIFICAR. Un video de cámara
 * a 1080p30 son unos 17 Mbps: 30 MB o más por quince segundos. Con este tope no entra,
 * y la persona tiene que pasarlo por WhatsApp, que lo reencoda a 1 o 3 MB. Ese es el
 * compresor que ya tiene y que ya usa todos los días — el sistema no necesita otro.
 *
 * Por eso el mensaje de rechazo NOMBRA ese camino. Un «archivo demasiado grande» a
 * secas deja a la persona trabada con la herramienta en la mano.
 */
export const MAXIMO_BYTES = 10 * 1024 * 1024;

/**
 * Tope del poster. Holgado a propósito: un WebP de 600 px ronda los 50 kB, así que esto
 * sólo corta lo absurdo, igual que el tope de las derivadas en `subida.ts`.
 */
const MAXIMO_POSTER_BYTES = 4 * 1024 * 1024;

const RE_HASH16 = /^[0-9a-f]{16}$/;

/** Lo mínimo de R2 que este módulo necesita. Facilita testear sin bucket. */
export interface BaldeR2 {
  put(
    clave: string,
    bytes: Uint8Array,
    opciones: { httpMetadata: { contentType: string; cacheControl: string } }
  ): Promise<unknown>;
}

export interface DatosVideo {
  /** SHA-256 de los bytes del archivo, primeros 16 hex. */
  hash16: string;
  ancho: number;
  alto: number;
  /** El archivo, sin procesar. */
  video: Uint8Array;
  /** El cuadro de portada, ya pasado a WebP por el canvas. */
  poster: Uint8Array;
}

/**
 * ¿Los bytes son un MP4?
 *
 * LA FIRMA NO ESTÁ AL PRINCIPIO, y esto es lo que hace que la función exista en vez de
 * ser una línea suelta. Un MP4 arranca con el TAMAÑO de su primera caja —cuatro bytes
 * que varían de archivo a archivo— y recién en el byte 4 aparece `ftyp`. Mirar el byte 0
 * buscando una firma fija, que es el reflejo natural, rechazaría todos los MP4.
 *
 * No se valida la marca (`isom`, `mp42`, `avc1`…): son muchas y legítimas, y quien de
 * verdad decide si el archivo se reproduce es el navegador de quien mira el catálogo.
 * Lo que esto corta es otra cosa: un WebP o un PDF renombrado a `.mp4`, servido con
 * `Content-Type: video/mp4` desde una URL pública.
 */
export function esMp4(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  return [...'ftyp'].every((c, i) => bytes[4 + i] === c.charCodeAt(0));
}

/** Valida todo antes de tocar R2 o la base. Lanza con el motivo. */
export function validarVideo({ hash16, ancho, alto, video, poster }: DatosVideo): void {
  // El formato del hash no es cosmética: con este valor se arma la clave de R2.
  if (!RE_HASH16.test(hash16)) {
    throw new Error(
      `hash16 inválido: ${JSON.stringify(hash16)}. Se esperan 16 caracteres hex en minúscula.`
    );
  }

  const entero = (n: number) => Number.isInteger(n) && n > 0;
  if (!entero(ancho) || !entero(alto)) {
    throw new Error(`Dimensiones inválidas: ${ancho}×${alto}.`);
  }

  if (video.length > MAXIMO_BYTES) {
    const mb = (video.length / 1024 / 1024).toFixed(1);
    throw new Error(
      `El video pesa ${mb} MB y el tope son ${MAXIMO_BYTES / 1024 / 1024} MB. ` +
        'Mandátelo por WhatsApp y subí el que te llega: queda liviano y se ve igual.'
    );
  }

  if (!esMp4(video)) {
    throw new Error('El archivo no es un MP4. Cambiarle la extensión no lo convierte.');
  }

  if (poster.length > MAXIMO_POSTER_BYTES) {
    throw new Error(`El poster pesa ${Math.round(poster.length / 1024)} kB. Parece un error.`);
  }

  if (!esWebp(poster)) {
    throw new Error('El poster no es un WebP.');
  }
}

/**
 * Arma los datos desde el `FormData` del navegador.
 *
 * Va aparte del endpoint y con tests propios, igual que `datosDesdeFormulario` en
 * `subida.ts`, porque es el punto donde entra input no confiable: un campo faltante o un
 * número que no es número no puede terminar en un `NaN` viajando hasta el `INSERT`.
 *
 * MULTIPART Y NO UN CUERPO CRUDO, apartándose del diseño original. La idea era un
 * `PUT` con el archivo suelto para no bufferear los 10 MB que `FormData` bufferea. Pero
 * ese ahorro no existe acá: `guardarVideo` recibe un `Uint8Array` —lo necesita para
 * mirar los magic bytes y para medir el peso real— así que el archivo termina en
 * memoria de todos modos. Y un cuerpo crudo lleva UN objeto, mientras que esto son dos:
 * el video y su poster. Con el cuerpo crudo harían falta dos requests y un estado a
 * medias entre ellas.
 *
 * Con el tope de 10 MB, bufferear es higiene y no un riesgo de arquitectura. La
 * protección de verdad es rechazar por tamaño ANTES de parsear, que hace el endpoint
 * mirando `Content-Length`.
 */
export async function datosDesdeFormularioVideo(
  form: FormData
): Promise<DatosVideo & { codigo: string }> {
  const texto = (clave: string): string => {
    const v = form.get(clave);
    if (typeof v !== 'string' || v.trim() === '') {
      throw new Error(`Falta el campo ${clave}.`);
    }
    return v.trim();
  };

  const numero = (clave: string): number => {
    const n = Number(texto(clave));
    if (!Number.isFinite(n)) throw new Error(`El campo ${clave} no es un número.`);
    return n;
  };

  const archivo = async (clave: string): Promise<Uint8Array> => {
    const v = form.get(clave);
    if (v === null) throw new Error(`Falta el campo ${clave}.`);
    if (typeof v === 'string' || typeof v.arrayBuffer !== 'function') {
      throw new Error(`El campo ${clave} no es un archivo.`);
    }
    return new Uint8Array(await v.arrayBuffer());
  };

  return {
    codigo: texto('codigo'),
    hash16: texto('hash16'),
    ancho: numero('ancho'),
    alto: numero('alto'),
    video: await archivo('video'),
    poster: await archivo('poster'),
  };
}

export interface ResultadoVideo {
  hash16: string;
  /** `true` si el hash ya existía: no se subió nada. */
  reusado: boolean;
}

/**
 * Sube el video con su poster y registra la fila. Idempotente por hash.
 *
 * @param deps  ejecutor de D1 y balde de R2, inyectados para poder testear sin nube.
 */
export async function guardarVideo(
  { ejecutar, balde }: { ejecutar: Ejecutar; balde: BaldeR2 },
  datos: DatosVideo,
  { ahora }: { ahora: string }
): Promise<ResultadoVideo> {
  validarVideo(datos);
  const { hash16, ancho, alto, video, poster } = datos;

  /**
   * DEDUPE Y PROTECCIÓN, la misma consulta, igual que en `subida.ts`. Si el hash ya
   * está, se reusa y no se escribe nada. Tampoco se actualizan las dimensiones: gana la
   * primera fila, que es la que de verdad corresponde a ese contenido.
   */
  const existentes = await ejecutar<{ hash16: string }>(
    `SELECT hash16 FROM videos WHERE hash16 = ?`,
    [hash16]
  );
  if (existentes.length > 0) {
    return { hash16, reusado: true };
  }

  /**
   * R2 PRIMERO, la fila después.
   *
   * Una fila sin sus objetos es un `<video>` roto en la ficha. Al revés —objetos sin
   * fila— es basura invisible que la recolección de huérfanas se lleva. De los dos
   * desórdenes posibles se elige el que no se ve.
   */
  await balde.put(claveDeVideo(hash16), video, {
    httpMetadata: { contentType: 'video/mp4', cacheControl: CACHE_CONTROL },
  });
  await balde.put(claveDePoster(hash16), poster, {
    httpMetadata: { contentType: 'image/webp', cacheControl: CACHE_CONTROL },
  });

  await ejecutar(
    `INSERT INTO videos (hash16, ancho, alto, bytes, creado_en) VALUES (?, ?, ?, ?, ?)`,
    [hash16, ancho, alto, video.length, ahora]
  );

  return { hash16, reusado: false };
}

/**
 * Cuelga un video ya subido de un producto.
 *
 * Paso aparte de `guardarVideo` porque son dos cosas distintas: subir el archivo es
 * idempotente por hash y puede reusar uno que ya estaba; asignarlo es lo que cambia el
 * producto. Un video puede existir en la base y no colgar de nadie —queda huérfano y la
 * papelera se lo lleva— y el mismo video puede colgar de dos productos.
 *
 * Reemplazar es sólo un UPDATE: el video anterior queda huérfano, que es el estado que
 * la recolección sabe limpiar.
 */
export async function asignarVideo(
  ejecutar: Ejecutar,
  { productoId, hash16, ahora }: { productoId: number; hash16: string; ahora: string }
): Promise<void> {
  const filas = await ejecutar<{ id: number }>(`SELECT id FROM videos WHERE hash16 = ?`, [hash16]);
  const video = filas[0];
  if (!video) {
    // Un UPDATE con un id que no existe fallaría por foreign key con un mensaje de
    // SQLite. Este dice qué pasó.
    throw new Error(`No existe ningún video con hash ${hash16}.`);
  }

  await ejecutar(
    `UPDATE productos SET video_id = ?, actualizado_en = ? WHERE id = ?`,
    [video.id, ahora, productoId]
  );
}

/**
 * Le saca el video al producto.
 *
 * NO BORRA NI LA FILA NI EL OBJETO, a propósito. Sacar un video de una ficha es un clic;
 * destruir el archivo no debería serlo. La fila queda huérfana y la papelera decide
 * cuándo se borra de verdad, con su confirmación y su conteo.
 */
export async function quitarVideo(
  ejecutar: Ejecutar,
  { productoId, ahora }: { productoId: number; ahora: string }
): Promise<void> {
  await ejecutar(`UPDATE productos SET video_id = NULL, actualizado_en = ? WHERE id = ?`, [
    ahora,
    productoId,
  ]);
}
