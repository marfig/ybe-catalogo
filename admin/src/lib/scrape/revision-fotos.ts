/**
 * Los productos a los que hay que volver a mirarles la galería del proveedor.
 *
 * POR QUÉ EXISTE ESTO Y NO ALCANZA CON REIMPORTAR. El proveedor sirve la galería en DOS
 * rutas —`/Prelude-images/product/` la principal y `/Prelude-images/productimage/` las
 * adicionales— y el filtro de `verImagen` sólo reconocía la primera (ver `RUTAS_IMAGENES`).
 * Las adicionales se descartaban en silencio, así que todo lo que se importó hasta el
 * arreglo quedó con la foto principal y nada más. Medido: `8735032` tiene seis fotos en el
 * proveedor y entró con una.
 *
 * Arreglado el filtro, reimportar por la pantalla de siempre no los arregla: la importación
 * viene con «saltear los que ya tengo» tildada, y además se maneja por listados del
 * proveedor, no por «todos los que ya tengo». Esta consulta es la lista de trabajo, y el
 * relleno lo hacen `/api/scrape/ficha` más `traerFotos`: los dos pasos de la importación de
 * todos los días, sin ningún camino de escritura nuevo.
 *
 * POR QUÉ LA LISTA ES **TODO** EL CATÁLOGO DEL PROVEEDOR, y no un subconjunto. No hay
 * ninguna señal en la base que diga a quién le faltan fotos. `sinDescripcion` pregunta
 * `trim(descripcion) = ''` y `sinFotos` pregunta `NOT EXISTS(imagen)`: las dos tienen el
 * hueco a la vista. «Le faltan las adicionales» sólo lo sabe la ficha. Se probó el filtro
 * obvio —variantes con exactamente una foto— y no sirve: con el filtro viejo casi todas
 * quedaron con una, tanto las incompletas como las que de verdad tienen una sola.
 *
 * ES CÓDIGO DE UN SOLO USO, igual que `pendientes.ts`. Cuando la pasada termine, esta
 * función, su pantalla y su endpoint se borran; lo que se queda es `RUTAS_IMAGENES`, que es
 * lo que evita que el problema vuelva. Por eso la pantalla NO va enlazada desde el inicio.
 */
import { normalizarCodigo } from '../codigo.ts';
import type { Ejecutar } from '../grilla.ts';
import { TOLERANCIA_MINUTOS } from './corrida.ts';
import { PASO_MS } from './marcha.ts';

/**
 * Cuántos pedidos cuesta una ficha: la ficha más sus fotos.
 *
 * 3 fotos es el promedio del proveedor, el mismo supuesto con el que la pantalla estima la
 * duración. Es una estimación y por eso el tope lleva margen abajo.
 */
const PEDIDOS_POR_FICHA = 4;

/**
 * Cuánto de la tolerancia se usa. El resto es margen.
 *
 * Si la estimación se queda corta —un modelo con ocho fotos, el proveedor lento— la tajada
 * tarda más de lo previsto. Apurarla contra el límite exacto haría que el desborde fuera
 * lo normal y no la excepción.
 */
const MARGEN = 0.6;

/**
 * Cuántas fichas entran en UNA corrida sin pasarse de la tolerancia.
 *
 * ESTE ES EL NÚMERO QUE CIERRA EL AGUJERO. `corridaEnCurso` da por muerta una corrida más
 * vieja que `TOLERANCIA_MINUTOS`, así que un recorrido más largo que eso se queda sin
 * guarda a mitad de camino y una segunda pestaña puede duplicarle el tráfico al proveedor.
 * La pasada completa son ~60 minutos contra 30 de tolerancia, así que se corta en tajadas
 * y el cliente las encadena: ninguna corrida llega al límite.
 *
 * SE DERIVA, no se elige: si alguien cambia la tolerancia, el tope se acomoda solo.
 */
export const FICHAS_POR_CORRIDA = Math.floor(
  ((TOLERANCIA_MINUTOS * 60_000) / (PEDIDOS_POR_FICHA * PASO_MS)) * MARGEN
);

/** Un producto al que hay que volver a pedirle la ficha. */
export interface ParaRevisar {
  id: number;
  codigo: string;
  /** La ficha del proveedor. Es lo que recibe `/api/scrape/ficha`. */
  url: string;
}

export interface Opciones {
  /**
   * Último código ya revisado. Devuelve sólo los POSTERIORES.
   *
   * ES LO ÚNICO QUE HACE RETOMABLE ESTA PASADA, y hace falta porque —al revés que las otras
   * dos— no se vacía sola: revisar la galería de un producto no cambia nada que la consulta
   * pueda ver, así que al volver a entrar la lista está entera. Sin el corte, una corrida
   * interrumpida a los 40 minutos vuelve a empezar del principio.
   *
   * Se IGNORA cuando vienen `codigos`: una prueba a mano no es progreso de la pasada.
   */
  desde?: string;

  /**
   * Un puñado de códigos elegidos a mano. Si viene, la lista son EXACTAMENTE esos.
   *
   * POR QUÉ EXISTE. La pasada completa son ~40 minutos contra el catálogo entero, y es la
   * primera vez que corre. Antes de largar eso conviene verla sobre los cuatro códigos
   * donde el problema se midió: si ahí aparecen las fotos que faltaban, la corrida larga se
   * lanza sabiendo lo que va a hacer. Y se prueba contra los datos DE VERDAD, que es lo que
   * una siembra local no puede dar.
   *
   * UN ARREGLO VACÍO SIGNIFICA **NADA**, NUNCA «TODO». Ver la nota en `condiciones`.
   */
  codigos?: string[];

  /**
   * Cuántas fichas devolver como máximo. Es el tamaño de la tajada.
   *
   * Ver `FICHAS_POR_CORRIDA`: existe para que ninguna corrida pase la tolerancia con la que
   * `corridaEnCurso` la da por muerta. Sin tope se devuelve todo — el tope es una decisión
   * de quien llama y no un default escondido, porque los tests y el conteo lo necesitan sin.
   */
  tope?: number;
}

/**
 * El texto del campo de la pantalla, partido en códigos.
 *
 * Separa por coma, punto y coma, espacios y saltos de línea: se pega desde una planilla,
 * desde un chat o a mano, y exigir un formato sería una trampa — el síntoma de un separador
 * no soportado es «no encontró ninguno», que no señala la causa.
 *
 * NO VALIDA: eso es de `codigosPedidos`. Acá sólo se parte, así que la validación vive en un
 * solo lado. Un texto vacío devuelve un arreglo vacío, y eso es lo que la pantalla usa para
 * no largar nada.
 */
export function partirCodigos(texto: string): string[] {
  return (texto ?? '')
    .split(/[\s,;]+/)
    .map((c) => c.trim())
    .filter((c) => c !== '');
}

/**
 * Los códigos pedidos, normalizados, sin repetir y sin los ilegibles.
 *
 * Se exporta porque el endpoint la necesita para lo mismo que la consulta: comparando lo
 * pedido contra lo devuelto sabe QUÉ CÓDIGO NO APARECIÓ, y sin eso un código mal tipeado se
 * ve igual que uno que ya estaba completo.
 *
 * NO LANZA ante un código ilegible: se descarta. El texto se pega a mano en un campo, y un
 * `#` colado no puede costar la prueba de los otros tres.
 */
export function codigosPedidos(codigos: string[]): string[] {
  const vistos = new Set<string>();

  for (const crudo of codigos ?? []) {
    if ((crudo ?? '').trim() === '') continue;
    try {
      vistos.add(normalizarCodigo(crudo));
    } catch {
      /* un código que no tiene forma de código no se busca */
    }
  }

  return [...vistos];
}

/**
 * A quién volver a pedirle la ficha.
 *
 * LAS TRES EXCLUSIONES, las mismas que `sinFotos` y `sinDescripcion`, por los mismos
 * motivos:
 *
 *   `proveedor = 'chenson'` — los `manual` no salieron de ningún origen, y los
 *                        `catalogo-viejo` son EXACTAMENTE los que el proveedor ya no
 *                        publica: pedirles la ficha traería una página que no existe. Y
 *                        tampoco sufren el bug: la migración del catálogo viejo se traía
 *                        TODAS las fotos, que venían de la API de Parse y no de la galería.
 *   `estado <> 'eliminado'` — ya se decidió sacarlos del catálogo. Si alguno se restaura,
 *                        vuelve a aparecer en esta lista solo.
 *   `url_origen` con algo — sin ficha no hay nada que pedir. Incluirlos daría un error por
 *                        producto, sobre algo que esto no puede resolver.
 *
 * INCLUYE LOS PUBLICADOS a propósito, igual que las otras dos: un producto en la calle al
 * que le falten cinco fotos es el que más importa, porque es el que un cliente está
 * mirando. Y no pisa nada — lo único que se agrega son vínculos de fotos nuevas.
 *
 * Ordenado por código, que es estable entre corridas. Ese orden es lo que le da sentido a
 * `desde`: sin un orden fijo, «seguir desde acá» saltearía productos distintos cada vez.
 */
export async function paraRevisarFotos(
  ejecutar: Ejecutar,
  opciones: Opciones = {}
): Promise<ParaRevisar[]> {
  const filtro = condiciones(opciones);
  if (!filtro) return [];

  /**
   * `LIMIT` sólo si el tope sirve. Cero o negativo saldría de un cálculo mal hecho, no de
   * una intención, y `LIMIT 0` devolvería una lista vacía: la pantalla diría «no queda nada
   * por revisar» y la pasada terminaría sin hacer nada, reportando éxito. Esa falla no deja
   * rastro, así que un tope inservible se ignora.
   */
  const tope = topeUsable(opciones.tope);

  return ejecutar<ParaRevisar>(
    `SELECT id, codigo, url_origen AS url FROM productos ${filtro.sql} ORDER BY codigo${tope ? ' LIMIT ?' : ''}`,
    tope ? [...filtro.params, tope] : filtro.params
  );
}

/**
 * Cuántas fichas quedan por revisar EN TOTAL, sin el tope de la tajada.
 *
 * POR QUÉ APARTE DE LA LISTA. Con tajadas, el largo de la lista es el tamaño de la tajada y
 * no el del trabajo: la barra de progreso mediría la tajada y llegaría al 100% tres veces.
 * Y sobre todo, es lo único que permite decir «se revisaron N de M»: sin ese contraste, un
 * marcador corrupto que salteó un tramo del catálogo termina anunciando «revisado entero».
 */
export async function contarParaRevisar(
  ejecutar: Ejecutar,
  opciones: Opciones = {}
): Promise<number> {
  const filtro = condiciones(opciones);
  if (!filtro) return 0;

  const [fila] = await ejecutar<{ n: number }>(
    `SELECT count(*) AS n FROM productos ${filtro.sql}`,
    filtro.params
  );
  return fila?.n ?? 0;
}

/** Un tope que sirve para un `LIMIT`, o `null` si lo que llegó no es un entero positivo. */
function topeUsable(tope: number | undefined): number | null {
  if (tope === undefined) return null;
  return Number.isInteger(tope) && tope > 0 ? tope : null;
}

/**
 * El `WHERE` compartido por la lista y el conteo. `null` significa «nada, y sin consultar».
 *
 * LOS DOS TIENEN QUE FILTRAR IGUAL. Si contaran distinto, la barra nunca llegaría al final
 * y el resumen mentiría sobre cuánto se revisó — que es justo el dato que existe para
 * delatar un tramo salteado.
 *
 * LAS TRES EXCLUSIONES valen para los dos modos: pedir un código a mano no habilita nada.
 */
function condiciones({
  desde,
  codigos,
}: Opciones): { sql: string; params: (string | number)[] } | null {
  const BASE = `WHERE proveedor = 'chenson'
        AND estado <> 'eliminado'
        AND trim(COALESCE(url_origen, '')) <> ''`;

  /**
   * MODO PRUEBA: exactamente los códigos pedidos.
   *
   * `codigos !== undefined` y no `codigos?.length`: LA DIFERENCIA ENTRE «NO ME PASARON EL
   * PARÁMETRO» Y «ME LO PASARON VACÍO» ES TODA LA DIFERENCIA ACÁ. Un campo vacío en la
   * pantalla manda un arreglo vacío, y si eso cayera en el camino de la lista completa, un
   * click de prueba largaría la corrida sobre el catálogo entero contra producción. Vacío
   * devuelve nada, y se corta antes de consultar.
   */
  if (codigos !== undefined) {
    const pedidos = codigosPedidos(codigos);
    if (pedidos.length === 0) return null;

    const huecos = pedidos.map(() => '?').join(', ');
    return {
      // `upper(codigo)` igual que el índice único de la migración 0002: la collation por
      // defecto de SQLite es BINARY, así que un `IN (…)` pelado no encontraría `cg85700`.
      sql: `${BASE} AND upper(codigo) IN (${huecos})`,
      params: pedidos,
    };
  }

  /**
   * El marcador se normaliza igual que un código escrito a mano: viaja por la red y vuelve
   * como lo mande el cliente. Comparar sin normalizar dejaría pasar de nuevo lo ya hecho.
   *
   * Un valor que no tiene forma de código se trata como «desde el principio» y no como un
   * error: es lo mismo que no mandar nada, y hacer fallar la pasada entera por un marcador
   * ilegible sería peor que repetir unos minutos de trabajo idempotente.
   */
  let corte = '';
  if ((desde ?? '').trim() !== '') {
    try {
      corte = normalizarCodigo(desde!);
    } catch {
      corte = '';
    }
  }

  return { sql: `${BASE} AND (? = '' OR upper(codigo) > ?)`, params: [corte, corte] };
}
