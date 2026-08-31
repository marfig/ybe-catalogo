/**
 * Elegir un video, sacarle el poster y subirlo, desde el navegador.
 *
 * MISMO REPARTO QUE `recorte.ts`: las reglas —dónde buscar el cuadro de portada, cuánto
 * mide el poster, cómo se arma la clave de R2— viven en `lib/video.ts`, puras y con
 * tests. Acá está sólo lo que necesita un navegador y no se puede probar sin uno: leer
 * el archivo, mover el `<video>` a un instante, dibujar y subir.
 *
 * POR QUÉ EL POSTER SE GENERA ACÁ Y EL VIDEO NO SE TOCA. El canvas puede dibujar un
 * cuadro de un video con `drawImage` —es una fuente de imagen como cualquier otra— pero
 * NO puede transcodificar el video. Así que el poster sigue el mismo camino que
 * cualquier foto del catálogo, y el video entra tal cual. Esa asimetría es la decisión
 * de fondo de toda la feature, y acá es donde se ve.
 */
import { MAXIMO_BYTES } from '../lib/subida-video.ts';
import { instanteDelPoster, medidaDelPoster } from '../lib/video.ts';
import { hash16De } from './recorte.ts';

/** Misma calidad WebP que las derivadas de las fotos (SPEC.md §5.2). */
const CALIDAD = 0.82;

interface Medido {
  ancho: number;
  alto: number;
  duracion: number;
  elemento: HTMLVideoElement;
}

/**
 * Carga el archivo en un `<video>` fuera de pantalla y espera sus metadatos.
 *
 * `preload="metadata"` y no `auto`: para medir y sacar un cuadro no hace falta bajar el
 * archivo entero, y es local igual.
 */
function medir(url: string): Promise<Medido> {
  return new Promise((resolver, rechazar) => {
    const el = document.createElement('video');
    el.preload = 'metadata';
    // Sin esto, iOS abre el reproductor a pantalla completa al tocar play y el
    // `seek` que viene después nunca ocurre en el elemento que estamos usando.
    el.playsInline = true;
    el.muted = true;
    el.src = url;

    el.onloadedmetadata = () =>
      resolver({
        ancho: el.videoWidth,
        alto: el.videoHeight,
        duracion: el.duration,
        elemento: el,
      });
    el.onerror = () =>
      rechazar(new Error('El navegador no pudo leer el video. ¿Seguro que es un MP4?'));
  });
}

/**
 * Dibuja el cuadro de portada y lo devuelve como WebP.
 *
 * EL `seek` HAY QUE ESPERARLO. Asignar `currentTime` y dibujar en la línea siguiente
 * pinta el cuadro ANTERIOR: el navegador todavía no decodificó el nuevo. El síntoma es
 * un poster negro que aparece a veces y en otras máquinas no — de los peores de
 * reproducir.
 */
async function posterDe({ ancho, alto, duracion, elemento }: Medido): Promise<Blob> {
  await new Promise<void>((resolver, rechazar) => {
    elemento.onseeked = () => resolver();
    elemento.onerror = () => rechazar(new Error('El navegador no pudo ubicar el cuadro.'));
    elemento.currentTime = instanteDelPoster(duracion);
  });

  const medida = medidaDelPoster(ancho, alto);
  const lienzo = new OffscreenCanvas(medida.ancho, medida.alto);
  const ctx = lienzo.getContext('2d');
  if (!ctx) throw new Error('El navegador no pudo crear el lienzo.');

  ctx.drawImage(elemento, 0, 0, medida.ancho, medida.alto);
  return lienzo.convertToBlob({ type: 'image/webp', quality: CALIDAD });
}

export interface VideoSubido {
  hash16: string;
  reusado: boolean;
}

/**
 * Sube el video de un producto. Lanza con un mensaje en castellano listo para mostrar.
 *
 * El tope se mira ACÁ ADEMÁS del servidor, y no es redundancia: subir 40 MB por una
 * conexión de celular para que el servidor los rechace es un minuto perdido y datos
 * gastados. El servidor igual no le cree al cliente — un cliente se puede saltear.
 */
export async function subirVideo(codigo: string, archivo: File): Promise<VideoSubido> {
  if (archivo.size > MAXIMO_BYTES) {
    const mb = (archivo.size / 1024 / 1024).toFixed(1);
    throw new Error(
      `El video pesa ${mb} MB y el tope son ${MAXIMO_BYTES / 1024 / 1024} MB. ` +
        'Mandátelo por WhatsApp y subí el que te llega: queda liviano y se ve igual.'
    );
  }

  const url = URL.createObjectURL(archivo);
  try {
    const medido = await medir(url);
    const poster = await posterDe(medido);

    // El hash es del archivo ORIGINAL, nunca del poster: es lo que identifica al video
    // y lo que arma su clave en R2. Mismo criterio que las fotos (§8.1).
    const hash16 = await hash16De(archivo);

    const form = new FormData();
    form.set('codigo', codigo);
    form.set('hash16', hash16);
    form.set('ancho', String(medido.ancho));
    form.set('alto', String(medido.alto));
    form.set('video', archivo);
    form.set('poster', poster);

    const respuesta = await fetch('/api/video', { method: 'POST', body: form });
    const cuerpo = (await respuesta.json()) as { error?: string; reusado?: boolean };
    if (!respuesta.ok) throw new Error(cuerpo.error ?? 'No se pudo subir el video.');

    return { hash16, reusado: cuerpo.reusado === true };
  } finally {
    // Sin esto el archivo queda retenido en memoria hasta que se cierre la pestaña, y
    // acá hablamos de hasta 10 MB por intento.
    URL.revokeObjectURL(url);
  }
}

/**
 * Conecta el campo de video de la ficha, si está en la página.
 *
 * Sale sin hacer nada cuando no está: el mismo script se carga en pantallas que no
 * tienen el campo.
 */
export function prepararVideo(): void {
  const campo = document.querySelector<HTMLInputElement>('#video-archivo');
  const codigo = campo?.dataset.codigo;
  if (!campo || !codigo) return;

  const aviso = document.querySelector<HTMLElement>('#video-aviso');
  const decir = (texto: string, esError = false) => {
    if (!aviso) return;
    aviso.textContent = texto;
    aviso.classList.toggle('nota--error', esError);
  };

  campo.addEventListener('change', async () => {
    const archivo = campo.files?.[0];
    if (!archivo) return;

    campo.disabled = true;
    decir('Subiendo…');
    try {
      const r = await subirVideo(codigo, archivo);
      decir(r.reusado ? 'Ese video ya estaba subido: se reusó.' : 'Video subido.');
      // Se recarga en vez de pintar la vista previa a mano: la ficha ya sabe dibujar
      // un producto con video, y duplicar ese dibujo acá sería una segunda verdad.
      location.reload();
    } catch (e) {
      decir(e instanceof Error ? e.message : String(e), true);
      campo.value = '';
    } finally {
      campo.disabled = false;
    }
  });
}
