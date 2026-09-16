/**
 * Lectura del texto posicionado de un PDF, sin dependencias.
 *
 * NO HACE FALTA UNA LIBRERIA NI POPPLER. Los catalogos corporativos de Chenson son
 * PDF de Adobe con capa de texto real: fuentes con codificacion estandar y escapes
 * octales latin-1. Se inflan los `stream` con zlib y se leen los operadores de texto.
 * Meter `pdfjs` para esto seria arrastrar varios MB de dependencia por un parser de
 * cien lineas que ademas necesitariamos igual, porque lo que hace falta no es el texto
 * sino DONDE esta cada fragmento (ver `fichas.mjs`).
 *
 * Si algun dia llega un catalogo escaneado —imagen sin capa de texto— esto devuelve
 * paginas vacias y no hay parche posible: ahi si haria falta OCR, y conviene pedir el
 * PDF original en vez de reconocerlo.
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const OCTAL = /\\([0-7]{1,3})/g;
const SIMPLE = /\\([nrtbf()\\])/g;
const ESCAPES = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };

/** Deshace los escapes de una cadena literal de PDF. */
function desescapar(s) {
  return s
    .replace(OCTAL, (_, octal) => String.fromCharCode(parseInt(octal, 8)))
    .replace(SIMPLE, (_, c) => ESCAPES[c] ?? c);
}

/**
 * Los operadores que importan, en un solo barrido:
 *   [...] TJ   texto con kerning
 *   (...) Tj   texto suelto
 *   a b c d e f Tm   matriz de texto: fija posicion Y cuerpo de letra
 *   dx dy Td   desplazamiento relativo
 */
const OPERADORES = new RegExp(
  '(?:\\[((?:[^\\]\\\\]|\\\\.)*)\\]\\s*TJ)' +
    '|(?:\\(((?:[^)\\\\]|\\\\.)*)\\)\\s*Tj)' +
    '|(?:([-\\d.]+)\\s+([-\\d.]+)\\s+([-\\d.]+)\\s+([-\\d.]+)\\s+([-\\d.]+)\\s+([-\\d.]+)\\s+Tm)' +
    '|(?:([-\\d.]+)\\s+([-\\d.]+)\\s+Td)',
  'g'
);

/** Las cadenas dentro de un arreglo TJ. Los numeros de por medio son kerning. */
const LITERALES = /\(((?:[^)\\]|\\.)*)\)/g;

/**
 * Los fragmentos de texto de un flujo de contenido, con posicion y cuerpo de letra.
 *
 * EL CUERPO SALE DE LA MATRIZ `Tm`, no de una declaracion de fuente: es la escala
 * horizontal del texto, que es lo unico comparable entre fuentes distintas. Se usa
 * para distinguir un titulo de seccion de una etiqueta suelta (ver `esEncabezado`).
 */
export function fragmentosDeFlujo(contenido) {
  const fragmentos = [];
  let x = 0;
  let y = 0;
  let cuerpo = 0;
  let m;

  OPERADORES.lastIndex = 0;
  while ((m = OPERADORES.exec(contenido))) {
    if (m[3] !== undefined) {
      cuerpo = Math.abs(Number.parseFloat(m[3]));
      x = Number(m[7]);
      y = Number(m[8]);
      continue;
    }
    if (m[9] !== undefined) {
      x += Number(m[9]);
      y += Number(m[10]);
      continue;
    }

    let texto;
    if (m[1] !== undefined) {
      const partes = [];
      LITERALES.lastIndex = 0;
      let lit;
      while ((lit = LITERALES.exec(m[1]))) partes.push(desescapar(lit[1]));
      texto = partes.join('');
    } else {
      texto = desescapar(m[2]);
    }

    // LOS NUMEROS DE KERNING DE UN `TJ` SE DESCARTAN LEYENDO SOLO LO QUE ESTA ENTRE
    // PARENTESIS, y no limpiando digitos del resultado. Parece lo mismo y no lo es:
    // una referencia impresa ES un numero, asi que barrer digitos del texto armado
    // borra justo los `Ref.: 8130194` que este script existe para leer.
    if (texto.trim()) fragmentos.push({ x, y, cuerpo, texto: texto.trim() });
  }

  return fragmentos;
}

/**
 * Las paginas con texto de un PDF, cada una como lista de fragmentos posicionados.
 *
 * Se recorren TODOS los `stream` y se queda con los que inflan y contienen operadores
 * de texto: los que no inflan son imagenes (`DCTDecode`, o sea JPEG crudo) y los que
 * inflan sin texto son mascaras y trazados. No se lee la tabla de objetos del PDF
 * porque no hace falta: el orden de aparicion de los flujos ES el orden de las
 * paginas en estos archivos, y depender de la tabla obligaria a un parser real.
 */
export function paginasConTexto(ruta) {
  const bytes = readFileSync(ruta);
  const crudo = bytes.toString('latin1');
  const inicios = /stream\r?\n/g;
  const paginas = [];
  let m;

  while ((m = inicios.exec(crudo))) {
    const desde = m.index + m[0].length;
    const hasta = crudo.indexOf('endstream', desde);
    if (hasta < 0) continue;

    let inflado;
    try {
      inflado = inflateSync(bytes.subarray(desde, hasta));
    } catch {
      continue;
    }

    const contenido = inflado.toString('latin1');
    if (!/Tj|TJ/.test(contenido)) continue;

    paginas.push(fragmentosDeFlujo(contenido));
  }

  return paginas;
}
