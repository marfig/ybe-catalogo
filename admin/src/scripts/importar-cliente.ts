/**
 * El bucle de importación, que vive en la pestaña (SPEC-etapa2 §7.1, §8.1, §10.2).
 *
 * POR QUÉ ACÁ Y NO EN EL SERVIDOR: el progreso tiene que verse. Para quien opera, un
 * scrape sin progreso visible es indistinguible de uno colgado. Además el navegador es
 * el único lugar del sistema con un motor de imágenes —`sharp` no corre en Workers— y
 * el paso de 1 request por segundo lo marca quien hace los pedidos.
 *
 * ESTE ARCHIVO NO DECIDE NADA. Qué página falta, qué ficha saltear, cuánto esperar y
 * qué dice el renglón de progreso viven en `lib/scrape/marcha.ts`, que es puro y tiene
 * tests. Acá está lo que no se puede probar sin un navegador: `fetch`, el DOM y el
 * `<canvas>`. Es la misma división que sostiene `extractor.ts` frente a `ficha.ts`.
 *
 * OJO CON `appendChild`: `worker-configuration.d.ts` declara el `Element` de
 * HTMLRewriter y tapa al del DOM en todo el proyecto. Con `append`, TypeScript espera
 * un `Response` y el archivo no compila.
 */
import {
  MARCHA_INICIAL,
  avance,
  clavePagina,
  codigosDe,
  conListado,
  contarFicha,
  esperaMs,
  paginasPendientes,
  sinVisitar,
  textoDeMarcha,
  type Marcha,
} from '../lib/scrape/marcha.ts';
// Compartidos con el recorrido de la migracion (`migracion-cliente.ts`). La verificacion
// de hash de las fotos no puede vivir en dos lugares: ver `fotos.ts`.
import { avisoDeColoresSinNombre } from '../lib/scrape/aviso-colores.ts';
import { traerFotos } from './fotos.ts';
import { postJson } from './pedidos.ts';

interface RespuestaListado {
  scrapeId?: number;
  fichas?: string[];
  paginas?: string[];
  totalPaginas?: number;
  /** Cuantos productos declara la categoria. Ausente en un lanzamiento. */
  totalProductos?: number | null;
  robotsAusente?: boolean;
  /** Codigos de esta pagina que ya estan en el catalogo. */
  yaTengo?: string[];
  error?: string;
}

interface RespuestaFicha {
  codigo?: string;
  creado?: boolean;
  omitida?: boolean;
  avisoDeCambio?: boolean;
  /** Colores que el proveedor sirvió sin un nombre del que salga un SKU. */
  coloresSinNombre?: number;
  /** Un item por color del modelo, con el SKU de su variante. */
  colores?: Array<{ sku: string; fotos: string[] }>;
  hermanos?: string[];
  error?: string;
}

interface Resumen {
  hallados?: number;
  nuevos?: number;
  repetidos?: number;
  errores?: number;
  paginas?: number;
  error?: string;
}


/** Los elementos de la pantalla, buscados una sola vez. */
interface Pantalla {
  formulario: HTMLFormElement;
  url: HTMLInputElement;
  marcha: HTMLElement;
  progreso: HTMLElement;
  barra: HTMLElement;
  relleno: HTMLElement;
  cancelar: HTMLButtonElement;
  problemas: HTMLDetailsElement;
  listaProblemas: HTMLElement;
  resumen: HTMLElement;
  /**
   * La casilla de «saltear los que ya tengo». OPCIONAL: si la pantalla no la tuviera,
   * el bucle sigue andando con el default. Un `null` acá no puede tumbar la
   * importacion entera por una comodidad.
   */
  saltear: HTMLInputElement | null;
}

function buscarPantalla(): Pantalla | null {
  const de = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

  const formulario = de<HTMLFormElement>('importar');
  const url = de<HTMLInputElement>('url');
  const marcha = de('marcha');
  const progreso = de('progreso');
  const barra = de('barra');
  const relleno = de('barra-relleno');
  const cancelar = de<HTMLButtonElement>('cancelar');
  const problemas = de<HTMLDetailsElement>('problemas');
  const listaProblemas = de('lista-problemas');
  const resumen = de('resumen');
  const saltear = de<HTMLInputElement>('saltear');

  if (
    !formulario ||
    !url ||
    !marcha ||
    !progreso ||
    !barra ||
    !relleno ||
    !cancelar ||
    !problemas ||
    !listaProblemas ||
    !resumen
  ) {
    return null;
  }

  return {
    formulario,
    url,
    marcha,
    progreso,
    barra,
    relleno,
    cancelar,
    problemas,
    listaProblemas,
    resumen,
    saltear,
  };
}

export function prepararImportacion(): void {
  const p = buscarPantalla();
  if (!p) return;

  p.formulario.addEventListener('submit', (evento) => {
    evento.preventDefault();
    const url = p.url.value.trim();
    if (url === '') return;
    void correr(p, url, { saltearConocidos: p.saltear?.checked ?? true });
  });
}

/**
 * El recorrido completo: páginas, fichas y fotos, de a un pedido por segundo.
 *
 * Nunca lanza. Un scrape que se corta con una excepción deja la corrida abierta en la
 * base y la próxima importación choca contra ella sin explicación.
 */
async function correr(
  p: Pantalla,
  urlInicial: string,
  { saltearConocidos }: { saltearConocidos: boolean }
): Promise<void> {
  /** Claves de las páginas ya encoladas o visitadas. */
  const paginasVistas = new Set<string>([clavePagina(urlInicial)]);
  /** Códigos que ya no hay que pedirle al proveedor: propios y de hermanos. */
  const codigos = new Set<string>();
  const cola = [urlInicial];

  let marcha: Marcha = { ...MARCHA_INICIAL };
  let scrapeId: number | null = null;
  let cancelado = false;
  let ultimoPedido: number | null = null;

  /** El paso de §7.4. Cuenta CADA pedido que sale al proveedor, fotos incluidas. */
  const cortesia = async (): Promise<void> => {
    const espera = esperaMs(ultimoPedido, Date.now());
    if (espera > 0) await new Promise((listo) => setTimeout(listo, espera));
    ultimoPedido = Date.now();
  };

  const mostrar = (fichasDePagina: number, fichasHechas: number): void => {
    p.progreso.textContent = textoDeMarcha(marcha);
    const porcentaje = avance({
      paginasHechas: marcha.paginasHechas,
      totalPaginas: marcha.totalPaginas,
      fichasDePagina,
      fichasHechas,
    });
    p.relleno.style.inlineSize = `${porcentaje}%`;
    p.barra.setAttribute('aria-valuenow', String(Math.round(porcentaje)));
  };

  const anotarProblema = (que: string, motivo: string): void => {
    const fila = document.createElement('li');
    const titulo = document.createElement('strong');
    titulo.textContent = que;
    fila.appendChild(titulo);
    fila.appendChild(document.createTextNode(` — ${motivo}`));
    p.listaProblemas.appendChild(fila);
    p.problemas.hidden = false;
  };

  /**
   * El aviso de §10.2 no alcanza: quien cierra la pestaña ya decidió. Esto le da la
   * chance de arrepentirse mientras el recorrido está a mitad de camino.
   */
  const alSalir = (evento: BeforeUnloadEvent): void => evento.preventDefault();
  window.addEventListener('beforeunload', alSalir);

  const alCancelar = (): void => {
    cancelado = true;
    p.cancelar.disabled = true;
    p.cancelar.textContent = 'Cancelando…';
  };
  p.cancelar.addEventListener('click', alCancelar);

  p.formulario.querySelectorAll('input, button').forEach((c) => {
    (c as HTMLInputElement | HTMLButtonElement).disabled = true;
  });
  p.marcha.hidden = false;
  p.resumen.hidden = true;
  p.cancelar.disabled = false;
  p.cancelar.textContent = 'Cancelar';
  mostrar(0, 0);

  try {
    while (cola.length > 0 && !cancelado) {
      const pagina = cola.shift()!;

      await cortesia();

      /**
       * LA ANOTACIÓN DE `listado` NO ES DECORATIVA, SIN ELLA NO COMPILA. `scrapeId`
       * entra en el cuerpo del pedido y sale del resultado, así que para estrechar su
       * tipo dentro del bucle TypeScript necesita el tipo de `listado`, que a su vez
       * depende de `scrapeId`. Anotar corta el círculo; sin anotar, ts(7022).
       */
      const listado: RespuestaListado = await postJson<RespuestaListado>(
        '/api/scrape/listado',
        { url: pagina, scrapeId }
      );

      /**
       * Un listado que falla CORTA la corrida, al revés que una ficha. Sin la lista de
       * fichas no hay nada que recorrer, y seguir con las páginas siguientes daría una
       * importación con agujeros que nadie pidió.
       */
      if (listado.error || typeof listado.scrapeId !== 'number') {
        terminar(p, listado.error ?? 'El servidor no devolvió la corrida.');
        return;
      }

      scrapeId = listado.scrapeId;
      /**
       * EL DENOMINADOR NO SE PISA CON LO QUE DIJO ESTA PAGINA. En una categoria la
       * paginacion es una ventana deslizante —la pagina 1 enlaza hasta la 6 de 36—, asi
       * que decidirlo por respuesta haria un progreso que miente todo el camino. La
       * cuenta vive en `conListado`, que es puro y tiene tests.
       */
      marcha = conListado(marcha, {
        totalPaginas: listado.totalPaginas,
        totalProductos: listado.totalProductos,
        // Las fichas CRUDAS, antes de saltear: es el tamano de pagina del proveedor.
        fichasEnPagina: (listado.fichas ?? []).length,
      });

      for (const nueva of paginasPendientes(listado.paginas ?? [], paginasVistas)) {
        paginasVistas.add(clavePagina(nueva));
        cola.push(nueva);
      }

      /**
       * SEMBRAR LOS QUE YA TENGO. `sinVisitar` filtra por codigo, asi que meterlos en
       * el mismo Set que usa el corte por hermanos alcanza: no hay una segunda rama
       * que mantener, y un producto ya conocido deja de pedirse por el mismo camino
       * por el que deja de pedirse un color hermano.
       *
       * Se cuentan ANTES de filtrar, porque despues ya no estan.
       */
      if (saltearConocidos) {
        const nuevos = (listado.yaTengo ?? []).filter((c) => !codigos.has(c));
        for (const c of nuevos) codigos.add(c);
        marcha = { ...marcha, salteados: marcha.salteados + nuevos.length };
      }

      const fichas = sinVisitar(listado.fichas ?? [], codigos);
      let hechas = 0;
      mostrar(fichas.length, hechas);

      for (const ficha of fichas) {
        if (cancelado) break;

        /**
         * Se vuelve a preguntar por cada ficha: un hermano descubierto hace tres fichas
         * puede estar más abajo en ESTA misma página, y `sinVisitar` se calculó antes de
         * saberlo. Saltearlo acá es un pedido menos al proveedor.
         */
        if (sinVisitar([ficha], codigos).length === 0) {
          hechas += 1;
          mostrar(fichas.length, hechas);
          continue;
        }

        await cortesia();
        const resultado = await postJson<RespuestaFicha>('/api/scrape/ficha', {
          scrapeId,
          url: ficha,
        });

        marcha = contarFicha(marcha, resultado);

        if (resultado.error) {
          // Fallo tolerante (§7.4): ya quedó en `scrape_errores` y la corrida sigue.
          anotarProblema(ficha, resultado.error);
        } else {
          /**
           * Los hermanos se marcan ANTES de las fotos: si la subida falla y corta, los
           * modelos que esta ficha ya reveló igual quedan cubiertos y no se vuelven a
           * pedir.
           */
          if (resultado.codigo) codigos.add(resultado.codigo);
          for (const codigo of codigosDe(resultado.hermanos ?? [])) codigos.add(codigo);

          /**
           * El aviso de que el proveedor sirvió un color del que no sale un SKU. Se avisa
           * aunque la ficha haya entrado bien: lo que queda es un producto sin esa variante
           * y sin sus fotos, y hasta hoy eso pasaba callado. Ver `aviso-colores.ts`.
           */
          const aviso = avisoDeColoresSinNombre(resultado.coloresSinNombre);
          if (aviso) anotarProblema(resultado.codigo ?? ficha, aviso);

          await traerFotos(resultado, cortesia, anotarProblema);
        }

        hechas += 1;
        mostrar(fichas.length, hechas);
      }

      marcha = { ...marcha, paginasHechas: marcha.paginasHechas + 1 };
      mostrar(fichas.length, hechas);
    }

    await cerrar(p, scrapeId, cancelado);
  } catch (error) {
    /**
     * Cualquier cosa que se haya escapado: se cierra igual. Una corrida que queda
     * `corriendo` bloquea la próxima importación durante 30 minutos (§7.5).
     */
    await cerrar(p, scrapeId, true);
    terminar(p, error instanceof Error ? error.message : String(error));
  } finally {
    window.removeEventListener('beforeunload', alSalir);
    p.cancelar.removeEventListener('click', alCancelar);
    p.cancelar.hidden = true;
  }
}

/** Cierra la corrida y muestra el resumen de §10.2. */
async function cerrar(p: Pantalla, scrapeId: number | null, abortado: boolean): Promise<void> {
  if (scrapeId === null) return;

  const resumen = await postJson<Resumen>('/api/scrape/cerrar', { scrapeId, abortado });
  if (resumen.error) {
    terminar(p, resumen.error);
    return;
  }

  /**
   * Los números del resumen salen de la BASE, no del contador de la pantalla. Si los
   * dos no coinciden, el que manda es el que quedó guardado — y el otro está mintiendo.
   */
  const partes = [
    `${resumen.nuevos ?? 0} productos nuevos`,
    `${resumen.repetidos ?? 0} que ya estaban`,
  ];
  if ((resumen.errores ?? 0) > 0) partes.push(`${resumen.errores} con error`);

  p.resumen.className = abortado ? 'resumen resumen--error' : 'resumen';
  p.resumen.textContent = abortado
    ? `Importación cancelada. Lo que entró quedó guardado: ${partes.join(', ')}.`
    : `Listo: ${partes.join(', ')}.`;

  const ir = document.createElement('a');
  ir.href = '/productos?estado=por-aprobar';
  ir.textContent = 'Ver los productos por aprobar';
  p.resumen.appendChild(document.createTextNode(' '));
  p.resumen.appendChild(ir);
  p.resumen.hidden = false;

  p.marcha.hidden = true;
}

/** Un final que no es el esperado. El mensaje del servidor ya viene en castellano. */
function terminar(p: Pantalla, motivo: string): void {
  p.resumen.className = 'resumen resumen--error';
  p.resumen.textContent = motivo;
  p.resumen.hidden = false;
  p.marcha.hidden = true;
  p.formulario.querySelectorAll('input, button').forEach((c) => {
    (c as HTMLInputElement | HTMLButtonElement).disabled = false;
  });
}

