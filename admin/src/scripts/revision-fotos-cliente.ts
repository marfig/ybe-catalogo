/**
 * La revisión de galerías: volver a mirarle al proveedor las fotos de cada ficha.
 *
 * QUÉ ARREGLA. El proveedor sirve la galería en DOS rutas y el filtro de `verImagen` sólo
 * reconocía una (ver `RUTAS_IMAGENES`), así que todo lo importado hasta el arreglo quedó con
 * la foto principal y sin las adicionales. Arreglado el filtro, nada vuelve a mirar lo que
 * ya está en la base: la importación viene con «saltear los que ya tengo» tildada.
 *
 * DOS MODOS, Y EL MISMO RECORRIDO PARA LOS DOS:
 *
 *   - **prueba**: un puñado de códigos escritos a mano. Para ver el resultado sobre los
 *     cuatro donde el problema se midió antes de largar la corrida larga.
 *   - **pasada**: el catálogo entero, retomable por marcador.
 *
 * Es el MISMO bucle a propósito: si la prueba corriera por otro camino, probaría otra cosa.
 *
 * ES CÓDIGO DE UN SOLO USO. Ver `revision-fotos.ts`.
 *
 * Corre en la pestaña por el motivo de siempre (§7.1): un pedido por segundo durante una
 * hora no cabe en el presupuesto de CPU de un Worker.
 */
import { avisoDeColoresSinNombre } from '../lib/scrape/aviso-colores.ts';
import { esperaMs } from '../lib/scrape/marcha.ts';
import { partirCodigos, type ParaRevisar } from '../lib/scrape/revision-fotos.ts';
import { traerFotos, type FichaConFotos } from './fotos.ts';
import { postJson } from './pedidos.ts';

/**
 * Dónde quedó la pasada, para poder retomarla.
 *
 * POR QUÉ ESTA PASADA NECESITA UN MARCADOR Y LAS OTRAS DOS NO. Las otras se vacían solas:
 * un producto al que se le llenó la descripción deja de cumplir `trim(descripcion) = ''`, y
 * uno al que se le consiguió una foto deja de cumplir `NOT EXISTS(imagen)`. Ésta no cambia
 * nada que su consulta pueda ver, así que al volver a entrar la lista está entera y una
 * corrida cortada a los 40 minutos volvería a empezar del principio.
 *
 * EN `localStorage` Y NO EN UNA COLUMNA. El recorrido vive en la pestaña, así que su
 * progreso es estado de la pestaña. Una columna sería esquema permanente para un trabajo de
 * una sola vez — y esto se borra entero cuando la pasada termine.
 *
 * LA PRUEBA NO LO TOCA: revisar cuatro códigos a mano no es progreso de la pasada.
 */
const MARCADOR = 'ybe:revision-fotos:ultimo';

/**
 * `localStorage` LANZA en algunos contextos —ventana privada, cookies de terceros
 * bloqueadas— y perder el marcador sólo cuesta repetir trabajo idempotente. Que eso tumbe
 * la pasada sería mucho peor, así que las tres funciones fallan en silencio.
 */
function leerMarcador(): string {
  try {
    return localStorage.getItem(MARCADOR) ?? '';
  } catch {
    return '';
  }
}

function guardarMarcador(codigo: string): void {
  try {
    localStorage.setItem(MARCADOR, codigo);
  } catch {
    /* sin marcador se repite trabajo, no se pierde nada */
  }
}

function borrarMarcador(): void {
  try {
    localStorage.removeItem(MARCADOR);
  } catch {
    /* idem */
  }
}

interface RespuestaLista {
  scrapeId?: number;
  /** Cuántas trae ESTA tajada. */
  total?: number;
  /** Cuántas quedan en total, tajada incluida. Es el tamaño del trabajo. */
  restantes?: number;
  productos?: ParaRevisar[];
  /** Códigos que se pidieron en una prueba y no están en el catálogo. */
  noEncontrados?: string[];
  error?: string;
}

interface RespuestaFicha extends FichaConFotos {
  productoId?: number;
  omitida?: boolean;
  /** SKU de las variantes que esta corrida creó. Un color que antes no estaba. */
  variantesNuevas?: string[];
  /** Colores que el proveedor sirvió sin un nombre del que salga un SKU. */
  coloresSinNombre?: number;
  error?: string;
}

interface Pantalla {
  empezar: HTMLButtonElement;
  probar: HTMLButtonElement;
  cancelar: HTMLButtonElement;
  desdeCero: HTMLButtonElement;
  codigos: HTMLTextAreaElement;
  retomar: HTMLElement;
  retomarCodigo: HTMLElement;
  progreso: HTMLElement;
  relleno: HTMLElement;
  barra: HTMLElement;
  problemas: HTMLDetailsElement;
  listaProblemas: HTMLElement;
  hallazgos: HTMLDetailsElement;
  listaHallazgos: HTMLElement;
  resumen: HTMLElement;
}

function pantalla(): Pantalla | null {
  const buscar = <T extends HTMLElement>(id: string): T | null =>
    document.getElementById(id) as T | null;

  const partes = {
    empezar: buscar<HTMLButtonElement>('empezar'),
    probar: buscar<HTMLButtonElement>('probar'),
    cancelar: buscar<HTMLButtonElement>('cancelar'),
    desdeCero: buscar<HTMLButtonElement>('desde-cero'),
    codigos: buscar<HTMLTextAreaElement>('codigos'),
    retomar: buscar('retomar'),
    retomarCodigo: buscar('retomar-codigo'),
    progreso: buscar('progreso'),
    relleno: buscar('barra-relleno'),
    barra: buscar('barra'),
    problemas: buscar<HTMLDetailsElement>('problemas'),
    listaProblemas: buscar('lista-problemas'),
    hallazgos: buscar<HTMLDetailsElement>('hallazgos'),
    listaHallazgos: buscar('lista-hallazgos'),
    resumen: buscar('resumen'),
  };

  return Object.values(partes).every(Boolean) ? (partes as Pantalla) : null;
}

export function prepararRevisionFotos(): void {
  const p = pantalla();
  if (!p) return;

  let cancelado = false;
  let corriendo = false;
  let ultimoPedido: number | null = null;

  /** El marcador se muestra siempre: un progreso invisible es un progreso en el que nadie confía. */
  const mostrarMarcador = (): void => {
    const desde = leerMarcador();
    p.retomar.hidden = desde === '';
    p.retomarCodigo.textContent = desde;
    p.desdeCero.hidden = desde === '';
    p.empezar.textContent = desde === '' ? 'Revisar el catálogo entero' : `Seguir desde ${desde}`;
  };

  mostrarMarcador();

  const cortesia = async (): Promise<void> => {
    const espera = esperaMs(ultimoPedido, Date.now());
    if (espera > 0) await new Promise((listo) => setTimeout(listo, espera));
    ultimoPedido = Date.now();
  };

  /** Nodos y no `innerHTML`: el motivo viene del proveedor y nunca entra como HTML. */
  const anotarEn = (lista: HTMLElement, caja: HTMLDetailsElement) =>
    (que: string, detalle: string): void => {
      const fila = document.createElement('li');
      const titulo = document.createElement('strong');
      titulo.textContent = que;
      fila.appendChild(titulo);
      fila.appendChild(document.createTextNode(` — ${detalle}`));
      lista.appendChild(fila);
      caja.hidden = false;
    };

  const anotarListaProblemas = anotarEn(p.listaProblemas, p.problemas);
  const anotarHallazgo = anotarEn(p.listaHallazgos, p.hallazgos);

  /**
   * Cuántas cosas quedaron para que alguien mire.
   *
   * SE CUENTA ACÁ DENTRO y no en el bucle, y por eso alcanza a las FALLAS POR FOTO: esas
   * las anota `unaFoto` a través de este mismo callback, sin volver al bucle. Contándolas
   * afuera, el número en pantalla decía «0 con problema» mientras la lista de abajo juntaba
   * cuarenta fotos caídas.
   */
  let problemas = 0;
  const anotarProblema = (que: string, detalle: string): void => {
    problemas += 1;
    anotarListaProblemas(que, detalle);
  };

  const terminar = (mensaje: string): void => {
    p.resumen.textContent = mensaje;
    p.resumen.hidden = false;
    p.empezar.disabled = false;
    p.probar.disabled = false;
    p.cancelar.hidden = true;
    corriendo = false;
    mostrarMarcador();
  };

  p.cancelar.addEventListener('click', () => {
    cancelado = true;
    p.cancelar.disabled = true;
    p.cancelar.textContent = 'Cortando…';
  });

  p.desdeCero.addEventListener('click', () => {
    borrarMarcador();
    mostrarMarcador();
    p.resumen.textContent = 'Marcador borrado: la próxima pasada arranca desde el principio.';
    p.resumen.hidden = false;
  });

  /**
   * El recorrido. `codigos` presente = prueba; ausente = pasada completa.
   *
   * EL MISMO BUCLE PARA LOS DOS MODOS. Lo único que cambia es de dónde sale la lista y si el
   * marcador se toca — porque si la prueba corriera por otro camino, probaría otra cosa.
   *
   * VA POR TAJADAS, y no es una optimización: es lo que mantiene la guarda de recorrido
   * único en pie. `corridaEnCurso` da por muerta una corrida más vieja que
   * `TOLERANCIA_MINUTOS` (30), para que una pestaña cerrada no bloquee el admin para
   * siempre. El catálogo entero son ~60 minutos, así que una sola corrida se quedaría sin
   * guarda pasada la mitad: el 409 dejaría de bloquear con el recorrido todavía vivo, y una
   * segunda pestaña podría duplicarle el tráfico al proveedor sin que nadie se entere.
   *
   * Cada tajada es una corrida propia: se abre, se recorre, se CIERRA, y se pide la
   * siguiente. Ninguna llega al límite. Se encadenan solas —el marcador dice dónde
   * seguir— así que para quien mira la pantalla es un solo recorrido con una sola barra.
   */
  const correr = async (codigos?: string[]): Promise<void> => {
    const esPrueba = codigos !== undefined;

    corriendo = true;
    p.empezar.disabled = true;
    p.probar.disabled = true;
    p.cancelar.hidden = false;
    p.cancelar.disabled = false;
    p.cancelar.textContent = 'Cortar';
    p.desdeCero.hidden = true;
    p.resumen.hidden = true;
    p.listaProblemas.replaceChildren();
    p.problemas.hidden = true;
    p.listaHallazgos.replaceChildren();
    p.hallazgos.hidden = true;
    cancelado = false;

    problemas = 0;

    let scrapeId: number | null = null;
    let revisados = 0;
    /** Productos que ganaron algo, y cuántas fotos aparecieron en total. */
    let conHallazgo = 0;
    let fotosNuevas = 0;
    let coloresNuevos = 0;

    /**
     * El tamaño del TRABAJO, no de la tajada. Lo dice el servidor en la primera vuelta.
     *
     * Sin esto la barra mediría la tajada y llegaría al 100% tres veces. Y sobre todo: es lo
     * único con lo que el resumen puede decir «N de M» — el contraste que delata un marcador
     * corrupto que arrancó a mitad del catálogo.
     */
    let trabajo = 0;

    /**
     * Desde dónde arrancó, para no mentir al final.
     *
     * Si el marcador venía con algo, esta corrida NO revisó el catálogo entero por más que
     * llegue al final de la lista. Decir «quedó revisado entero» sería tapar justo el caso
     * que esta pasada existe para encontrar.
     */
    const arranqueDesde = esPrueba ? '' : leerMarcador();

    /**
     * La barra mide cuánto queda del recorrido, no cuánto se encontró: todo lo resuelto
     * avanza, los problemas incluidos. Si lo que falló no avanzara, la barra no llegaría al
     * final aunque no quedara nada por hacer.
     */
    const mostrar = (): void => {
      const total = Math.max(trabajo, revisados);
      const partes = [`Revisados ${revisados} de ${total}`];
      if (fotosNuevas > 0) {
        partes.push(
          `${fotosNuevas} foto${fotosNuevas === 1 ? '' : 's'} nueva${fotosNuevas === 1 ? '' : 's'} en ${conHallazgo} producto${conHallazgo === 1 ? '' : 's'}`
        );
      }
      if (coloresNuevos > 0) {
        partes.push(
          `${coloresNuevos} color${coloresNuevos === 1 ? '' : 'es'} nuevo${coloresNuevos === 1 ? '' : 's'}`
        );
      }
      if (problemas > 0) partes.push(`${problemas} con problema`);
      p.progreso.textContent = partes.join(' · ');

      const pct = total > 0 ? Math.min(100, (revisados / total) * 100) : 0;
      p.relleno.style.inlineSize = `${pct}%`;
      p.barra.setAttribute('aria-valuenow', String(Math.round(pct)));
    };

    try {
      let primera = true;

      // Una vuelta por tajada. Ver la nota de arriba: cada una es su propia corrida.
      while (!cancelado) {
        /**
         * La lista sale de NUESTRA base: no cuesta tráfico del proveedor y no lleva cortesía.
         * Abre la corrida en el mismo pedido.
         *
         * En prueba se manda `codigos` y NO `desde`: el marcador es de la pasada larga, y si
         * el corte se aplicara, pedir un código anterior al marcador no devolvería nada.
         */
        const lote = await postJson<RespuestaLista>(
          '/api/scrape/revision-fotos',
          esPrueba ? { codigos } : { desde: leerMarcador() }
        );
        if (lote.error) {
          terminar(lote.error);
          return;
        }

        // Sólo en la primera vuelta: son los códigos que se pidieron y no existen.
        if (primera) {
          for (const codigo of lote.noEncontrados ?? []) {
            anotarProblema(
              codigo,
              'no está en el catálogo, o está eliminado o sin ficha de origen'
            );
          }
          trabajo = lote.restantes ?? 0;
        }

        const productos = lote.productos ?? [];
        if (productos.length === 0) {
          if (primera && esPrueba) {
            terminar('Ninguno de esos códigos se puede revisar. Mirá la lista de abajo.');
            return;
          }
          // La lista vacía en la pasada significa que llegó al final. Fin del encadenado.
          if (!esPrueba) borrarMarcador();
          if (primera) {
            terminar('No queda ninguna ficha por revisar. La pasada está completa.');
            return;
          }
          break;
        }
        if (typeof lote.scrapeId !== 'number') {
          terminar('No se pudo abrir la corrida.');
          return;
        }
        scrapeId = lote.scrapeId;
        primera = false;
        mostrar();

        await unaTajada(productos);

        /**
         * LA CORRIDA SE CIERRA AL FIN DE CADA TAJADA, y por eso la siguiente no choca con el
         * 409: no hay dos abiertas nunca, y ninguna llega a la tolerancia con la que
         * `corridaEnCurso` la daría por muerta.
         */
        await postJson('/api/scrape/cerrar', { scrapeId, abortado: cancelado });
        scrapeId = null;

        // La prueba es UNA tajada: es un puñado de códigos escritos a mano, no un recorrido.
        if (esPrueba) break;
        if (cancelado) break;
      }

      if (!esPrueba && !cancelado && revisados >= trabajo) borrarMarcador();

      const cola = cancelado
        ? 'Cortado. Apretá de nuevo y sigue desde el último código revisado.'
        : esPrueba
          ? 'Prueba terminada.'
          : arranqueDesde === ''
            ? 'Listo: el catálogo del proveedor quedó revisado entero.'
            : `Listo, desde ${arranqueDesde} en adelante. Para dar la vuelta completa, borrá el marcador y corré de nuevo.`;
      const publicar =
        fotosNuevas > 0 || coloresNuevos > 0 ? ' Publicá para que el catálogo lo muestre.' : '';
      terminar(`${p.progreso.textContent}. ${cola}${publicar}`);
    } catch (error) {
      /**
       * Se intenta cerrar la corrida aunque el bucle explote: una corrida abierta bloquea la
       * próxima con un 409 que hablaría de un recorrido que murió hace rato. El marcador NO se
       * borra: es justamente el caso en que hace falta.
       */
      if (scrapeId !== null) {
        await postJson('/api/scrape/cerrar', { scrapeId, abortado: true }).catch(() => {});
      }
      terminar(error instanceof Error ? error.message : String(error));
    }

    /** Una tajada: las fichas de esta corrida, una por una. */
    async function unaTajada(productos: ParaRevisar[]): Promise<void> {
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
        } else {
          const aviso = avisoDeColoresSinNombre(ficha.coloresSinNombre);
          if (aviso) anotarProblema(producto.codigo, aviso);

          const nuevas = ficha.variantesNuevas ?? [];
          if (nuevas.length > 0) {
            coloresNuevos += nuevas.length;
            anotarHallazgo(producto.codigo, `color nuevo: ${nuevas.join(', ')}`);
          }

          /**
           * `omitida` no debería pasar acá —cada código aparece una vez en la lista— pero si
           * pasara, la ficha no se pidió y no hay nada que contar. No es un problema.
           */
          if (!ficha.omitida) {
            const { pedidas, vinculadas } = await traerFotos(ficha, cortesia, anotarProblema);
            if (vinculadas > 0) {
              fotosNuevas += vinculadas;
              conHallazgo++;
              anotarHallazgo(
                producto.codigo,
                `${vinculadas} foto${vinculadas === 1 ? '' : 's'} que faltaba${vinculadas === 1 ? '' : 'n'}, de ${pedidas} que tiene el proveedor`
              );
            } else if (esPrueba) {
              // En una prueba de cuatro códigos, «no le faltaba nada» es un resultado que
              // hay que poder leer. En la pasada larga sería ruido de mil líneas.
              anotarHallazgo(producto.codigo, `ya estaba completo: ${pedidas} foto(s)`);
            }
          }
        }

        /**
         * EL MARCADOR SE MUEVE AUNQUE HAYA FALLADO, y es deliberado. Marca «hasta acá se
         * pasó», no «hasta acá salió bien»: una ficha caída ya quedó en `scrape_errores` y en
         * la lista de problemas, y reintentarla en cada corrida trabaría el avance del resto.
         *
         * En prueba NO se mueve: cuatro códigos a mano no son progreso de la pasada.
         */
        revisados++;
        if (!esPrueba) guardarMarcador(producto.codigo);
        mostrar();
      }
    }
  };

  p.probar.addEventListener('click', () => {
    if (corriendo) return;

    const codigos = partirCodigos(p.codigos.value);
    /**
     * EL CORTE MÁS IMPORTANTE DE LA PANTALLA. Con el campo vacío no se manda `codigos: []`
     * al servidor y punto: la guarda de fondo está en `paraRevisarFotos`, pero el error que
     * hay que hacer imposible acá es que un click en «Probar» con el campo en blanco largue
     * la corrida del catálogo entero contra producción.
     */
    if (codigos.length === 0) {
      p.resumen.textContent = 'Escribí al menos un código para probar.';
      p.resumen.hidden = false;
      p.codigos.focus();
      return;
    }

    void correr(codigos);
  });

  p.empezar.addEventListener('click', () => {
    if (corriendo) return;
    void correr();
  });
}
