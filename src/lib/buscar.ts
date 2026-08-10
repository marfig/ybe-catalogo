/**
 * Búsqueda del sitio público, del lado del cliente (SPEC §9.4, SPEC-etapa2 §5.3).
 *
 * PIEZA PURA. Recibe el índice ya cargado y una consulta, y devuelve resultados
 * ordenados. No conoce el DOM, ni la red, ni Preact: la isla que la usa es un
 * envoltorio. Así la parte que decide qué encuentra qué se prueba con `node --test`.
 *
 * EL CASO CENTRAL MANDA. Un cliente pregunta por WhatsApp citando el CÓDIGO —«tenés la
 * CG85527?»— y ese es el uso que ordena todo lo de acá: el código gana sobre el nombre,
 * un pedazo de código alcanza, y las mayúsculas no importan.
 *
 * No hay endpoint de búsqueda ni índice remoto: el sitio es `output: 'static'` y montar
 * un servidor para esto rompería esa propiedad (§9.4).
 */

/** Una entrada del índice de `/indice.json`. Las claves son cortas: van 1.500 veces. */
export interface EntradaIndice {
  /** Slug del producto. Es su URL. */
  i: string;
  /** Nombre. */
  n: string;
  /** Código del proveedor. La identidad de negocio (§5.3). */
  k: string;
  /** Precio en guaraníes, o `null` para «Consultar». */
  p: number | null;
  /** Slugs de categoría. */
  c: string[];
  /** hash16 de la primera foto, o `null`. */
  t: string | null;
}

/** Tope de resultados que se muestran. Ver el test que lo fija. */
const MAXIMO = 20;

/**
 * Forma comparable de un texto: sin acentos, sin eñes, sin mayúsculas.
 *
 * NO ES UN DETALLE EN CASTELLANO. Nadie escribe «riñonera» con eñe desde el buscador de
 * un teléfono apurado, ni pone los acentos. Si «rinonera» no encuentra «Riñonera», el
 * producto existe y la persona concluye que no lo tenemos — que es el peor resultado
 * posible para un catálogo.
 *
 * `NFD` separa la letra de su tilde y el rango `̀-ͯ` borra las tildes
 * sueltas. La eñe sale por el mismo camino: `ñ` = `n` + tilde.
 */
export function normalizar(texto: string): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Puntaje de una entrada, o `null` si no corresponde.
 *
 * Menor es mejor. Los tramos están separados para que ninguna coincidencia de nombre
 * pueda colarse entre dos de código: si alguien escribe algo que es a la vez un código
 * y parte de un nombre, lo que quiso es el código — es un identificador, no una
 * descripción.
 */
function puntaje(entrada: EntradaIndice, consulta: string, palabras: string[]): number | null {
  const codigo = normalizar(entrada.k);

  if (codigo === consulta) return 0;
  if (codigo.startsWith(consulta)) return 1;
  if (codigo.includes(consulta)) return 2;

  /**
   * Por nombre: TODAS las palabras tienen que estar. Con OR, «mochila roja» traería
   * todas las mochilas y la persona concluye que el buscador no filtra. Con AND, no
   * traer nada es información: eso no existe.
   *
   * Coincidencia por substring y no por palabra completa porque se busca MIENTRAS se
   * tipea: «cart» ya tiene que mostrar carteras.
   */
  const nombre = normalizar(entrada.n);
  if (palabras.length > 0 && palabras.every((p) => nombre.includes(p))) return 3;

  return null;
}

/**
 * Los productos que coinciden, ordenados por relevancia y acotados.
 *
 * El tope es del RENDER y no de la búsqueda: sin él, escribir «a» sobre 1.500 productos
 * pinta 1.500 nodos mientras se tipea. Quien quiera menos resultados, escribe más.
 *
 * El desempate por slug no es cosmético: sin un criterio total, dos entradas con el
 * mismo puntaje pueden intercambiarse entre teclas y el ojo pierde el item que estaba
 * por tocar.
 */
export function buscar(indice: EntradaIndice[], consulta: string): EntradaIndice[] {
  /**
   * Los símbolos se descartan de la consulta, no de los datos. Pegar desde WhatsApp
   * trae comillas, guiones y saltos; el código y el nombre guardados están limpios.
   */
  const limpia = normalizar(consulta).replace(/[^\p{L}\p{N}\s]+/gu, ' ').trim().replace(/\s+/g, ' ');
  if (limpia === '') return [];

  const palabras = limpia.split(' ').filter(Boolean);
  // La consulta sin espacios: un código se escribe de corrido, y así «cg 85527» también
  // encuentra `CG85527`.
  const comoCodigo = limpia.replace(/\s+/g, '');

  const conPuntaje: Array<{ entrada: EntradaIndice; p: number }> = [];
  for (const entrada of indice) {
    const p = puntaje(entrada, comoCodigo, palabras);
    if (p !== null) conPuntaje.push({ entrada, p });
  }

  conPuntaje.sort((a, b) => a.p - b.p || a.entrada.i.localeCompare(b.entrada.i, 'es'));

  return conPuntaje.slice(0, MAXIMO).map((x) => x.entrada);
}
