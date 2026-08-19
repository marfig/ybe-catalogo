/**
 * Mejoras del formulario de alta que un `<form>` no puede dar solo (§9, §8.3).
 *
 * Todo lo de acá es OPCIONAL: si este archivo no carga, el formulario sigue creando
 * productos con la variante que viene rendida del servidor. Lo que se pierde son las
 * fotos y la comodidad, no el trabajo tipeado.
 */
import {
  MOVIMIENTOS,
  esIdentidad,
  ordenTrasMover,
  type Movimiento,
} from '../lib/orden-colores.ts';
import { subirFoto } from './recorte.ts';

/**
 * OJO: se usa `appendChild` y no `append`.
 *
 * `worker-configuration.d.ts` declara el `Element` de HTMLRewriter, que TAPA al del
 * DOM en todo el proyecto: con `append`, TypeScript espera un `Response` y el archivo
 * no compila. `appendChild` no existe en el de Workers, asi que resuelve al del DOM.
 * No cambiarlo por `append` sin verificar que compile.
 */

/** Agrega una variante, permite subirle fotos y acomodar en qué orden se ven. */
export function prepararAlta(): void {
  const lista = document.getElementById('variantes-lista');
  const plantilla = document.getElementById('plantilla-variante') as HTMLTemplateElement | null;
  const contenedor = document.getElementById('variantes');
  if (!lista || !plantilla || !contenedor) return;

  // Antes del boton de agregar, para que la explicacion quede pegada a la lista y no
  // debajo de un boton.
  const refrescarOrden = activarOrden(lista, contenedor);

  const boton = document.createElement('button');
  boton.type = 'button';
  boton.textContent = 'Agregar otro color';
  boton.className = 'secundario';
  boton.addEventListener('click', () => {
    const fila = plantilla.content.cloneNode(true) as DocumentFragment;
    lista.appendChild(fila);
    activarFotos(lista.lastElementChild as HTMLElement);
    // El color nuevo entra al final y necesita sus controles; y el que era ultimo deja
    // de serlo, asi que su flecha de bajar tiene que dejar de estar deshabilitada.
    refrescarOrden();
  });
  contenedor.appendChild(boton);

  for (const fila of lista.querySelectorAll<HTMLElement>('.variante')) activarFotos(fila);
  refrescarOrden();
}

/** Los controles de una fila, guardados sin tocar el DOM con `data-`. */
interface ControlesDeOrden {
  bloque: HTMLElement;
  marca: HTMLElement;
  botones: Map<Movimiento, HTMLButtonElement>;
}

/** Lo que cada movimiento dice en pantalla. */
const ROTULOS: Record<Movimiento, { texto: string; ayuda: string }> = {
  subir: { texto: '↑', ayuda: 'Subir este color' },
  bajar: { texto: '↓', ayuda: 'Bajar este color' },
  principal: { texto: 'Que se vea primero', ayuda: 'Mover este color al primer lugar' },
};

/**
 * Los controles de orden de los colores. Devuelve la funcion que los pone al dia.
 *
 * SE INYECTAN DESDE JS Y NO VIENEN EN EL HTML, por la misma razon que el campo de fotos:
 * sin JavaScript no hay a donde mover nada, y un boton visible prometeria algo que no puede
 * cumplir. Sin este archivo la pagina queda como estaba —se editan colores y se guardan en
 * el orden que ya tenian— y no rota.
 *
 * NO HACE FALTA NINGUN CAMBIO EN EL SERVIDOR, y es lo que hace barato todo esto: el
 * formulario manda los colores en el orden del DOM, y `actualizarProducto` y `crearProducto`
 * ya derivan `variantes.orden` de la posicion de cada uno en lo que llega. Mover el `<div>`
 * ES cambiar el orden; guardar lo escribe.
 *
 * Y por eso mismo NO se guarda al mover: se acomoda, se ve, y se aprieta «Guardar cambios»
 * una vez. Un boton que escribe en la base sin decirlo es la trampa que la grilla ya evita
 * separando el form de filtros del de edicion.
 */
function activarOrden(lista: HTMLElement, contenedor: HTMLElement): () => void {
  const filas = (): HTMLElement[] => [...lista.querySelectorAll<HTMLElement>('.variante')];
  const porFila = new WeakMap<HTMLElement, ControlesDeOrden>();

  /**
   * El aviso de lo que acaba de pasar.
   *
   * `aria-live` porque el cambio es puro reordenamiento visual: quien no ve la pantalla
   * aprieta una flecha y sin esto no se entera de nada. Es el mismo recurso que usa la barra
   * de progreso de la importacion.
   */
  const aviso = document.createElement('p');
  aviso.className = 'nota';
  aviso.setAttribute('aria-live', 'polite');

  const ayuda = document.createElement('p');
  ayuda.className = 'nota';
  ayuda.textContent =
    'El primero de la lista es el que se ve en el catálogo: su foto es la de la tarjeta del listado y el color que abre la ficha. Acomodalos y guardá.';

  // `insertBefore` con la lista como referencia: la explicacion va ARRIBA de los colores,
  // porque es lo que hay que leer antes de tocarlos.
  contenedor.insertBefore(ayuda, lista);
  contenedor.appendChild(aviso);

  const controles = (fila: HTMLElement): ControlesDeOrden => {
    const guardados = porFila.get(fila);
    if (guardados) return guardados;

    const bloque = document.createElement('p');
    bloque.className = 'variante-orden';

    const marca = document.createElement('span');
    marca.className = 'nota';
    bloque.appendChild(marca);

    const botones = new Map<Movimiento, HTMLButtonElement>();
    for (const movimiento of MOVIMIENTOS) {
      const boton = document.createElement('button');
      // `type="button"`: sin esto cada flecha seria un submit y acomodar los colores
      // guardaria el producto de casualidad.
      boton.type = 'button';
      boton.className = 'secundario';
      boton.textContent = ROTULOS[movimiento].texto;
      // El texto de las flechas es una flecha: el nombre de verdad va en el rotulo
      // accesible, no en el glifo.
      boton.setAttribute('aria-label', ROTULOS[movimiento].ayuda);
      boton.title = ROTULOS[movimiento].ayuda;
      boton.addEventListener('click', () => mover(fila, movimiento, boton));
      bloque.appendChild(boton);
      botones.set(movimiento, boton);
    }

    // Arriba de todo en la fila: el orden es del color entero, no de uno de sus campos.
    fila.insertBefore(bloque, fila.firstChild);

    const nuevos = { bloque, marca, botones };
    porFila.set(fila, nuevos);
    return nuevos;
  };

  const nombreDe = (fila: HTMLElement): string => {
    const campo = fila.querySelector<HTMLInputElement>('input[name="color"]');
    return campo?.value.trim() || 'Ese color';
  };

  const mover = (fila: HTMLElement, movimiento: Movimiento, boton: HTMLButtonElement): void => {
    const actuales = filas();
    const orden = ordenTrasMover(actuales.length, actuales.indexOf(fila), movimiento);

    // Reacomodar al vacio mueve el foco y no cambia nada: se lee como que algo paso.
    if (esIdentidad(orden)) return;

    // `appendChild` sobre un hijo que ya esta en la lista lo MUEVE al final. Recorriendo
    // el orden nuevo completo, la lista queda en ese orden.
    for (const i of orden) lista.appendChild(actuales[i]);

    refrescar();

    /**
     * El foco vuelve al mismo boton, que se movio con su fila. Sin esto el foco cae al
     * `<body>` y para dar el segundo paso hay que volver a tabular hasta ahi — o sea que
     * acomodar 18 colores con el teclado seria imposible.
     */
    boton.focus();

    const lugar = filas().indexOf(fila) + 1;
    aviso.textContent =
      lugar === 1
        ? `${nombreDe(fila)} quedó primero: es el que se va a ver.`
        : `${nombreDe(fila)} quedó en el lugar ${lugar} de ${actuales.length}.`;
  };

  const refrescar = (): void => {
    const actuales = filas();

    /**
     * Con un solo color no hay nada que ordenar, y la explicacion tampoco aplica. Es el caso
     * de la mitad del catalogo —192 de 381 productos, y los 177 del catalogo viejo entran
     * con una sola variante— asi que esconderlo no es un detalle: es no ensuciar la pantalla
     * mas frecuente con controles que no hacen nada.
     */
    const varios = actuales.length > 1;
    ayuda.hidden = !varios;
    if (!varios) aviso.textContent = '';

    for (const [i, fila] of actuales.entries()) {
      const c = controles(fila);
      c.bloque.hidden = !varios;
      c.marca.textContent = i === 0 ? 'Se ve primero' : `${i + 1}º`;
      c.botones.get('subir')!.disabled = i === 0;
      c.botones.get('bajar')!.disabled = i === actuales.length - 1;
      // En el primero, «que se vea primero» no tiene nada que hacer.
      c.botones.get('principal')!.hidden = i === 0;
    }
  };

  return refrescar;
}

/**
 * Suma el selector de fotos a una fila de variante.
 *
 * Se inyecta desde JS y no viene en el HTML a propósito: sin JS no hay canvas, así
 * que un campo de archivo visible prometería algo que no puede cumplir.
 */
function activarFotos(fila: HTMLElement): void {
  const ocultos = fila.querySelector<HTMLInputElement>('input[name="fotos"]');
  const galeria = fila.querySelector<HTMLElement>('.fotos');
  if (!ocultos || !galeria) return;

  const entrada = document.createElement('input');
  entrada.type = 'file';
  entrada.accept = 'image/*';
  entrada.multiple = true;

  const estado = document.createElement('span');
  estado.className = 'nota';

  const campo = document.createElement('p');
  campo.className = 'campo';
  const etiqueta = document.createElement('label');
  etiqueta.textContent = 'Fotos';
  campo.appendChild(etiqueta);
  campo.appendChild(entrada);
  campo.appendChild(estado);
  fila.appendChild(campo);
  galeria.hidden = false;

  entrada.addEventListener('change', async () => {
    const archivos = [...(entrada.files ?? [])];
    if (archivos.length === 0) return;

    entrada.disabled = true;
    const hashes = ocultos.value.split(',').filter(Boolean);

    for (const [i, archivo] of archivos.entries()) {
      estado.textContent = `Procesando ${i + 1} de ${archivos.length}…`;
      try {
        // Sin recorte explícito: se usa el cuadrado centrado más grande. El recorte
        // fino se hace arrastrando la vista previa, que es el paso siguiente.
        const foto = await subirFoto(archivo);
        if (hashes.includes(foto.hash16)) {
          // Dedupe visible: la misma foto dos veces no se muestra dos veces.
          estado.textContent = 'Esa foto ya estaba.';
          continue;
        }
        hashes.push(foto.hash16);
        ocultos.value = hashes.join(',');

        const img = document.createElement('img');
        img.src = foto.vistaPrevia;
        img.width = 72;
        img.height = 72;
        img.alt = '';
        galeria.appendChild(img);
      } catch (error) {
        // El mensaje del servidor está escrito en castellano para mostrarse tal cual.
        estado.textContent = error instanceof Error ? error.message : String(error);
        break;
      }
    }

    estado.textContent = `${hashes.length} foto(s) listas.`;
    entrada.disabled = false;
    entrada.value = '';
  });
}

/**
 * Avisa si el código ya existe, mientras se escribe.
 *
 * El alta ya lo detecta y ofrece editar (§9), pero enterarse DESPUÉS de cargar tres
 * colores y cuatro fotos es tarde. Esto lo dice al segundo campo.
 */
export function buscarCodigo(): void {
  const entrada = document.getElementById('codigo') as HTMLInputElement | null;
  const aviso = document.getElementById('aviso-codigo');
  if (!entrada || !aviso) return;

  let pendiente: number | undefined;
  entrada.addEventListener('input', () => {
    clearTimeout(pendiente);
    aviso.textContent = '';
    const codigo = entrada.value.trim();
    if (codigo === '') return;

    // Se espera a que deje de tipear: una consulta por tecla es ruido para la base y
    // parpadeo para quien escribe.
    pendiente = window.setTimeout(async () => {
      try {
        const r = await fetch(`/api/codigo?codigo=${encodeURIComponent(codigo)}`);
        const cuerpo = (await r.json()) as { existe: boolean; nombre?: string | null };
        if (!cuerpo.existe) {
          aviso.textContent = '';
          return;
        }
        // Enlace directo a la ficha: quien ya sabe cuál es no tiene por qué llenar
        // el formulario entero para que recién después lo mandemos ahí.
        aviso.textContent = `Ya existe: ${cuerpo.nombre ?? codigo}. `;
        const ir = document.createElement('a');
        ir.href = `/productos/${encodeURIComponent(codigo)}`;
        ir.textContent = 'Editarlo';
        aviso.appendChild(ir);
      } catch {
        // Un aviso que no llega no puede romper el formulario: se calla.
      }
    }, 400);
  });
}
