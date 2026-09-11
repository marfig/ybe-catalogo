/**
 * El bucle de la reposición, que vive en la pestaña (SPEC-etapa2 §7.1, §7.4, §8.1).
 *
 * MISMO REPARTO QUE `barrido-cliente.ts` E `importar-cliente.ts`: acá está sólo lo que
 * necesita un navegador —`fetch`, el DOM y el `<canvas>` de las fotos—, y todo lo que
 * decide (validar y desduplicar códigos, y para cada uno qué hacer con la base y con
 * el proveedor) vive en `lib/reposicion.ts`, que es puro y tiene tests.
 *
 * A DIFERENCIA DEL BARRIDO, la cola no la manda el servidor: la escribe una persona a
 * mano en una `<textarea>`. Por eso el primer paso, antes de pedir nada, es
 * `normalizarLista()` — los códigos inválidos se muestran de una, sin gastar ningún
 * pedido al proveedor en algo que ya se sabe que está mal escrito.
 *
 * LAS FOTOS VAN POR EL MISMO CAMINO QUE `importar-cliente.ts`: `traerFotos()` de
 * `./fotos.ts`, que es la única pieza que sabe bajar del puente, derivar con canvas,
 * subir y vincular (§8.1). Nada de eso se reescribe acá.
 *
 * UNA SOLA CORTESÍA PARA TODO. El código y sus fotos —cuando las trae— comparten el
 * mismo contador de «último pedido»: cada código puede terminar pidiéndole al
 * proveedor su búsqueda, su ficha Y cada una de sus fotos, y las fotos multiplican el
 * tráfico más que cualquier otro recorrido de este admin. Sin un solo reloj para
 * todo, el paso de 1 request por segundo (§7.4) se rompería apenas un producto trajera
 * más de una foto.
 */
import { normalizarLista } from '../lib/reposicion.ts';
import { esperaMs } from '../lib/scrape/marcha.ts';
import { traerFotos } from './fotos.ts';

type Desenlace =
  | 'invalido'
  | 'restaurado'
  | 'sigue-en-papelera'
  | 'creado'
  | 'resincronizado'
  | 'indeterminado'
  | 'no-existe'
  | 'error';

interface RespuestaAbrir {
  scrapeId?: number;
  error?: string;
}

interface RespuestaCodigo {
  codigo?: string;
  desenlace?: Desenlace;
  motivo?: string;
  productoId?: number;
  url?: string;
  error?: string;
  /** Un item por color del modelo, con el SKU de su variante. Ver `traerFotos()`. */
  colores?: Array<{ sku: string; fotos: string[] }>;
}

interface ProductoDeCorrida {
  id: number;
  codigo: string;
  nombre: string | null;
  estado: string;
}

interface RespuestaCerrar {
  hallados?: number;
  errores?: number;
  error?: string;
  productos?: ProductoDeCorrida[];
}

/**
 * POST con JSON y una sola forma de fallar.
 *
 * Igual que en `barrido-cliente.ts`: una respuesta que no es JSON es, casi siempre, la
 * sesión de Access vencida.
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
  formulario: HTMLFormElement;
  codigos: HTMLTextAreaElement;
  marcha: HTMLElement;
  progreso: HTMLElement;
  barra: HTMLElement;
  relleno: HTMLElement;
  cancelar: HTMLButtonElement;
  resultados: HTMLElement;
  resumen: HTMLElement;
}

function buscarPantalla(): Pantalla | null {
  const de = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

  const p = {
    formulario: de<HTMLFormElement>('reposicion'),
    codigos: de<HTMLTextAreaElement>('codigos'),
    marcha: de('marcha'),
    progreso: de('progreso'),
    barra: de('barra'),
    relleno: de('barra-relleno'),
    cancelar: de<HTMLButtonElement>('cancelar'),
    resultados: de('resultados'),
    resumen: de('resumen'),
  };

  return Object.values(p).every(Boolean) ? (p as Pantalla) : null;
}

export function prepararReposicion(): void {
  const p = buscarPantalla();
  if (!p) return;

  p.formulario.addEventListener('submit', (evento) => {
    evento.preventDefault();
    // Cualquier cosa que separe códigos pegados de cualquier lado: saltos de línea,
    // comas, espacios. La persona no tiene que acordarse de un formato.
    const tokens = p.codigos.value
      .split(/[\s,;]+/)
      .map((t) => t.trim())
      .filter((t) => t !== '');
    if (tokens.length === 0) return;
    void correr(p, tokens);
  });
}

/** Una fila del listado de resultados. */
function anotar(lista: HTMLElement, codigo: string, motivo: string, tono: 'ok' | 'neutro' | 'problema'): void {
  const fila = document.createElement('li');
  if (tono === 'neutro') fila.className = 'resumen-omitidos';
  if (tono === 'problema') fila.className = 'resumen-fallos';

  const titulo = document.createElement('strong');
  titulo.textContent = codigo;
  fila.appendChild(titulo);
  fila.appendChild(document.createTextNode(` — ${motivo}`));
  lista.appendChild(fila);
}

/**
 * `traerFotos()` reporta una foto caída con este par: qué falló y por qué. Se anota
 * como una fila más, en el mismo tono que un error de código —pide atención—, pero es
 * una fila APARTE de la del producto: la foto que no subió no invalida el código. El
 * producto sigue contando como repuesto y `/fotos-faltantes` existe exactamente para
 * completar lo que quede sin foto.
 */
function anotarProblemaDeFoto(lista: HTMLElement, que: string, motivo: string): void {
  anotar(lista, que, motivo, 'problema');
}

/** El tono de cada desenlace, para pintar el resultado. */
function tonoDe(desenlace: Desenlace): 'ok' | 'neutro' | 'problema' {
  if (desenlace === 'creado' || desenlace === 'restaurado' || desenlace === 'resincronizado') return 'ok';
  if (desenlace === 'sigue-en-papelera' || desenlace === 'indeterminado') return 'neutro';
  return 'problema';
}

/**
 * El recorrido completo: uno por uno, de a un pedido por segundo.
 *
 * Nunca lanza. Una excepción a mitad de camino dejaría la corrida abierta en la base y
 * la próxima reposición chocaría contra ella sin explicación.
 */
async function correr(p: Pantalla, tokens: string[]): Promise<void> {
  const { codigos, invalidos } = normalizarLista(tokens);

  p.formulario.querySelectorAll('input, textarea, button').forEach((c) => {
    (c as HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement).disabled = true;
  });
  p.marcha.hidden = false;
  p.resumen.hidden = true;
  p.resultados.textContent = '';
  p.cancelar.disabled = false;
  p.cancelar.textContent = 'Cancelar';

  // Los inválidos se muestran de una: no le costaron ningún pedido al proveedor.
  for (const inv of invalidos) anotar(p.resultados, inv.original, inv.motivo, 'problema');

  const total = codigos.length;
  const tally: Record<Desenlace, number> = {
    invalido: invalidos.length,
    restaurado: 0,
    'sigue-en-papelera': 0,
    creado: 0,
    resincronizado: 0,
    indeterminado: 0,
    'no-existe': 0,
    error: 0,
  };

  const mostrar = (hechos: number): void => {
    p.progreso.textContent = total === 0 ? 'Nada para revisar.' : `${hechos} de ${total} códigos`;
    const pct = total === 0 ? 100 : Math.round((hechos / total) * 100);
    p.relleno.style.inlineSize = `${pct}%`;
    p.barra.setAttribute('aria-valuenow', String(pct));
  };
  mostrar(0);

  if (total === 0) {
    cerrarSinCorrida(p, invalidos.length);
    return;
  }

  let cancelado = false;
  const alCancelar = (): void => {
    cancelado = true;
    p.cancelar.disabled = true;
    p.cancelar.textContent = 'Cancelando…';
  };
  p.cancelar.addEventListener('click', alCancelar);

  const alSalir = (evento: BeforeUnloadEvent): void => evento.preventDefault();
  window.addEventListener('beforeunload', alSalir);

  let scrapeId: number | null = null;
  let ultimoPedido: number | null = null;
  /** Qué código fue qué, para repartir el worklist (ver el comentario más abajo). */
  const codigosCreados = new Set<string>();
  const codigosRestaurados = new Set<string>();

  /**
   * El paso de §7.4, y CUENTA CADA PEDIDO que sale al proveedor: la búsqueda de
   * presencia, la ficha y cada una de las fotos comparten este reloj. Es la misma
   * función, con el mismo nombre, que `importar-cliente.ts` le pasa a `traerFotos()`.
   */
  const cortesia = async (): Promise<void> => {
    const espera = esperaMs(ultimoPedido, Date.now());
    if (espera > 0) await new Promise((listo) => setTimeout(listo, espera));
    ultimoPedido = Date.now();
  };

  try {
    const abierta = await postJson<RespuestaAbrir>('/api/reposicion/abrir', { total });
    if (abierta.error || typeof abierta.scrapeId !== 'number') {
      terminar(p, abierta.error ?? 'No se pudo abrir la corrida.');
      return;
    }
    scrapeId = abierta.scrapeId;

    let hechos = 0;
    for (const codigo of codigos) {
      if (cancelado) break;

      await cortesia();
      const r = await postJson<RespuestaCodigo>('/api/reposicion/codigo', { scrapeId, codigo });

      if (r.error || !r.desenlace) {
        anotar(p.resultados, codigo, r.error ?? 'No se pudo revisar.', 'problema');
        tally.error += 1;
      } else {
        anotar(p.resultados, r.codigo ?? codigo, r.motivo ?? '', tonoDe(r.desenlace));
        tally[r.desenlace] += 1;

        /**
         * QUIÉN ES QUIÉN EN EL WORKLIST. Desde que `restaurar()` (`papelera.ts`) deja
         * TODO en `importado` —para que cualquier restauración pase por «Por
         * aprobar»— un alta y una restauración quedan con el MISMO estado en la
         * base, así que `productosDeCorrida` ya no alcanza para separarlos. Lo que
         * SÍ los distingue es este `desenlace`, que se guarda acá para repartir el
         * worklist más abajo.
         */
        if (r.desenlace === 'creado') codigosCreados.add(r.codigo ?? codigo);
        if (r.desenlace === 'restaurado') codigosRestaurados.add(r.codigo ?? codigo);

        /**
         * SÓLO CUANDO SE LLEGÓ A BAJAR UNA FICHA: `colores` viene en `creado`,
         * `restaurado` y `resincronizado` — los tres desenlaces que tocan al
         * proveedor por una ficha (§8.1) — y en ninguno de los demás. Un producto que
         * vuelve de la papelera con un color nuevo también tiene que recibir SUS
         * fotos, no sólo las del color que ya tenía: por eso esto corre igual en las
         * tres ramas y no sólo en el alta.
         *
         * DE A UNA, NUNCA EN PARALELO: `traerFotos()` ya pide de a una por dentro, y
         * comparte `cortesia` con el código de arriba — es la misma cortesía, no una
         * aparte.
         */
        if (r.colores && r.colores.length > 0) {
          await traerFotos(
            { codigo: r.codigo ?? codigo, colores: r.colores },
            cortesia,
            (que, motivo) => anotarProblemaDeFoto(p.resultados, que, motivo)
          );
        }
      }

      hechos += 1;
      mostrar(hechos);
    }
  } finally {
    window.removeEventListener('beforeunload', alSalir);
    p.cancelar.removeEventListener('click', alCancelar);
  }

  const resumen =
    scrapeId === null
      ? ({} as RespuestaCerrar)
      : await postJson<RespuestaCerrar>('/api/reposicion/cerrar', { scrapeId, abortado: cancelado });

  cerrar(p, tally, {
    cancelado,
    error: resumen.error,
    productos: resumen.productos ?? [],
    codigosCreados,
    codigosRestaurados,
  });
}

/** Cuando todos los códigos escritos eran inválidos: no hay nada que abrirle al servidor. */
function cerrarSinCorrida(p: Pantalla, invalidos: number): void {
  p.marcha.hidden = true;
  p.resumen.hidden = false;
  p.resumen.className = invalidos > 0 ? 'resumen resumen--error' : 'resumen';
  p.resumen.textContent =
    invalidos > 0
      ? 'Ningún código era válido. Revisá lo que pegaste arriba.'
      : 'No había nada para revisar.';
  p.formulario.querySelectorAll('input, textarea, button').forEach((c) => {
    (c as HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement).disabled = false;
  });
}

/** El final del recorrido: el resumen y el worklist de lo repuesto. */
function cerrar(
  p: Pantalla,
  tally: Record<Desenlace, number>,
  {
    cancelado,
    error,
    productos,
    codigosCreados,
    codigosRestaurados,
  }: {
    cancelado: boolean;
    error?: string;
    productos: ProductoDeCorrida[];
    codigosCreados: Set<string>;
    codigosRestaurados: Set<string>;
  }
): void {
  p.marcha.hidden = true;
  p.resumen.hidden = false;
  p.resumen.textContent = '';

  if (error) {
    p.resumen.className = 'resumen resumen--error';
    p.resumen.textContent = error;
    return;
  }

  p.resumen.className = cancelado ? 'resumen resumen--error' : 'resumen';

  const partes: string[] = [];
  if (tally.creado > 0) partes.push(`${tally.creado} nuevos`);
  if (tally.restaurado > 0) partes.push(`${tally.restaurado} restaurados de la papelera`);
  if (tally.resincronizado > 0) partes.push(`${tally.resincronizado} actualizados`);
  if (tally['sigue-en-papelera'] > 0) partes.push(`${tally['sigue-en-papelera']} siguen en la papelera`);
  if (tally['no-existe'] > 0) partes.push(`${tally['no-existe']} no existen en ningún lado`);
  if (tally.indeterminado > 0) partes.push(`${tally.indeterminado} sin poder revisar`);
  if (tally.error > 0) partes.push(`${tally.error} con error`);
  if (tally.invalido > 0) partes.push(`${tally.invalido} con un código inválido`);

  const cabecera = cancelado ? 'Reposición cancelada. Lo que se llegó a revisar: ' : 'Listo: ';
  p.resumen.appendChild(
    document.createTextNode(cabecera + (partes.length > 0 ? partes.join(', ') : 'nada para contar') + '.')
  );

  /**
   * LA SEPARACIÓN YA NO SALE DEL `estado` DE LA BASE. Desde que `restaurar()`
   * (`papelera.ts`) deja todo en `importado` —para que cualquier restauración pase
   * por «Por aprobar»—, un alta y una restauración terminan con el MISMO estado: la
   * única forma de distinguirlos es el `desenlace` que ya se guardó código por
   * código durante el recorrido, en `codigosCreados` / `codigosRestaurados`.
   */
  const nuevos = productos.filter((prod) => codigosCreados.has(prod.codigo));
  const restaurados = productos.filter((prod) => codigosRestaurados.has(prod.codigo));

  if (nuevos.length > 0 || restaurados.length > 0) {
    const worklist = document.createElement('div');
    worklist.className = 'confirmar';

    if (nuevos.length > 0) {
      const h = document.createElement('h2');
      h.textContent = 'Nuevos, por aprobar';
      worklist.appendChild(h);
      const ul = document.createElement('ul');
      ul.className = 'confirmar-lista';
      for (const prod of nuevos) {
        const li = document.createElement('li');
        li.textContent = prod.nombre ? `${prod.codigo} — ${prod.nombre}` : prod.codigo;
        ul.appendChild(li);
      }
      worklist.appendChild(ul);
      const nota = document.createElement('p');
      nota.className = 'nota';
      nota.textContent = 'El proveedor no expone nombre ni precio acá: completalos en la grilla.';
      worklist.appendChild(nota);
    }

    if (restaurados.length > 0) {
      const h = document.createElement('h2');
      h.textContent = 'Restaurados de la papelera, por aprobar';
      worklist.appendChild(h);
      const ul = document.createElement('ul');
      ul.className = 'confirmar-lista';
      for (const prod of restaurados) {
        const li = document.createElement('li');
        li.textContent = prod.nombre ? `${prod.codigo} — ${prod.nombre}` : prod.codigo;
        ul.appendChild(li);
      }
      worklist.appendChild(ul);
      const nota = document.createElement('p');
      nota.className = 'nota';
      // Ya NO vuelven derecho al catálogo: hay que revisarlos antes de que se vean.
      nota.textContent =
        'Salieron de la papelera con su dirección de siempre, pero no se ven en el ' +
        'sitio todavía: revisá el precio y los demás datos antes de aprobarlos.';
      worklist.appendChild(nota);
    }

    p.resumen.appendChild(worklist);
  }

  const ir = document.createElement('p');
  ir.className = 'pie-guardar';
  const enlace = document.createElement('a');
  enlace.href = '/productos';
  enlace.className = 'boton-enlace';
  enlace.textContent = 'Ver la grilla';
  ir.appendChild(enlace);
  p.resumen.appendChild(ir);

  p.formulario.querySelectorAll('input, textarea, button').forEach((c) => {
    (c as HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement).disabled = false;
  });
}

/** Un final que no es el esperado. El mensaje del servidor ya viene en castellano. */
function terminar(p: Pantalla, motivo: string): void {
  p.resumen.className = 'resumen resumen--error';
  p.resumen.textContent = motivo;
  p.resumen.hidden = false;
  p.marcha.hidden = true;
  p.formulario.querySelectorAll('input, textarea, button').forEach((c) => {
    (c as HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement).disabled = false;
  });
}
