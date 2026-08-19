/**
 * El relleno de las descripciones que faltan. CÓDIGO DE UN SOLO USO.
 *
 * QUÉ ARREGLA. El regex que reconoce la etiqueta de medidas del proveedor aceptaba sólo una de
 * sus dos redacciones, así que 438 productos entraron con la descripción vacía. Arreglado el
 * regex, hacía falta volver a pasar por esas fichas — y `registrarFicha` ahora rellena una
 * descripción vacía en el UPDATE, así que pasar es todo lo que hay que hacer.
 *
 * NO PIDE FOTOS, y es la diferencia con la importación: estos productos ya las tienen. Sin ese
 * paso la corrida es un pedido por producto en vez de uno por foto, o sea minutos en vez de
 * media hora. Si la ficha trae un color nuevo, la variante entra sin foto y queda marcada con
 * `cambio_en_origen` para que alguien la mire — que es lo que ese aviso existe para hacer.
 *
 * Corre en la pestaña por el motivo de siempre (§7.1): un pedido por segundo durante varios
 * minutos no cabe en el presupuesto de CPU de un Worker.
 *
 * SE BORRA CUANDO NO QUEDEN PRODUCTOS SIN DESCRIPCIÓN. Lo que se queda es el arreglo del regex
 * y el COALESCE, que son los que evitan que el problema vuelva.
 */
import { esperaMs } from '../lib/scrape/marcha.ts';
import { postJson } from './pedidos.ts';

interface Pendiente {
  id: number;
  codigo: string;
  url: string;
}

interface RespuestaPendientes {
  scrapeId?: number;
  total?: number;
  productos?: Pendiente[];
  error?: string;
}

interface RespuestaFicha {
  codigo?: string;
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

export function prepararDescripciones(): void {
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
    // Nodos y no `innerHTML`: el motivo viene del proveedor, y un texto de afuera nunca entra
    // como HTML.
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
    let rellenados = 0;
    let sinCambio = 0;
    let problemas = 0;

    /**
     * Lo resuelto de cualquier forma, para la barra. Todo cuenta: la barra mide cuánto queda
     * del recorrido, no cuántas descripciones entraron. Si lo que falló no avanzara, la barra
     * no llegaría al final aunque no quedara nada por hacer.
     */
    const mostrar = (total: number): void => {
      const hechos = rellenados + sinCambio + problemas;
      const partes = [`Revisados ${hechos} de ${total}`, `${rellenados} con descripción nueva`];
      if (sinCambio > 0) partes.push(`${sinCambio} que el proveedor sigue sin dar`);
      if (problemas > 0) partes.push(`${problemas} con problema`);
      p.progreso.textContent = partes.join(' · ');

      const pct = total > 0 ? Math.min(100, (hechos / total) * 100) : 0;
      p.relleno.style.inlineSize = `${pct}%`;
      p.barra.setAttribute('aria-valuenow', String(Math.round(pct)));
    };

    try {
      // La lista sale de NUESTRA base, así que no cuesta tráfico del proveedor y no lleva
      // cortesía. Abre la corrida en el mismo pedido.
      const lote = await postJson<RespuestaPendientes>('/api/descripciones/pendientes', {});
      if (lote.error) {
        terminar(lote.error);
        return;
      }

      const productos = lote.productos ?? [];
      if (productos.length === 0) {
        terminar('No queda ningún producto sin descripción.');
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
         * `omitida` es un hermano de color que ya se visitó en esta corrida: su producto es
         * OTRO, así que no dice nada sobre este. Se cuenta como sin cambio y no como problema.
         */
        if (ficha.omitida) {
          sinCambio++;
          mostrar(productos.length);
          continue;
        }

        /**
         * Si la ficha entró bien, la descripción quedó escrita SI el proveedor daba medidas.
         * No se vuelve a consultar la base para verificarlo: sería un pedido más por producto
         * para saber algo que el resumen final cuenta igual. Lo que no se pudo rellenar sigue
         * saliendo en esta misma lista la próxima vez que se corra.
         */
        rellenados++;
        mostrar(productos.length);
      }

      await postJson('/api/scrape/cerrar', { scrapeId, abortado: cancelado });

      const cola = cancelado
        ? 'Cortado. Apretá de nuevo y sigue por donde iba: lo ya rellenado sale solo de la lista.'
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
