/**
 * La foto de una ficha de pedido especial (SPEC.md §4.5).
 *
 * Lo unico que esta pantalla no puede hacer con un formulario pelado: derivar w300/w600
 * en el canvas y subirlas antes de guardar. El resto —crear, editar, ocultar, borrar—
 * son POST comunes.
 *
 * Reusa `subirFoto` tal cual, que es el mismo recorte cuadrado centrado del alta manual
 * de productos (§8.3) y el mismo dedupe por hash de los bytes originales. Aca no habia
 * nada que inventar: `guardarImagen` registra en `imagenes` sin saber nada de productos
 * ni variantes, asi que el pipeline entero sirve sin tocarlo.
 */
import { subirFoto } from './recorte.ts';

/**
 * UNA foto por ficha, no un arreglo como en un producto.
 *
 * Elegir una segunda REEMPLAZA a la primera en vez de sumarse: no hay colores que
 * elegir, asi que una galeria no tendria quien la navegue. El hash viejo no se borra de
 * `imagenes` —puede estar compartido con un producto por el dedupe de contenido—; queda
 * para la recoleccion de huerfanas (§12.3).
 */
export function montarFotoDePedido(caja: HTMLElement): void {
  const oculto = caja.querySelector<HTMLInputElement>('[data-hash]');
  const archivo = caja.querySelector<HTMLInputElement>('[data-archivo]');
  const vista = caja.querySelector<HTMLElement>('[data-vista]');
  const estado = caja.querySelector<HTMLElement>('[data-estado]');

  // Si falta cualquiera de las cuatro partes, el marcado cambio y este script quedo
  // desincronizado. Se sale en silencio: el formulario sigue siendo usable con la foto
  // que ya tenia, que es mejor que reventar la pantalla entera.
  if (!oculto || !archivo || !vista || !estado) return;

  const original = estado.textContent;

  archivo.addEventListener('change', async () => {
    const elegido = archivo.files?.[0];
    if (!elegido) return;

    estado.textContent = 'Procesando la foto…';
    /**
     * El `<input type="file">` se deshabilita mientras sube, y el submit tambien.
     *
     * Sin esto se puede apretar «Guardar» con el hash viejo todavia en el campo oculto
     * y la foto nueva a mitad de camino: la ficha se guardaria con la anterior y nadie
     * entenderia por que no cambio.
     */
    archivo.disabled = true;
    const enviar = caja.closest('form')?.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (enviar) enviar.disabled = true;

    try {
      const foto = await subirFoto(elegido);
      oculto.value = foto.hash16;

      const img = document.createElement('img');
      img.src = foto.vistaPrevia;
      img.width = 120;
      img.height = 120;
      img.alt = '';
      vista.replaceChildren(img);

      estado.textContent = 'Foto lista. Guardá para que quede en la ficha.';
    } catch (e) {
      /**
       * El campo oculto NO se toca cuando falla: si la ficha ya tenia foto, sigue
       * teniendo la que tenia. Vaciarlo convertiria un error de subida en una ficha sin
       * imagen, que es un problema peor y mas dificil de ver.
       */
      estado.textContent = `No se pudo subir: ${e instanceof Error ? e.message : String(e)}`;
      // El archivo se limpia para que un segundo intento con el MISMO archivo vuelva a
      // disparar el `change`, que no se emite si el valor no cambio.
      archivo.value = '';
    } finally {
      archivo.disabled = false;
      if (enviar) enviar.disabled = false;
    }
  });

  // Se restaura la ayuda original al enfocar el selector otra vez: un cartel de error
  // que se queda para siempre se lee como el estado actual y no como lo que paso.
  archivo.addEventListener('focus', () => {
    if (estado.textContent !== original && !oculto.value) estado.textContent = original;
  });
}
