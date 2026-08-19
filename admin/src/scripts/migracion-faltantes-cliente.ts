/**
 * El recorrido de los productos del catálogo viejo que el proveedor ya no publica.
 * CÓDIGO DE UN SOLO USO.
 *
 * ES LA SEGUNDA MITAD DE LA MIGRACIÓN, y la que cierra el catálogo viejo. La primera
 * (`migracion-cliente.ts`) trajo los 189 productos que el proveedor todavía publica: de ahí
 * salían las variantes, las fotos y las medidas, y del catálogo viejo el nombre, el precio y
 * la descripción. Los 177 que quedaban no tienen ficha en el proveedor — es exactamente la
 * razón por la que no entraron.
 *
 * ASÍ QUE ACÁ EL CATÁLOGO VIEJO DA TODO, FOTOS INCLUIDAS, y no se le pregunta nada al
 * proveedor. Ni una vez.
 *
 *   API del catálogo viejo  →  el inventario, cruzado contra lo que ya tenemos
 *   API del catálogo viejo  →  nombre, precio, descripción y las URLs de las fotos
 *   CDN del catálogo viejo  →  las fotos, por el puente de `/api/migracion/imagen`
 *
 * Corre en la pestaña por el mismo motivo que la importación (§7.1): el bucle necesita un
 * pedido por segundo durante media hora, y eso no cabe en el presupuesto de CPU de un
 * Worker. Cada paso es un request corto; el que aguanta la espera es el navegador.
 *
 * NO REIMPLEMENTA LAS FOTOS: `traerFotos` es el mismo módulo que usa la importación todos los
 * días, con la verificación de hash incluida. Lo único que cambia es el puente, porque la
 * guarda de origen del de todos los días no acepta el CDN del catálogo viejo — y no se la
 * amplía a propósito.
 *
 * CUANDO ESTO TERMINE, esta pantalla y `lib/migracion/` se borran enteras. No hay nada acá
 * que el catálogo necesite para funcionar.
 */
import {
  AVANCE_INICIAL,
  porcentaje,
  sumar,
  textoDeFaltantes,
  type AvanceFaltantes,
  type Suerte,
} from '../lib/migracion/faltantes.ts';
import { esperaMs } from '../lib/scrape/marcha.ts';
import { traerFotos } from './fotos.ts';
import { postJson } from './pedidos.ts';

/** El puente de fotos de esta migración. Se borra con ella. */
const PUENTE_DEL_VIEJO = '/api/migracion/imagen';

interface ProductoFaltante {
  codigo: string;
  nombre: string;
}

interface RespuestaFaltantes {
  /** Cuántos productos tiene el catálogo viejo en total. */
  total?: number | null;
  /** Cuántos vinieron en esta página, contando los que ya teníamos. */
  revisados?: number;
  yaEstaban?: number;
  descartados?: number;
  productos?: ProductoFaltante[];
  error?: string;
}

interface RespuestaAbrir {
  scrapeId?: number;
  error?: string;
}

interface RespuestaCrear {
  productoId?: number;
  codigo?: string;
  creado?: boolean;
  colores?: Array<{ sku: string; fotos: string[] }>;
  error?: string;
}

interface Pantalla {
  empezar: HTMLButtonElement;
  cancelar: HTMLButtonElement;
  cuantos: HTMLInputElement;
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
    cuantos: buscar<HTMLInputElement>('cuantos'),
    progreso: buscar('progreso'),
    // `barra-relleno`, el mismo id que usan las pantallas del barrido y la importación.
    relleno: buscar('barra-relleno'),
    barra: buscar('barra'),
    problemas: buscar<HTMLDetailsElement>('problemas'),
    listaProblemas: buscar('lista-problemas'),
    resumen: buscar('resumen'),
  };

  return Object.values(partes).every(Boolean) ? (partes as Pantalla) : null;
}

/** Cuántas páginas del inventario se piden como máximo. Red contra un total que no baja. */
const PAGINAS_MAXIMAS = 20;

export function prepararMigracionDeFaltantes(): void {
  const p = pantalla();
  if (!p) return;

  let cancelado = false;
  let ultimoPedido: number | null = null;
  let avance: AvanceFaltantes = { ...AVANCE_INICIAL };

  /**
   * El paso de §7.4, sobre CADA pedido que sale, sin importar a qué origen.
   *
   * Un solo reloj para la API y para el CDN, aunque sean dos hosts y el tráfico de uno no le
   * pese al otro: es imposible de razonar mal, y lo que se gana partiéndolo son minutos en
   * algo que se corre una vez en la vida.
   */
  const cortesia = async (): Promise<void> => {
    const espera = esperaMs(ultimoPedido, Date.now());
    if (espera > 0) await new Promise((listo) => setTimeout(listo, espera));
    ultimoPedido = Date.now();
  };

  const mostrar = (): void => {
    p.progreso.textContent = textoDeFaltantes(avance);
    const pct = porcentaje(avance);
    p.relleno.style.inlineSize = `${pct}%`;
    p.barra.setAttribute('aria-valuenow', String(Math.round(pct)));
  };

  const contar = (suerte: Suerte): void => {
    avance = sumar(avance, suerte);
    mostrar();
  };

  const anotarProblema = (que: string, motivo: string): void => {
    // `appendChild` y nodos, no `append` ni `innerHTML`: es lo que usa el resto del panel, y
    // el motivo viene de afuera — un texto ajeno nunca entra como HTML.
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

  /**
   * El inventario completo, página por página y con su cortesía.
   *
   * UNA PÁGINA POR PEDIDO y no las cuatro en el Worker: la cortesía se marca acá, sobre cada
   * request que sale. Si el servidor hiciera las cuatro adentro, el paso de un pedido por
   * segundo se lo saltearía sin que nadie lo hubiera decidido.
   *
   * El corte por `PAGINAS_MAXIMAS` es una red y no una regla: si el origen devolviera un
   * `total` que no se alcanza nunca, el bucle no queda girando para siempre.
   */
  const inventario = async (): Promise<{ productos: ProductoFaltante[]; yaEstaban: number } | string> => {
    const productos: ProductoFaltante[] = [];
    let yaEstaban = 0;
    let revisados = 0;
    let total: number | null = null;

    for (let pagina = 0; pagina < PAGINAS_MAXIMAS; pagina++) {
      await cortesia();
      const tanda = await postJson<RespuestaFaltantes>('/api/migracion/faltantes', {
        skip: revisados,
      });

      if (tanda.error) return tanda.error;
      if (!Array.isArray(tanda.productos) || typeof tanda.revisados !== 'number') {
        return 'El catálogo viejo no devolvió un inventario que se pueda leer.';
      }

      productos.push(...tanda.productos);
      yaEstaban += tanda.yaEstaban ?? 0;
      revisados += tanda.revisados;
      if (typeof tanda.total === 'number') total = tanda.total;

      p.progreso.textContent = `Leyendo el catálogo viejo: ${revisados}${
        total === null ? '' : ` de ${total}`
      } productos.`;

      // Una página que vino corta es la última: no hay más productos que pedir.
      if (tanda.revisados === 0 || (total !== null && revisados >= total)) break;
    }

    return { productos, yaEstaban };
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
    avance = { ...AVANCE_INICIAL };
    cancelado = false;

    let scrapeId: number | null = null;

    try {
      // 1. El inventario, ya cruzado contra lo que tenemos: sólo lo que falta.
      const leido = await inventario();
      if (typeof leido === 'string') {
        terminar(leido);
        return;
      }

      if (leido.productos.length === 0) {
        terminar(
          `No falta ninguno: los ${leido.yaEstaban} productos del catálogo viejo ya están en el catálogo.`
        );
        return;
      }

      /**
       * El límite de la primera corrida. `Number.isInteger` sobre el valor crudo y no
       * `Number(...)` a secas: un campo vacío da `''`, y `Number('')` es 0 — la misma trampa
       * que rompió la selección del barrido. Con un valor que no sirve se recorre todo, que
       * es lo que el campo dice por defecto.
       */
      const pedido = Number(p.cuantos.value);
      const limite = Number.isInteger(pedido) && pedido > 0 ? pedido : leido.productos.length;
      const productos = leido.productos.slice(0, limite);

      avance = { ...AVANCE_INICIAL, total: productos.length };
      mostrar();

      // 2. La corrida, con su guarda de recorrido único.
      const abierta = await postJson<RespuestaAbrir>('/api/migracion/abrir', {
        total: productos.length,
        faltantes: true,
      });
      if (abierta.error || typeof abierta.scrapeId !== 'number') {
        terminar(abierta.error ?? 'No se pudo abrir la corrida.');
        return;
      }
      scrapeId = abierta.scrapeId;

      for (const producto of productos) {
        if (cancelado) break;

        // 3. El producto: nombre, precio, descripción y las URLs de sus fotos. El servidor
        //    los pide a la API; acá sólo viaja el código.
        await cortesia();
        const creado = await postJson<RespuestaCrear>('/api/migracion/crear', {
          scrapeId,
          codigo: producto.codigo,
        });

        if (creado.error) {
          // Fallo tolerante (§7.4): ya quedó en `scrape_errores` y la corrida sigue.
          anotarProblema(producto.nombre || producto.codigo, creado.error);
          contar('problema');
          continue;
        }

        if (typeof creado.productoId !== 'number') {
          anotarProblema(producto.nombre || producto.codigo, 'El servidor no devolvió el id del producto.');
          contar('problema');
          continue;
        }

        /**
         * 4. Las fotos, con la verificación de hash compartida con la importación. Sobre un
         *    producto que ya estaba, `colores` viene vacío y esto no hace ni un pedido: es lo
         *    que hace barato repetir la corrida.
         */
        await traerFotos(creado, cortesia, anotarProblema, PUENTE_DEL_VIEJO);

        contar(creado.creado ? 'creado' : 'yaEstaba');
      }

      await postJson('/api/scrape/cerrar', { scrapeId, abortado: cancelado });

      terminar(
        cancelado
          ? `Cortado. ${textoDeFaltantes(avance)}. Lo que entró queda: apretá de nuevo y sigue por donde iba.`
          : `Listo. ${textoDeFaltantes(avance)}. Quedan en «Por aprobar»: nada se publicó.`
      );
    } catch (error) {
      /**
       * Se intenta cerrar la corrida aunque el bucle explote. Una corrida abierta bloquea la
       * próxima por la guarda de `abrir`, y el 409 diría «ya hay un recorrido en curso» sobre
       * uno que murió hace media hora.
       */
      if (scrapeId !== null) {
        await postJson('/api/scrape/cerrar', { scrapeId, abortado: true }).catch(() => {});
      }
      terminar(error instanceof Error ? error.message : String(error));
    }
  });
}
