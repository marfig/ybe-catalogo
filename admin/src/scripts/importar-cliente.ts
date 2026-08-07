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
  contarFicha,
  esperaMs,
  paginasPendientes,
  sinVisitar,
  textoDeMarcha,
  type Marcha,
} from '../lib/scrape/marcha.ts';
import { subirFotoDelOrigen } from './recorte.ts';

interface RespuestaListado {
  scrapeId?: number;
  fichas?: string[];
  paginas?: string[];
  totalPaginas?: number;
  robotsAusente?: boolean;
  error?: string;
}

interface RespuestaFicha {
  codigo?: string;
  creado?: boolean;
  omitida?: boolean;
  avisoDeCambio?: boolean;
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

/**
 * POST con JSON y una sola forma de fallar.
 *
 * Una respuesta que no es JSON no es un caso raro en una corrida larga: es la sesión de
 * Access vencida, que devuelve un redirect a la pantalla de login. Sin este `catch`, el
 * bucle moriría con «Unexpected token <» y nadie entendería por qué.
 */
async function postJson<T extends { error?: string }>(ruta: string, cuerpo: unknown): Promise<T> {
  const respuesta = await fetch(ruta, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });

  try {
    return (await respuesta.json()) as T;
  } catch {
    return {
      error:
        `El servidor respondió ${respuesta.status} y no era una respuesta esperada. ` +
        'Puede que la sesión haya vencido: recargá la página.',
    } as T;
  }
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
  };
}

export function prepararImportacion(): void {
  const p = buscarPantalla();
  if (!p) return;

  p.formulario.addEventListener('submit', (evento) => {
    evento.preventDefault();
    const url = p.url.value.trim();
    if (url === '') return;
    void correr(p, url);
  });
}

/**
 * El recorrido completo: páginas, fichas y fotos, de a un pedido por segundo.
 *
 * Nunca lanza. Un scrape que se corta con una excepción deja la corrida abierta en la
 * base y la próxima importación choca contra ella sin explicación.
 */
async function correr(p: Pantalla, urlInicial: string): Promise<void> {
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
      marcha = { ...marcha, totalPaginas: listado.totalPaginas ?? marcha.totalPaginas };

      for (const nueva of paginasPendientes(listado.paginas ?? [], paginasVistas)) {
        paginasVistas.add(clavePagina(nueva));
        cola.push(nueva);
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

/**
 * Las fotos de una ficha, una por una (§8.1).
 *
 * El Worker baja la imagen y hashea los BYTES ORIGINALES. Si ya la conoce, responde
 * JSON y la foto no viaja. Si es nueva, responde los bytes crudos: el canvas deriva
 * w300/w600, los sube y recién ahí se vincula a la variante.
 *
 * Una foto que falla no tumba la ficha: el producto ya está en la base, y un producto
 * sin foto se completa a mano desde la grilla.
 */
async function traerFotos(
  ficha: RespuestaFicha,
  cortesia: () => Promise<void>,
  anotarProblema: (que: string, motivo: string) => void
): Promise<void> {
  /**
   * TODOS los colores del modelo, no sólo el de la ficha visitada. Las fichas de los
   * hermanos nunca se piden —las saltea el corte por código de §7.4— así que si sus
   * fotos no se suben en esta pasada, esas variantes se quedan sin imagen para siempre.
   */
  for (const { sku, fotos } of ficha.colores ?? []) {
    for (const url of fotos) {
      await unaFoto({ sku, url, codigo: ficha.codigo, cortesia, anotarProblema });
    }
  }
}

/** Una foto: puente, canvas, subida y vínculo. Nunca lanza. */
async function unaFoto({
  sku,
  url,
  codigo,
  cortesia,
  anotarProblema,
}: {
  sku: string;
  url: string;
  codigo: string | undefined;
  cortesia: () => Promise<void>;
  anotarProblema: (que: string, motivo: string) => void;
}): Promise<void> {
  // El SKU va en el aviso: en un modelo de tres colores, «falló una foto de CG85700» no
  // alcanza para saber cuál variante quedó sin imagen.
  const quien = `Foto de ${codigo ?? sku} (${sku})`;

  try {
    await cortesia();
    const respuesta = await fetch('/api/scrape/imagen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku, url }),
    });

    const tipo = respuesta.headers.get('Content-Type') ?? '';

    if (!tipo.startsWith('image/')) {
      // JSON: o ya estaba y quedó vinculada, o algo falló. Los bytes no viajaron.
      const cuerpo = (await respuesta.json().catch(() => ({}))) as { error?: string };
      if (cuerpo.error) anotarProblema(quien, cuerpo.error);
      return;
    }

    const delWorker = respuesta.headers.get('X-Hash16');
    const bytes = await respuesta.blob();
    const archivo = new File([bytes], `${delWorker ?? 'origen'}.jpg`, { type: bytes.type });

    const subida = await subirFotoDelOrigen(archivo);

    /**
     * EL HASH TIENE QUE COINCIDIR. El Worker lo calculó sobre los mismos bytes y con el
     * mismo algoritmo, así que si difiere es que el cuerpo llegó cortado. Sin este corte
     * la foto se guardaría bajo una clave que el Worker nunca vio: el dedupe se rompe y
     * R2 junta duplicados, en silencio y para siempre.
     */
    if (delWorker && subida.hash16 !== delWorker) {
      anotarProblema(
        quien,
        'La imagen llegó incompleta y no se guardó. Volvé a importar este producto.'
      );
      return;
    }

    const vinculo = await postJson<{ error?: string }>('/api/scrape/vincular', {
      sku,
      hash16: subida.hash16,
    });
    if (vinculo.error) anotarProblema(quien, vinculo.error);
  } catch (error) {
    anotarProblema(quien, error instanceof Error ? error.message : String(error));
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
