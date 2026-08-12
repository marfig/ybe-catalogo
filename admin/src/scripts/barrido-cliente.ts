/**
 * El bucle del barrido, que vive en la pestaña (SPEC-etapa2 §7.1, §7.4).
 *
 * Mismo reparto que la importación: acá está sólo lo que necesita un navegador —`fetch`
 * y el DOM— y todo lo que decide vive en `lib/scrape/barrido.ts` y `lib/scrape/cola.ts`,
 * que son puros y tienen tests.
 *
 * MÁS CORTO QUE `importar-cliente.ts` A PROPÓSITO: no hay páginas que recorrer ni fotos
 * que derivar. La cola llega rendida por el servidor y esto es un `for` con cortesía.
 *
 * LA ESPERA SALE DE `marcha.ts`, no de una constante propia. El paso de 1 request por
 * segundo es del proveedor, no de la pantalla: un barrido con su propio paso podría ir
 * más rápido que la importación sin que nadie lo hubiera decidido.
 */
import {
  AVANCE_INICIAL,
  porcentaje,
  revisados,
  sumar,
  textoDeBarrido,
  type Avance,
} from '../lib/scrape/barrido.ts';
import { esperaMs } from '../lib/scrape/marcha.ts';
import type { Presencia } from '../lib/scrape/presencia.ts';

interface RespuestaPresencia {
  id?: number;
  codigo?: string;
  presencia?: Presencia;
  motivo?: string;
  omitido?: boolean;
  error?: string;
}

interface Resumen {
  hallados?: number;
  errores?: number;
  error?: string;
}

/** Un producto de la cola, tal cual lo rinde la página. */
interface Candidato {
  id: number;
  codigo: string;
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

interface Pantalla {
  empezar: HTMLButtonElement;
  marcha: HTMLElement;
  progreso: HTMLElement;
  barra: HTMLElement;
  relleno: HTMLElement;
  cancelar: HTMLButtonElement;
  bajas: HTMLDetailsElement;
  listaBajas: HTMLElement;
  problemas: HTMLDetailsElement;
  listaProblemas: HTMLElement;
  resumen: HTMLElement;
  /** La cola, rendida por el servidor como JSON en la propia página. */
  datos: HTMLScriptElement;
}

function buscarPantalla(): Pantalla | null {
  const de = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

  const p = {
    empezar: de<HTMLButtonElement>('empezar'),
    marcha: de('marcha'),
    progreso: de('progreso'),
    barra: de('barra'),
    relleno: de('barra-relleno'),
    cancelar: de<HTMLButtonElement>('cancelar'),
    bajas: de<HTMLDetailsElement>('bajas'),
    listaBajas: de('lista-bajas'),
    problemas: de<HTMLDetailsElement>('problemas'),
    listaProblemas: de('lista-problemas'),
    resumen: de('resumen'),
    datos: de<HTMLScriptElement>('cola'),
  };

  return Object.values(p).every(Boolean) ? (p as Pantalla) : null;
}

export function prepararBarrido(): void {
  const p = buscarPantalla();
  if (!p) return;

  let cola: Candidato[] = [];
  try {
    cola = JSON.parse(p.datos.textContent ?? '[]') as Candidato[];
  } catch {
    return;
  }
  if (cola.length === 0) return;

  p.empezar.addEventListener('click', () => void correr(p, cola));
}

/**
 * Le pregunta al proveedor por cada producto de la cola, de a uno por segundo.
 *
 * Nunca lanza. Un barrido que se corta con una excepción deja la corrida abierta en la
 * base y la próxima importación choca contra ella sin explicación.
 */
async function correr(p: Pantalla, cola: Candidato[]): Promise<void> {
  let avance: Avance = { ...AVANCE_INICIAL, total: cola.length };
  let scrapeId: number | null = null;
  let cancelado = false;
  let ultimoPedido: number | null = null;

  const mostrar = (): void => {
    p.progreso.textContent = textoDeBarrido(avance);
    const pct = porcentaje(avance);
    p.relleno.style.inlineSize = `${pct}%`;
    p.barra.setAttribute('aria-valuenow', String(Math.round(pct)));
  };

  const anotar = (lista: HTMLElement, caja: HTMLDetailsElement, que: string, detalle: string) => {
    const fila = document.createElement('li');
    const titulo = document.createElement('strong');
    titulo.textContent = que;
    fila.appendChild(titulo);
    fila.appendChild(document.createTextNode(` — ${detalle}`));
    lista.appendChild(fila);
    caja.hidden = false;
  };

  /**
   * El aviso de la pantalla no alcanza: quien cierra la pestaña ya decidió. Esto le da
   * la chance de arrepentirse con el recorrido a mitad de camino.
   */
  const alSalir = (evento: BeforeUnloadEvent): void => evento.preventDefault();
  window.addEventListener('beforeunload', alSalir);

  p.cancelar.addEventListener('click', () => {
    cancelado = true;
    p.cancelar.disabled = true;
    p.cancelar.textContent = 'Cancelando…';
  });

  p.empezar.disabled = true;
  p.marcha.hidden = false;
  p.resumen.hidden = true;
  p.cancelar.disabled = false;
  p.cancelar.textContent = 'Cancelar';
  mostrar();

  try {
    const abierta = await postJson<{ scrapeId?: number; error?: string }>('/api/scrape/abrir', {
      tipo: 'barrido',
      total: cola.length,
    });
    if (abierta.error || typeof abierta.scrapeId !== 'number') {
      terminar(p, abierta.error ?? 'No se pudo abrir la corrida.');
      return;
    }
    scrapeId = abierta.scrapeId;

    for (const candidato of cola) {
      if (cancelado) break;

      /**
       * La cortesía de §7.4, y cuenta CADA pedido que sale al proveedor. El piso en 0
       * vive en `esperaMs`: `Date.now()` puede retroceder con un ajuste de hora.
       */
      const espera = esperaMs(ultimoPedido, Date.now());
      if (espera > 0) await new Promise((listo) => setTimeout(listo, espera));
      ultimoPedido = Date.now();

      const r = await postJson<RespuestaPresencia>('/api/scrape/presencia', {
        scrapeId,
        id: candidato.id,
      });

      if (r.error) {
        avance = sumar(avance, 'indeterminado');
        anotar(p.listaProblemas, p.problemas, candidato.codigo, r.error);
        mostrar();
        continue;
      }

      /**
       * Un producto que dejó de ser barrible —lo eliminaron desde otra pestaña— NO se
       * cuenta como revisado ni como baja: no se le preguntó nada al proveedor. Se baja
       * el total para que la barra siga llegando al final.
       */
      if (r.omitido) {
        avance = { ...avance, total: Math.max(0, avance.total - 1) };
        mostrar();
        continue;
      }

      avance = sumar(avance, r.presencia ?? 'indeterminado');

      if (r.presencia === 'ausente') {
        anotar(p.listaBajas, p.bajas, candidato.codigo, 'el proveedor ya no lo publica');
      } else if (r.presencia === 'indeterminado') {
        anotar(p.listaProblemas, p.problemas, candidato.codigo, r.motivo ?? 'no se pudo revisar');
      }

      mostrar();
    }
  } finally {
    window.removeEventListener('beforeunload', alSalir);
  }

  const resumen =
    scrapeId === null
      ? ({} as Resumen)
      : await postJson<Resumen>('/api/scrape/cerrar', { scrapeId, abortado: cancelado });

  cerrar(p, avance, { cancelado, error: resumen.error });
}

/** El final del recorrido, con el camino a lo que hay que hacer después. */
function cerrar(
  p: Pantalla,
  avance: Avance,
  { cancelado, error }: { cancelado: boolean; error?: string }
): void {
  p.marcha.hidden = true;
  p.resumen.hidden = false;
  p.resumen.textContent = '';

  if (error) {
    p.resumen.className = 'resumen resumen--error';
    p.resumen.textContent = error;
    return;
  }

  p.resumen.className = 'resumen';
  const cabecera = cancelado
    ? `Barrido cancelado. Lo revisado quedó guardado: ${revisados(avance)} productos.`
    : `Listo: ${revisados(avance)} productos revisados.`;
  p.resumen.appendChild(document.createTextNode(`${cabecera} `));

  /**
   * SIN BAJAS TAMBIÉN SE DICE. Un barrido que termina en silencio es indistinguible de
   * uno que no hizo nada, y «ninguno dado de baja» es la respuesta que se está buscando
   * la mayoría de las veces.
   */
  if (avance.ausentes === 0) {
    p.resumen.appendChild(
      document.createTextNode('El proveedor sigue publicando todo lo que tenemos.')
    );
  } else {
    const cuantos =
      avance.ausentes === 1
        ? '1 producto ya no está en el proveedor.'
        : `${avance.ausentes} productos ya no están en el proveedor.`;
    p.resumen.appendChild(document.createTextNode(`${cuantos} `));

    // Al lugar donde se decide, no a una lista para mirar: la baja no borró nada.
    const ir = document.createElement('a');
    ir.href = '/productos?estado=dados-de-baja';
    ir.textContent = 'Revisarlos y decidir qué hacer';
    p.resumen.appendChild(ir);
  }

  if (avance.indeterminados > 0) {
    const nota = document.createElement('p');
    nota.className = 'nota';
    nota.textContent =
      avance.indeterminados === 1
        ? '1 producto no se pudo revisar. No es una baja: le vuelve a tocar en el próximo barrido.'
        : `${avance.indeterminados} productos no se pudieron revisar. No son bajas: les vuelve a tocar en el próximo barrido.`;
    p.resumen.appendChild(nota);
  }
}

/** Un final que no es el esperado. El mensaje del servidor ya viene en castellano. */
function terminar(p: Pantalla, motivo: string): void {
  p.resumen.className = 'resumen resumen--error';
  p.resumen.textContent = motivo;
  p.resumen.hidden = false;
  p.marcha.hidden = true;
  p.empezar.disabled = false;
}
