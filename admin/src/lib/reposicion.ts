/**
 * Reposición: preguntarle al proveedor por códigos puntuales, uno por uno.
 *
 * A DIFERENCIA DEL BARRIDO, que recorre lo que YA tenemos, y de la IMPORTACIÓN, que
 * recorre un listado del proveedor, acá la lista la escribe una persona a mano — códigos
 * sueltos de los que sospecha que volvieron, o que nunca terminaron de entrar. Por eso
 * la consulta es `buscarPorCodigo()` (§codigo.ts) y no la grilla: necesita ver también lo
 * que está en la papelera, que la grilla filtra.
 *
 * LA TRAMPA QUE ESTE MÓDULO EXISTE PARA CERRAR. `registrarFicha()` hace `UPDATE ... WHERE
 * upper(codigo) = upper(?)` sin mirar `estado`: es justo lo que le permite no pisar
 * curaduría en un producto activo (ver `registrar.ts`). Pero ese mismo `UPDATE` nunca
 * saca a nadie de la papelera. Si esta pantalla llamara sólo a `registrarFicha()` sobre
 * un código que el proveedor volvió a publicar, la fila se actualizaría en silencio y
 * quedaría `estado = 'eliminado'` PARA SIEMPRE: `registrarFicha` no revierte lo que una
 * persona decidió, y sacar de la papelera es una decisión de persona.
 *
 * Por eso `resolverCodigo()` restaura primero — con `restaurar()`, que SÍ conoce la
 * papelera — y recién después llama a `registrarFicha()` para traer lo que cambió en el
 * proveedor. Las dos, siempre las dos. Ver el test que lleva ese nombre.
 *
 * MISMO REPARTO QUE `vuelta.ts` Y `barrido.ts`: acá vive la decisión, pura y con tests;
 * `resolverCodigo` es la única pieza que toca la base y la red, y lo hace con
 * colaboradores inyectables para poder testearla sin ninguna de las dos.
 */
import { buscarPorCodigo, normalizarCodigo, type ProductoExistente } from './codigo.ts';
import type { Ejecutar } from './grilla.ts';
import { restaurar } from './papelera.ts';
import {
  cuantasFotosDeColor,
  fotosPorColor,
  type FichaExtraida,
  type FotosDeColor,
} from './scrape/extractor.ts';
import { extraerFicha } from './scrape/ficha.ts';
import { PASO_MS } from './scrape/marcha.ts';
import { consultarPresencia, type ResultadoPresencia } from './scrape/presencia.ts';
import { registrarFicha, type FichaParaRegistrar } from './scrape/registrar.ts';

// --------------------------------------------------------------------------
// La lista pegada a mano
// --------------------------------------------------------------------------

export interface CodigoInvalido {
  /** Tal cual lo escribió la persona, para que lo reconozca en lo que pegó. */
  original: string;
  motivo: string;
}

/**
 * Normaliza cada código y saca los repetidos. Pura.
 *
 * UN CÓDIGO INVÁLIDO ES SU PROPIO RESULTADO, no una excepción que tumbe la lista
 * entera: alguien pegó 40 códigos y uno tiene una coma de más no puede perder los otros
 * 39. El dedupe corre DESPUÉS de normalizar — `cg1` y `CG1` son el mismo código — y se
 * queda con la primera forma en que apareció.
 */
export function normalizarLista(textos: readonly string[]): {
  codigos: string[];
  invalidos: CodigoInvalido[];
} {
  const vistos = new Set<string>();
  const codigos: string[] = [];
  const invalidos: CodigoInvalido[] = [];

  for (const original of textos) {
    let codigo: string;
    try {
      codigo = normalizarCodigo(original);
    } catch (error) {
      invalidos.push({ original, motivo: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (vistos.has(codigo)) continue;
    vistos.add(codigo);
    codigos.push(codigo);
  }

  return { codigos, invalidos };
}

// --------------------------------------------------------------------------
// La clasificación: qué hacer con un código, dado lo que se sabe de él
// --------------------------------------------------------------------------

export type Clasificacion =
  | { accion: 'restaurar'; producto: ProductoExistente; url: string }
  | { accion: 'sigue-en-papelera'; producto: ProductoExistente }
  | { accion: 'alta'; url: string }
  | { accion: 'resincronizar'; producto: ProductoExistente; url: string }
  | { accion: 'indeterminado' }
  | { accion: 'no-existe' };

/**
 * Qué corresponde hacer con un código, cruzando lo que dice la base con lo que dice el
 * proveedor. Pura: no consulta nada, sólo decide.
 *
 * EL ORDEN DE LOS CHEQUEOS IMPORTA. `indeterminado` se resuelve PRIMERO y no depende de
 * `producto`: el proveedor devuelve HTTP 200 en todo (ver `presencia.ts`), así que
 * "no se pudo saber" nunca es una ausencia disfrazada, sea cual sea el estado de la
 * base. Tratarlo como ausente marcaría como bajas productos que el proveedor sigue
 * publicando, sólo porque tuvo un mal minuto.
 */
export function clasificar(
  producto: ProductoExistente | null,
  presencia: ResultadoPresencia
): Clasificacion {
  if (presencia.presencia === 'indeterminado') return { accion: 'indeterminado' };

  const enPapelera = producto !== null && producto.estado === 'eliminado';

  if (presencia.presencia === 'ausente') {
    // NO se restaura ni se borra: el barrido ya decidió que las bajas las saca una
    // persona (§12.1) y acá no hay ninguna razón para tratarlo distinto.
    return enPapelera ? { accion: 'sigue-en-papelera', producto: producto! } : { accion: 'no-existe' };
  }

  // A partir de acá `presencia.presencia === 'presente'`, y el contrato de
  // `consultarPresencia` es que en ese caso siempre viene la URL de la ficha.
  if (!presencia.url) {
    throw new Error(
      `El proveedor dice "presente" para ${presencia.codigo} sin ficha: contrato roto de consultarPresencia().`
    );
  }
  const url = presencia.url;

  if (producto === null) return { accion: 'alta', url };
  if (enPapelera) return { accion: 'restaurar', producto, url };
  return { accion: 'resincronizar', producto, url };
}

// --------------------------------------------------------------------------
// La ficha del proveedor, lista para registrarFicha()
// --------------------------------------------------------------------------

/**
 * Traduce lo que extrajo `extraerFicha()` a lo que necesita `registrarFicha()`. Pura:
 * es exactamente el mismo cálculo que hace `/api/scrape/ficha`, separado para poder
 * testearlo sin `HTMLRewriter` — que no existe en Node — y para no repetirlo a mano acá.
 */
export function fichaParaRegistro(ficha: FichaExtraida): FichaParaRegistrar {
  const porColor = fotosPorColor(ficha);

  return {
    codigo: ficha.codigo,
    urlOrigen: ficha.url,
    // El origen no expone la categoría por este camino (§5.4b), igual que en el scrape.
    categoriaOrigen: null,
    colores: [
      {
        colorOrigen: ficha.colorOrigen,
        url: ficha.url,
        cantidadDeFotos: cuantasFotosDeColor(ficha, porColor, ficha.colorOrigen),
      },
      ...ficha.hermanos.map((h) => ({
        colorOrigen: h.colorOrigen,
        url: h.url,
        cantidadDeFotos: cuantasFotosDeColor(ficha, porColor, h.colorOrigen),
      })),
    ],
    medidas: ficha.medidas,
  };
}

// --------------------------------------------------------------------------
// El worklist: qué tocó esta corrida
// --------------------------------------------------------------------------

export interface ProductoDeCorrida {
  id: number;
  codigo: string;
  nombre: string | null;
  /**
   * YA NO distingue un alta de una restauración: `restaurar()` (`papelera.ts`) deja
   * TODO en `importado` —para que cualquier restauración pase por «Por aprobar», sin
   * excepción— así que un `creado` y un `restaurado` quedan con el MISMO estado.
   *
   * Quien necesite separar unos de otros —el worklist de esta pantalla, por
   * ejemplo— tiene que hacerlo por el `desenlace` de `resolverCodigo()` (`creado` vs
   * `restaurado`), nunca por esta columna. Se mantiene igual porque sigue siendo un
   * dato útil: es lo que distingue el resincronizado —que no aparece en ningún
   * worklist— de los otros dos.
   */
  estado: string;
}

/**
 * Los productos que tocó esta corrida, sin ninguna tabla nueva: `registrarFicha()` ya
 * deja `scrape_id` en cada fila que toca, así que "lo que repuso esta corrida" es
 * exactamente esta consulta.
 */
export async function productosDeCorrida(
  ejecutar: Ejecutar,
  scrapeId: number
): Promise<ProductoDeCorrida[]> {
  return ejecutar<ProductoDeCorrida>(
    `SELECT id, codigo, nombre, estado FROM productos WHERE scrape_id = ? ORDER BY codigo`,
    [scrapeId]
  );
}

// --------------------------------------------------------------------------
// resolverCodigo: el orquestador de un solo código
// --------------------------------------------------------------------------

export type DesenlaceReposicion =
  | 'invalido'
  | 'restaurado'
  | 'sigue-en-papelera'
  | 'creado'
  | 'resincronizado'
  | 'indeterminado'
  | 'no-existe'
  | 'error';

export interface ResultadoReposicion {
  /** La forma canónica, salvo en `invalido`, donde es lo que la persona tipeó. */
  codigo: string;
  desenlace: DesenlaceReposicion;
  /** En castellano: es lo que se muestra en la pantalla. */
  motivo: string;
  productoId?: number;
  /** La ficha que se intentó bajar. Sólo presente cuando `desenlace === 'error'`. */
  url?: string;
  /**
   * Las fotos de la ficha, repartidas por color — exactamente lo que ya devuelve
   * `/api/scrape/ficha` (§8.1), y por el mismo motivo: acá NO se baja ni se sube
   * ninguna foto, sólo se registra la ficha. Bajar, derivar con `<canvas>` y subir es
   * trabajo de navegador, así que la pestaña necesita esta lista para pedirlas con
   * `traerFotos()`.
   *
   * Sólo presente cuando se llegó a bajar y registrar una ficha (`creado`,
   * `restaurado`, `resincronizado`): en cualquier otro desenlace no hay ficha de la
   * que sacar fotos.
   */
  colores?: FotosDeColor[];
}

/**
 * La cortesía real entre las dos llamadas al proveedor que puede hacer UN código:
 * la búsqueda de presencia y, si corresponde, la ficha. Mismo segundo que el resto
 * del scrape (§7.4, `PASO_MS`), y con el mismo nombre y forma que el `cortesia` que
 * ya usan `importar-cliente.ts` y `reposicion-cliente.ts` — es la MISMA idea, sólo
 * que del lado del servidor no hay un «último pedido» que recordar entre invocaciones:
 * cada `resolverCodigo` es una sola, así que alcanza con esperar una vez.
 */
async function cortesiaReal(): Promise<void> {
  await new Promise((listo) => setTimeout(listo, PASO_MS));
}

/** Colaboradores inyectables, para testear sin red ni `HTMLRewriter`. */
export interface ColaboradoresReposicion {
  buscarProducto?: typeof buscarPorCodigo;
  consultarPresencia?: (codigo: string) => Promise<ResultadoPresencia>;
  /** La espera entre `consultarPresencia` y `extraerFicha`. Inyectable para que los
   *  tests no duerman de verdad. */
  cortesia?: () => Promise<void>;
  extraerFicha?: (url: string) => Promise<FichaExtraida>;
  registrarFicha?: typeof registrarFicha;
  restaurar?: typeof restaurar;
}

/**
 * Resuelve un código: lo busca en la base y en el proveedor, clasifica, y aplica lo que
 * corresponda. Nunca lanza — cada desenlace, incluido el error de red, es un resultado.
 *
 * EL ORDEN "RESTAURAR PRIMERO" ES A PROPÓSITO Y ES AUTOCURATIVO. Si `extraerFicha()`
 * falla DESPUÉS de que `restaurar()` ya corrió, el producto queda restaurado igual — y
 * está bien que así sea: `restaurar()` es idempotente (§papelera.ts) y reintentar este
 * mismo código lo va a encontrar `publicado`, así que la segunda vuelta pasa por
 * "resincronizar" y jamás intenta restaurar de nuevo lo que ya no está en la papelera.
 * Ningún reintento se pierde, y ninguno repite trabajo que ya quedó hecho.
 *
 * DOS PEDIDOS AL PROVEEDOR, UNA CORTESÍA DE MÁS. La cortesía del CLIENTE (§7.4)
 * espacía un `/api/reposicion/codigo` del siguiente, pero no ve lo que pasa DENTRO de
 * uno: si este código termina en alta, restaurar o resincronizar, `consultar()` y
 * `extraer()` son dos pedidos al proveedor por la misma invocación, y sin nada en el
 * medio saldrían en el mismo instante. Por eso `cortesiaReal()` corre entre las dos —
 * y sólo cuando la segunda llamada existe: `ausente`, `indeterminado` e `invalido` no
 * llegan nunca a `extraerFicha()`, así que no tienen nada que espaciar.
 */
export async function resolverCodigo(
  ejecutar: Ejecutar,
  codigoOriginal: string,
  { scrapeId, ahora }: { scrapeId: number; ahora: string },
  colaboradores: ColaboradoresReposicion = {}
): Promise<ResultadoReposicion> {
  const {
    buscarProducto = buscarPorCodigo,
    consultarPresencia: consultar = consultarPresencia,
    cortesia: esperar = cortesiaReal,
    extraerFicha: extraer = extraerFicha,
    registrarFicha: registrar = registrarFicha,
    restaurar: restaurarFn = restaurar,
  } = colaboradores;

  let codigo: string;
  try {
    codigo = normalizarCodigo(codigoOriginal);
  } catch (error) {
    return {
      codigo: codigoOriginal,
      desenlace: 'invalido',
      motivo: error instanceof Error ? error.message : String(error),
    };
  }

  const [producto, presencia] = await Promise.all([buscarProducto(ejecutar, codigo), consultar(codigo)]);
  const clasificacion = clasificar(producto, presencia);

  switch (clasificacion.accion) {
    case 'indeterminado':
      return { codigo, desenlace: 'indeterminado', motivo: presencia.motivo };

    case 'no-existe':
      return {
        codigo,
        desenlace: 'no-existe',
        motivo: 'No existe en el catálogo ni lo publica el proveedor: puede ser un error de tipeo.',
      };

    case 'sigue-en-papelera':
      return {
        codigo,
        desenlace: 'sigue-en-papelera',
        motivo: 'El proveedor ya no lo publica: se queda en la papelera.',
      };

    case 'alta':
    case 'restaurar':
    case 'resincronizar': {
      if (clasificacion.accion === 'restaurar') {
        await restaurarFn(ejecutar, [clasificacion.producto.id], { ahora });
      }

      // La cortesía entre los dos pedidos al proveedor de este código. `restaurar()`
      // es una escritura en D1, no un pedido al proveedor, así que da igual si corre
      // antes o después de la espera — va antes porque es la escritura que no puede
      // perderse si algo más abajo falla.
      await esperar();

      let ficha: FichaExtraida;
      try {
        ficha = await extraer(clasificacion.url);
      } catch (error) {
        return {
          codigo,
          desenlace: 'error',
          motivo: error instanceof Error ? error.message : String(error),
          url: clasificacion.url,
        };
      }

      const registro = await registrar(ejecutar, fichaParaRegistro(ficha), { scrapeId, ahora });
      // Mismo cálculo que usa `fichaParaRegistro` para `cantidadDeFotos`, repetido acá
      // porque es puro y barato: recalcularlo mantiene a `fichaParaRegistro` con una
      // sola responsabilidad —traducir la ficha— en vez de devolver dos cosas a la vez.
      const colores = fotosPorColor(ficha);

      if (clasificacion.accion === 'restaurar') {
        return {
          codigo,
          desenlace: 'restaurado',
          motivo: 'Restaurado desde la papelera, por aprobar: revisá el precio antes de que se vuelva a ver.',
          productoId: registro.productoId,
          colores,
        };
      }
      if (clasificacion.accion === 'alta') {
        return {
          codigo,
          desenlace: 'creado',
          motivo: 'Nuevo en el catálogo. Por aprobar: le falta nombre, categoría y precio.',
          productoId: registro.productoId,
          colores,
        };
      }
      return {
        codigo,
        desenlace: 'resincronizado',
        motivo: 'Ya estaba en el catálogo: se actualizó con lo que trae el proveedor.',
        productoId: registro.productoId,
        colores,
      };
    }
  }
}
