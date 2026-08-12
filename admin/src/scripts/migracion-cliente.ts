/**
 * El recorrido de la migración del catálogo viejo. CÓDIGO DE UN SOLO USO.
 *
 * Corre en la pestaña por el mismo motivo que la importación (§7.1): el bucle necesita un
 * pedido por segundo durante media hora, y eso no cabe en el presupuesto de CPU de un
 * Worker. Cada paso es un request corto; el que aguanta la espera es el navegador.
 *
 * DE DÓNDE SALE CADA DATO, que es toda la idea de la migración. Los dos orígenes son
 * complementarios: el proveedor publica los colores como fichas hermanas con su foto —o
 * sea variantes de verdad— pero no publica nombre ni precio ni descripción (SPEC §2.3).
 * El catálogo viejo publica exactamente esos tres y lista los colores como prosa.
 *
 *   sitemap del viejo   →  los 368 códigos
 *   buscador del proveedor →  ¿sigue vivo? y la URL de su ficha
 *   ficha del proveedor →  variantes, colores, fotos, medidas
 *   ficha del viejo     →  nombre, precio, descripción
 *
 * NO REIMPLEMENTA NADA: los pasos de ficha y fotos son los endpoints que la importación
 * usa todos los días, y `traerFotos` es el mismo módulo. Lo único nuevo es el orden.
 *
 * CUANDO LA MIGRACIÓN TERMINE, esta pantalla y `lib/migracion/` se borran enteras. No
 * hay nada acá que el catálogo necesite para funcionar.
 */
import { esperaMs } from '../lib/scrape/marcha.ts';
import {
  AVANCE_INICIAL,
  porcentaje,
  textoDeMigracion,
  sumar,
  type AvanceMigracion,
  type Suerte,
} from '../lib/migracion/marcha.ts';
import { traerFotos } from './fotos.ts';
import { postJson } from './pedidos.ts';

interface ProductoViejo {
  codigo: string;
  url: string;
}

interface RespuestaInventario {
  productos?: ProductoViejo[];
  error?: string;
}

interface RespuestaAbrir {
  scrapeId?: number;
  error?: string;
}

interface RespuestaPresencia {
  presencia?: 'presente' | 'ausente' | 'indeterminado';
  motivo?: string;
  /** La ficha del proveedor que lo prueba vivo. Es el puente al importador. */
  url?: string | null;
  error?: string;
}

interface RespuestaFicha {
  productoId?: number;
  codigo?: string;
  creado?: boolean;
  omitida?: boolean;
  colores?: Array<{ sku: string; fotos: string[] }>;
  error?: string;
}

interface RespuestaCurar {
  curado?: boolean;
  nombre?: string;
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
    // `barra-relleno`, el mismo id que usa la pantalla del barrido.
    relleno: buscar('barra-relleno'),
    barra: buscar('barra'),
    problemas: buscar<HTMLDetailsElement>('problemas'),
    listaProblemas: buscar('lista-problemas'),
    resumen: buscar('resumen'),
  };

  return Object.values(partes).every(Boolean) ? (partes as Pantalla) : null;
}

export function prepararMigracion(): void {
  const p = pantalla();
  if (!p) return;

  let cancelado = false;
  let ultimoPedido: number | null = null;
  let avance: AvanceMigracion = { ...AVANCE_INICIAL };

  /**
   * El paso de §7.4, sobre CADA pedido que sale, sin importar a qué origen.
   *
   * Se podría llevar un reloj por origen —el proveedor y el catálogo viejo son dos hosts
   * distintos y el tráfico de uno no le pesa al otro— y la corrida terminaría antes. No
   * se hace: un solo reloj es imposible de razonar mal, y lo que se gana son minutos en
   * algo que se corre una vez en la vida.
   */
  const cortesia = async (): Promise<void> => {
    const espera = esperaMs(ultimoPedido, Date.now());
    if (espera > 0) await new Promise((listo) => setTimeout(listo, espera));
    ultimoPedido = Date.now();
  };

  const mostrar = (): void => {
    p.progreso.textContent = textoDeMigracion(avance);
    const pct = porcentaje(avance);
    p.relleno.style.inlineSize = `${pct}%`;
    p.barra.setAttribute('aria-valuenow', String(Math.round(pct)));
  };

  const contar = (suerte: Suerte): void => {
    avance = sumar(avance, suerte);
    mostrar();
  };

  const anotarProblema = (que: string, motivo: string): void => {
    // `appendChild` y nodos, no `append` ni `innerHTML`: es lo que usa el resto del panel,
    // y el motivo viene del proveedor — un texto de afuera nunca entra como HTML.
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
    avance = { ...AVANCE_INICIAL };
    cancelado = false;

    let scrapeId: number | null = null;

    try {
      // 1. El inventario del catálogo viejo. Un pedido, y sale por el Worker porque
      //    `catalogst.com` no manda cabeceras CORS.
      await cortesia();
      const inventario = await postJson<RespuestaInventario>('/api/migracion/inventario', {});
      if (inventario.error || !inventario.productos?.length) {
        terminar(inventario.error ?? 'El catálogo viejo no devolvió productos.');
        return;
      }

      /**
       * El límite de la primera corrida. `Number.isInteger` sobre el valor crudo y no
       * `Number(...)` a secas: un campo vacío da `''`, y `Number('')` es 0 — la misma
       * trampa que rompió la selección del barrido. Con un valor que no sirve se recorre
       * todo, que es lo que el campo dice por defecto.
       */
      const pedido = Number(p.cuantos.value);
      const limite = Number.isInteger(pedido) && pedido > 0 ? pedido : inventario.productos.length;
      const productos = inventario.productos.slice(0, limite);

      avance = { ...AVANCE_INICIAL, total: productos.length };
      mostrar();

      // 2. La corrida, con su guarda de recorrido único.
      const abierta = await postJson<RespuestaAbrir>('/api/migracion/abrir', {
        total: productos.length,
      });
      if (abierta.error || typeof abierta.scrapeId !== 'number') {
        terminar(abierta.error ?? 'No se pudo abrir la corrida.');
        return;
      }
      scrapeId = abierta.scrapeId;

      for (const producto of productos) {
        if (cancelado) break;

        // 3. ¿El proveedor todavía lo publica? Sin ficha del proveedor no hay colores ni
        //    fotos, así que un ausente no se importa: se cuenta y se sigue.
        await cortesia();
        const pres = await postJson<RespuestaPresencia>('/api/migracion/presencia', {
          codigo: producto.codigo,
        });

        if (pres.error) {
          anotarProblema(producto.codigo, pres.error);
          contar('problema');
          continue;
        }
        if (pres.presencia === 'ausente') {
          contar('ausente');
          continue;
        }
        if (pres.presencia !== 'presente' || !pres.url) {
          // `indeterminado` NO es una baja: en otra corrida se vuelve a preguntar.
          contar('indeterminado');
          continue;
        }

        // 4. La ficha del proveedor: producto, variantes y colores. El endpoint de todos
        //    los días, sin un solo cambio.
        await cortesia();
        const ficha = await postJson<RespuestaFicha>('/api/scrape/ficha', {
          scrapeId,
          url: pres.url,
        });

        if (ficha.error) {
          // Fallo tolerante (§7.4): ya quedó en `scrape_errores` y la corrida sigue.
          anotarProblema(producto.codigo, ficha.error);
          contar('problema');
          continue;
        }

        // 5. Las fotos, con la verificación de hash compartida con la importación.
        await traerFotos(ficha, cortesia, anotarProblema);

        if (typeof ficha.productoId !== 'number') {
          anotarProblema(producto.codigo, 'El servidor no devolvió el id del producto.');
          contar('problema');
          continue;
        }

        // 6. Nombre, precio y descripción del catálogo viejo. La guarda de
        //    `aplicarCuraduria` es la que decide si escribe.
        await cortesia();
        const curado = await postJson<RespuestaCurar>('/api/migracion/curar', {
          id: ficha.productoId,
          urlVieja: producto.url,
        });

        if (curado.error) {
          anotarProblema(producto.codigo, curado.error);
          contar('problema');
          continue;
        }

        /**
         * `curado: false` sin error es un producto que ya tenía nombre: o lo escribió una
         * persona, o una corrida anterior lo curó. No es un fallo, es la guarda haciendo
         * su trabajo — y es lo que hace esta pantalla reanudable.
         */
        contar(curado.curado ? 'migrado' : 'yaEstaba');
      }

      await postJson('/api/scrape/cerrar', { scrapeId, abortado: cancelado });

      terminar(
        cancelado
          ? `Cortado. ${textoDeMigracion(avance)}. Lo que entró queda: apretá de nuevo y sigue por donde iba.`
          : `Listo. ${textoDeMigracion(avance)}. Los importados quedan en «Por aprobar»: nada se publicó.`
      );
    } catch (error) {
      /**
       * Se intenta cerrar la corrida aunque el bucle explote. Una corrida abierta bloquea
       * la próxima por la guarda de `abrir`, y el 409 diría «ya hay un recorrido en curso»
       * sobre uno que murió hace media hora.
       */
      if (scrapeId !== null) {
        await postJson('/api/scrape/cerrar', { scrapeId, abortado: true }).catch(() => {});
      }
      terminar(error instanceof Error ? error.message : String(error));
    }
  });
}
