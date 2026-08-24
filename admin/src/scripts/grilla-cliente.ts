/**
 * Habilitación de los botones de la grilla (SPEC-etapa2 §10.3).
 *
 * Acá está SÓLO el DOM. Lo que se decide vive en `lib/habilitacion.ts`, que es puro y
 * tiene tests: este archivo lee el estado del formulario, se lo pasa, y aplica lo que
 * vuelve.
 *
 * MEJORA PROGRESIVA, y el orden importa: los botones nacen HABILITADOS en el HTML y esto
 * los apaga al arrancar. Al revés —nacer apagados y encenderlos con JS— la pantalla
 * quedaría inservible si el script no carga, que es el peor final posible para una
 * guarda cuyo único propósito es evitar un error recuperable.
 *
 * Y esto NO reemplaza al servidor. `ejecutarAccion` sigue validando todo: una guarda que
 * sólo vive en el navegador no es una guarda.
 */
import {
  esCampoDeFila,
  esRequisito,
  habilitacionDe,
  type Requisito,
} from '../lib/habilitacion.ts';
import { conectarMarcarTodo, estadoDeMarcarTodo } from '../lib/seleccion.ts';

/** Los requisitos se declaran en el HTML: `data-requiere="guardado seleccion"`. */
const ATRIBUTO = 'data-requiere';

/**
 * La validación sale de `habilitacion.ts` y NO se escribe acá.
 *
 * Antes esto era `r === 'seleccion' || r === 'guardado'`, una segunda lista de requisitos
 * válidos. Al agregar `cambios` y `completos` quedó vieja, y los botones que sólo pedían
 * los nuevos se habilitaron siempre — sin error, sin test rojo, sin nada.
 */
function requisitosDe(boton: HTMLElement): Requisito[] {
  return (boton.getAttribute(ATRIBUTO) ?? '').split(/\s+/).filter(esRequisito);
}

/**
 * Los modales de ayuda: `data-abre="<id>"` abre, `data-cierra` cierra.
 *
 * Lo mínimo que hace falta, porque `<dialog>` ya trae casi todo: Escape cierra solo, el
 * foco queda atrapado adentro, y el fondo lo pinta `::backdrop`.
 *
 * Lo único que agrega esto es cerrar al clickear afuera. `<dialog>` no lo hace nativo, y
 * la forma de detectarlo es que el click caiga sobre el propio `<dialog>`: su caja
 * incluye el backdrop, así que un click en el contenido tiene otro `target`.
 */
function prepararModales(): void {
  for (const boton of document.querySelectorAll<HTMLElement>('[data-abre]')) {
    const dialogo = document.getElementById(boton.dataset.abre!);
    if (!(dialogo instanceof HTMLDialogElement)) continue;

    boton.addEventListener('click', () => dialogo.showModal());

    for (const cerrar of dialogo.querySelectorAll<HTMLElement>('[data-cierra]')) {
      cerrar.addEventListener('click', () => dialogo.close());
    }

    dialogo.addEventListener('click', (evento) => {
      if (evento.target === dialogo) dialogo.close();
    });
  }
}

export function prepararGrilla(): void {
  prepararModales();

  const form = document.querySelector<HTMLFormElement>('form[method="post"]');
  if (!form) return;

  const botones = Array.from(form.querySelectorAll<HTMLButtonElement>(`[${ATRIBUTO}]`));
  if (botones.length === 0) return;

  /**
   * El título original se guarda ANTES de tocar nada.
   *
   * Sin esto, el primer repintado lo sobrescribe con un motivo y el título propio del
   * botón —si algún día tiene uno— se pierde para siempre.
   */
  const titulos = new Map(botones.map((b) => [b, b.getAttribute('title') ?? '']));

  /**
   * Cuántos productos están listos para aprobarse. Lo cuenta el servidor al rendir.
   *
   * Viaja en el DOM y no se recalcula acá: la validación de §5.2 mira fotos, variantes y
   * categorías válidas, y reimplementarla en el navegador crearía una segunda verdad que
   * se separaría de la primera sin que nadie se entere.
   */
  const completos = Number(form.dataset.completos ?? '0');

  /**
   * Si algún campo de una fila cambió, COMPARANDO contra su valor inicial.
   *
   * No es un flag que se prende con un evento, y la diferencia importa. Para los otros
   * requisitos equivocarse cuesta un clic; para «Guardar» cuesta no poder guardar y
   * perder lo tipeado al irse. Un flag depende de que el evento haya saltado; esto lee el
   * estado real, así que da lo mismo cómo llegó el valor ahí.
   *
   * Regalo del método: si se tipea y se borra, vuelve a estar limpio y el botón se apaga
   * solo. Un flag quedaría sucio para siempre.
   *
   * `defaultValue` y `defaultChecked` son el valor que vino en el HTML, que el DOM guarda
   * aparte del actual. Para un `<select>`, el equivalente es la `<option>` con
   * `defaultSelected`.
   */
  const estaSucio = (): boolean => {
    for (const control of form.elements) {
      const nombre = control.getAttribute('name');
      if (!nombre || !esCampoDeFila(nombre)) continue;

      if (control instanceof HTMLInputElement) {
        if (control.type === 'checkbox' || control.type === 'radio') {
          if (control.checked !== control.defaultChecked) return true;
        } else if (control.value !== control.defaultValue) {
          return true;
        }
      } else if (control instanceof HTMLTextAreaElement) {
        if (control.value !== control.defaultValue) return true;
      } else if (control instanceof HTMLSelectElement) {
        const inicial = Array.from(control.options).find((o) => o.defaultSelected);
        // Sin ninguna `selected` en el HTML, el navegador elige la primera.
        if (control.value !== (inicial?.value ?? control.options[0]?.value ?? '')) return true;
      }
    }
    return false;
  };

  /**
   * Las casillas de fila. Se consultan en cada repintado y no se cachean: es la misma
   * razon por la que los eventos van delegados — las filas no cambian sin recargar hoy,
   * pero una lista guardada es lo que se rompe en silencio el dia que cambien.
   */
  const casillas = () => Array.from(form.querySelectorAll<HTMLInputElement>('input[name="id"]'));

  /**
   * La casilla de «marcar todos» del encabezado.
   *
   * Puede no existir: la tabla no se rinde cuando el filtro no devuelve ninguna fila.
   * Todo lo que sigue la trata como opcional en vez de asumirla.
   */
  const marcarTodo = document.querySelector<HTMLInputElement>('#marcar-todo');

  /**
   * La regla vive en `lib/seleccion.ts`, con tests. Aca solo se le pasa el DOM.
   *
   * Y no avisa a nadie a proposito: escribir `.checked` por codigo no dispara ningun
   * evento, pero el `click` que la disparo sigue su curso y despues salen `input` y
   * `change`, que burbujean al formulario y repintan leyendo las filas ya escritas.
   * Cual evento se escucha NO es un detalle: ver el comentario de `conectarMarcarTodo`.
   */
  if (marcarTodo) conectarMarcarTodo(marcarTodo, casillas);

  const repintar = () => {
    const todas = casillas();
    const seleccionados = todas.filter((c) => c.checked).length;
    const sucio = estaSucio();

    if (marcarTodo) {
      const { marcada, indeterminada } = estadoDeMarcarTodo(seleccionados, todas.length);
      marcarTodo.checked = marcada;
      // `indeterminate` NO tiene atributo HTML: es solo una propiedad del DOM, asi que
      // este es el unico lugar donde se puede poner.
      marcarTodo.indeterminate = indeterminada;
    }

    for (const boton of botones) {
      const { habilitado, motivos } = habilitacionDe(requisitosDe(boton), {
        sucio,
        seleccionados,
        completos,
      });
      boton.disabled = !habilitado;

      /**
       * El motivo va al `title` porque estos botones ya no tienen su nota al lado.
       *
       * `aria-disabled` ADEMÁS de `disabled`: el `disabled` nativo saca al botón del
       * orden de tabulación, así que con teclado nunca se llega a él y nunca se escucha
       * por qué está apagado. El `aria-disabled` deja el motivo alcanzable.
       */
      const titulo = habilitado ? titulos.get(boton)! : motivos.join(' ');
      if (titulo === '') boton.removeAttribute('title');
      else boton.setAttribute('title', titulo);
      boton.setAttribute('aria-disabled', String(!habilitado));
    }
  };

  /**
   * `input` y `change` en el formulario, y no un listener por control.
   *
   * Son 50 filas por 5 campos: 250 listeners para observar algo que el borboteo ya trae
   * gratis. Y las filas no cambian sin recargar la página, pero delegar igual es lo que
   * hace que esto no se rompa el día que cambien.
   */
  form.addEventListener('input', repintar);
  form.addEventListener('change', repintar);

  /**
   * Al volver con «atrás» el navegador restaura los valores tipeados SIN disparar ningún
   * evento. `pageshow` con `persisted` es el único aviso de que la página salió del caché
   * de navegación, y sin este repintado los botones quedarían mostrando el estado de
   * antes de que se restauraran los valores.
   *
   * Como `sucio` se computa comparando, acá no hay que adivinar nada: se recalcula y sale
   * lo que corresponda.
   */
  window.addEventListener('pageshow', repintar);

  repintar();
}
