/**
 * La recuperación de las fotos que faltan.
 *
 * QUÉ ARREGLA. `unaFoto` está escrita para no lanzar nunca (§7.4): si la red se corta en el
 * medio de una importación, anota el problema y la corrida sigue. Eso es correcto —una foto
 * caída no puede tumbar 900 fichas— pero el hueco NO se cierra solo: no hay reintento, y la
 * importación viene con «saltear los que ya tengo» tildada, así que en la próxima corrida
 * `sinVisitar` filtra justamente esas fichas porque el producto ya está en la base.
 *
 * SÍ PIDE FOTOS, y es la diferencia con el relleno de descripciones, que explícitamente no
 * lo hace porque esos productos ya las tenían. Acá las fotos son el único objetivo, así que
 * la corrida cuesta un pedido por ficha MÁS uno por foto: es la parte lenta, y es la que
 * hace el trabajo.
 *
 * NO ES CÓDIGO DE UN SOLO USO. Una foto que se cae por red va a volver a pasar cada vez que
 * la conexión titubee en una importación larga; esta pantalla es la que lo cierra.
 *
 * Corre en la pestaña por el motivo de siempre (§7.1): un pedido por segundo durante varios
 * minutos no cabe en el presupuesto de CPU de un Worker.
 */
import { esperaMs } from '../lib/scrape/marcha.ts';
import { traerFotos, type FichaConFotos } from './fotos.ts';
import { postJson } from './pedidos.ts';

interface ProductoSinFotos {
  id: number;
  codigo: string;
  url: string;
  estado: string;
}

interface RespuestaLista {
  scrapeId?: number;
  total?: number;
  productos?: ProductoSinFotos[];
  error?: string;
}

interface RespuestaFicha extends FichaConFotos {
  productoId?: number;
  omitida?: boolean;
  error?: string;
}

interface Pantalla {
  empezar: HTMLButtonElement;
  cancelar: HTMLButtonElement;
  progreso: HTMLElement;
  relleno: HTMLElement;
  barra: HTMLElement;
  problemas: HTMLDetailsElement;
  listaProblemas: HTMLElement;
  resumen: HTMLElement;
}

function pantalla(): Pantalla | null {
  const buscar = <T extends HTMLElement>(id: string): T | null =>
    document.getElementById(id) as T | null;

  const partes = {
    empezar: buscar<HTMLButtonElement>('empezar'),
    cancelar: buscar<HTMLButtonElement>('cancelar'),
    progreso: buscar('progreso'),
    relleno: buscar('barra-relleno'),
    barra: buscar('barra'),
    problemas: buscar<HTMLDetailsElement>('problemas'),
    listaProblemas: buscar('lista-problemas'),
    resumen: buscar('resumen'),
  };

  return Object.values(partes).every(Boolean) ? (partes as Pantalla) : null;
}

/** Cuántas fotos ofrece la ficha, sumando todos los colores. */
function fotosOfrecidas(ficha: RespuestaFicha): number {
  return (ficha.colores ?? []).reduce((total, color) => total + color.fotos.length, 0);
}

export function prepararFotosFaltantes(): void {
  const p = pantalla();
  if (!p) return;

  let cancelado = false;
  let ultimoPedido: number | null = null;

  const cortesia = async (): Promise<void> => {
    const espera = esperaMs(ultimoPedido, Date.now());
    if (espera > 0) await new Promise((listo) => setTimeout(listo, espera));
    ultimoPedido = Date.now();
  };

  const anotarProblema = (que: string, motivo: string): void => {
    // Nodos y no `innerHTML`: el motivo viene del proveedor, y un texto de afuera nunca
    // entra como HTML.
    const fila = document.createElement('li');
    const titulo = document.createElement('strong');
    titulo.textContent = que;
    fila.appendChild(titulo);
    fila.appendChild(document.createTextNode(` — ${motivo}`));
    p.listaProblemas.appendChild(fila);
    p.problemas.hidden = false;
  };

  const terminar = (mensaje: string): void => {
    p.resumen.textContent = mensaje;
    p.resumen.hidden = false;
    p.empezar.disabled = false;
    p.cancelar.hidden = true;
  };

  p.cancelar.addEventListener('click', () => {
    cancelado = true;
    p.cancelar.disabled = true;
    p.cancelar.textContent = 'Cortando…';
  });

  p.empezar.addEventListener('click', async () => {
    p.empezar.disabled = true;
    p.cancelar.hidden = false;
    p.cancelar.disabled = false;
    p.cancelar.textContent = 'Cortar';
    p.resumen.hidden = true;
    p.listaProblemas.replaceChildren();
    p.problemas.hidden = true;
    cancelado = false;

    let scrapeId: number | null = null;
    let conFotos = 0;
    let sinNinguna = 0;
    let problemas = 0;

    /**
     * Lo resuelto de cualquier forma, para la barra. Todo cuenta: la barra mide cuánto queda
     * del recorrido, no cuántas fotos entraron. Si lo que falló no avanzara, la barra no
     * llegaría al final aunque no quedara nada por hacer.
     */
    const mostrar = (total: number): void => {
      const hechos = conFotos + sinNinguna + problemas;
      const partes = [`Revisados ${hechos} de ${total}`, `${conFotos} con fotos`];
      if (sinNinguna > 0) partes.push(`${sinNinguna} que el proveedor sirve sin foto`);
      if (problemas > 0) partes.push(`${problemas} con problema`);
      p.progreso.textContent = partes.join(' · ');

      const pct = total > 0 ? Math.min(100, (hechos / total) * 100) : 0;
      p.relleno.style.inlineSize = `${pct}%`;
      p.barra.setAttribute('aria-valuenow', String(Math.round(pct)));
    };

    try {
      // La lista sale de NUESTRA base, así que no cuesta tráfico del proveedor y no lleva
      // cortesía. Abre la corrida en el mismo pedido.
      const lote = await postJson<RespuestaLista>('/api/scrape/sin-fotos', {});
      if (lote.error) {
        terminar(lote.error);
        return;
      }

      const productos = lote.productos ?? [];
      if (productos.length === 0) {
        terminar('No queda ningún producto sin fotos.');
        return;
      }
      if (typeof lote.scrapeId !== 'number') {
        terminar('No se pudo abrir la corrida.');
        return;
      }
      scrapeId = lote.scrapeId;
      mostrar(productos.length);

      for (const producto of productos) {
        if (cancelado) break;

        await cortesia();
        const ficha = await postJson<RespuestaFicha>('/api/scrape/ficha', {
          scrapeId,
          url: producto.url,
        });

        if (ficha.error) {
          // Fallo tolerante (§7.4): ya quedó en `scrape_errores` y la corrida sigue.
          anotarProblema(producto.codigo, ficha.error);
          problemas++;
          mostrar(productos.length);
          continue;
        }

        /**
         * `omitida` es un hermano de color que ya se visitó en esta corrida. Acá NO se
         * cuenta como resuelto ni como problema: sus fotos las subió la ficha que sí se
         * pidió, así que si igual quedó sin imagen va a volver a salir en esta lista la
         * próxima vez que se corra, que es la respuesta correcta.
         */
        if (ficha.omitida) {
          sinNinguna++;
          mostrar(productos.length);
          continue;
        }

        /**
         * SI EL PROVEEDOR NO OFRECE NINGUNA FOTO, no hay nada que subir y hay que decirlo.
         *
         * Este producto va a seguir apareciendo en esta lista en cada corrida, para siempre,
         * porque la condición que lo trae —cero imágenes— nunca va a dejar de cumplirse. No
         * es un fallo que se reintenta: es un producto que el proveedor sirve sin imagen, y
         * lo que corresponde es aprobarlo marcando «permitir sin foto» o cargarle una a
         * mano. Contarlo aparte es lo que permite saber la diferencia sin abrir 40 fichas.
         */
        if (fotosOfrecidas(ficha) === 0) {
          sinNinguna++;
          mostrar(productos.length);
          continue;
        }

        await traerFotos(ficha, cortesia, anotarProblema);

        /**
         * No se vuelve a consultar la base para confirmar que la foto quedó: sería un pedido
         * más por producto para saber algo que la próxima corrida cuenta igual. Lo que no se
         * pudo subir sigue saliendo en esta misma lista, y lo que falló ya quedó anotado en
         * la lista de problemas por `traerFotos`.
         */
        conFotos++;
        mostrar(productos.length);
      }

      await postJson('/api/scrape/cerrar', { scrapeId, abortado: cancelado });

      const cola = cancelado
        ? 'Cortado. Apretá de nuevo y sigue por donde iba: lo ya resuelto sale solo de la lista.'
        : 'Listo. Volvé a entrar acá para ver si quedó alguno sin resolver.';
      terminar(`${p.progreso.textContent}. ${cola}`);
    } catch (error) {
      /**
       * Se intenta cerrar la corrida aunque el bucle explote: una corrida abierta bloquea la
       * próxima con un 409 que hablaría de un recorrido que murió hace rato.
       */
      if (scrapeId !== null) {
        await postJson('/api/scrape/cerrar', { scrapeId, abortado: true }).catch(() => {});
      }
      terminar(error instanceof Error ? error.message : String(error));
    }
  });
}
