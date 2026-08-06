/**
 * Mejoras del formulario de alta que un `<form>` no puede dar solo (§9, §8.3).
 *
 * Todo lo de acá es OPCIONAL: si este archivo no carga, el formulario sigue creando
 * productos con la variante que viene rendida del servidor. Lo que se pierde son las
 * fotos y la comodidad, no el trabajo tipeado.
 */
import { subirFoto } from './recorte.ts';

/**
 * OJO: se usa `appendChild` y no `append`.
 *
 * `worker-configuration.d.ts` declara el `Element` de HTMLRewriter, que TAPA al del
 * DOM en todo el proyecto: con `append`, TypeScript espera un `Response` y el archivo
 * no compila. `appendChild` no existe en el de Workers, asi que resuelve al del DOM.
 * No cambiarlo por `append` sin verificar que compile.
 */

/** Agrega una variante y permite subirle fotos. */
export function prepararAlta(): void {
  const lista = document.getElementById('variantes-lista');
  const plantilla = document.getElementById('plantilla-variante') as HTMLTemplateElement | null;
  const contenedor = document.getElementById('variantes');
  if (!lista || !plantilla || !contenedor) return;

  const boton = document.createElement('button');
  boton.type = 'button';
  boton.textContent = 'Agregar otro color';
  boton.className = 'secundario';
  boton.addEventListener('click', () => {
    const fila = plantilla.content.cloneNode(true) as DocumentFragment;
    lista.appendChild(fila);
    activarFotos(lista.lastElementChild as HTMLElement);
  });
  contenedor.appendChild(boton);

  for (const fila of lista.querySelectorAll<HTMLElement>('.variante')) activarFotos(fila);
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
