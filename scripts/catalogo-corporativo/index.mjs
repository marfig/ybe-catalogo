/**
 * PDF del catalogo corporativo -> src/data/regalos-empresariales.json
 *
 *   node scripts/catalogo-corporativo/index.mjs docs/CORP.pdf docs/CORP-II.pdf
 *   node scripts/catalogo-corporativo/index.mjs --dry-run docs/CORP.pdf
 *
 * POR QUE ESTE SCRIPT EXISTE. La seccion de regalos empresariales reproduce el
 * catalogo IMPRESO y no el de mostrador: secciones, orden, colores y medidas salen del
 * papel. Y salen del papel por un motivo concreto, no por prolijidad — los nombres de
 * color que trae el catalogo para estas fichas vienen rotos de la importacion: el
 * 8720780 tiene «Dp6», «Dp6 Negr/azul» y «Verd/gris Os» donde el impreso dice
 * «(3) NEGRO».
 *
 * CUANDO SE CORRE. Una vez por temporada, cuando llega un catalogo corporativo nuevo.
 * No hay pantalla en el panel para esto y es deliberado: el admin corre en Cloudflare y
 * no puede leer un PDF, y un formulario para editar de a una 112 fichas que se cargan
 * de una tirada no le sirve a nadie. Sacar un producto que se termino tampoco lo
 * necesita: basta desactivarlo en el panel como cualquier otro y la ficha corporativa
 * desaparece sola, porque `resolverSeleccion` descarta las entradas sin producto
 * activo.
 *
 * LA UNICA PIEZA CON E/S. `pdf.mjs` y `fichas.mjs` son puros y estan testeados.
 *
 * VALIDADO contra el catalogo 2026 (dos PDF, 112 fichas): 112 de 112 con colores y
 * medidas, 0 sin foto del negro resuelta, 5 secciones. Si una corrida futura no llega
 * a ese nivel de completitud, el script lo dice y no escribe.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { paginasConTexto } from './pdf.mjs';
import { esEncabezado, leerFicha, repartirEnAnclas } from './fichas.mjs';

const SALIDA = 'src/data/regalos-empresariales.json';
const CATALOGO = 'src/data/productos.json';

const ENSAYO = process.argv.includes('--dry-run');
const PDFS = process.argv.slice(2).filter((a) => !a.startsWith('--'));

if (PDFS.length === 0) {
  console.error(
    'Falta el PDF.\n' +
      '  node scripts/catalogo-corporativo/index.mjs docs/CORP.pdf [docs/CORP-II.pdf]\n\n' +
      'EL ORDEN DE LOS ARCHIVOS ES EL ORDEN IMPRESO: define el orden de las secciones y\n' +
      'el de las fichas dentro de cada una. Pasarlos al reves reordena la pagina publica.'
  );
  process.exit(1);
}

// --------------------------------------------------------------------------
// 1. PDF -> fichas impresas
// --------------------------------------------------------------------------
const fichas = [];
let seccion = null;

for (const ruta of PDFS) {
  const paginas = paginasConTexto(ruta);
  if (paginas.length === 0) {
    console.error(`\n${ruta}: no tiene capa de texto. ¿Es un escaneo? Pedi el PDF original.`);
    process.exit(1);
  }

  for (const fragmentos of paginas) {
    // Los titulos mandan HACIA ABAJO y cruzan de pagina: una seccion que arranca en la
    // pagina 10 sigue gobernando la 11, que no repite el titulo.
    const encabezados = fragmentos.filter(esEncabezado).sort((a, b) => b.y - a.y);
    const anclas = repartirEnAnclas(fragmentos);

    if (anclas.length === 0) {
      if (encabezados.length > 0) seccion = encabezados.at(-1).texto;
      continue;
    }

    for (const ancla of anclas) {
      const porEncima = encabezados.filter((h) => h.y >= ancla.y);
      if (porEncima.length > 0) seccion = porEncima.at(-1).texto;

      fichas.push({
        referencia: ancla.referencia,
        seccion,
        ...leerFicha(ancla.hijos.map((h) => h.texto)),
      });
    }
  }
}

// Una referencia repetida entre dos PDF: gana la primera aparicion, que es la que fija
// el orden impreso.
const vistas = new Set();
const unicas = fichas.filter((f) => (vistas.has(f.referencia) ? false : vistas.add(f.referencia)));

// --------------------------------------------------------------------------
// 2. Cruce con el catalogo
// --------------------------------------------------------------------------
const productos = JSON.parse(readFileSync(CATALOGO, 'utf8'));
const porReferencia = new Map();
for (const p of productos) {
  if (p.origen?.ref) porReferencia.set(String(p.origen.ref), p);
}

/**
 * El SKU de una variante es `<ref>-<codigo>` y a veces `<ref>-<codigo>-<nombre>`.
 *
 * SE EXIGE LIMITE DE SEGMENTO. Sin el, el codigo `3` matchea la variante `3-23` y la
 * ficha muestra la foto de otro color — un error que no rompe nada y que nadie nota
 * salvo mirando el producto real. La misma regla vive en `src/lib/corporativo.ts`, que
 * es quien la aplica al renderizar; aca se usa solo para avisar si alguna ficha se
 * quedaria sin foto del negro.
 */
function variantePorCodigo(producto, referencia, codigo) {
  const clave = `${referencia}-${codigo}`.toLowerCase();
  const variantes = producto.variantes ?? [];
  return (
    variantes.find((v) => String(v.sku).toLowerCase() === clave) ??
    variantes.find((v) => String(v.sku).toLowerCase().startsWith(`${clave}-`)) ??
    null
  );
}

const secciones = [];
const entradas = [];
const sinProducto = [];
const sinMedidas = [];
const sinColor = [];
const sinFotoNegra = [];

unicas.forEach((ficha, i) => {
  const producto = porReferencia.get(ficha.referencia);
  if (!producto) {
    sinProducto.push(ficha.referencia);
    return;
  }

  if (!secciones.includes(ficha.seccion)) secciones.push(ficha.seccion);
  if (!ficha.medidas) sinMedidas.push(ficha.referencia);
  if (ficha.colores.length === 0) sinColor.push(ficha.referencia);

  // LA FOTO ES LA DEL NEGRO, que es el color de portada de casi toda la linea. Se
  // recorren los colores que el impreso nombra como negro, en su orden, y gana el
  // primero con foto cargada. Sin ninguno se omite el campo y la pagina cae a la foto
  // principal del producto.
  let fotoColor = null;
  for (const color of ficha.colores.filter((c) => /NEGRO/.test(c.nombre))) {
    const variante = variantePorCodigo(producto, ficha.referencia, color.codigo);
    if (variante && (variante.imagenes ?? []).length > 0) {
      fotoColor = color.codigo;
      break;
    }
  }
  if (!fotoColor) sinFotoNegra.push(ficha.referencia);

  const etiqueta = ficha.notas.find((n) => /^[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(n) && n.length > 3);

  entradas.push({
    id: producto.id,
    orden: i + 1,
    seccion: ficha.seccion,
    ordenSeccion: secciones.indexOf(ficha.seccion) + 1,
    codigo: ficha.referencia,
    medidas: ficha.medidas,
    consultarOtros: ficha.consultarOtros,
    ...(etiqueta ? { etiqueta } : {}),
    ...(fotoColor ? { fotoColor } : {}),
    colores: ficha.colores,
  });
});

// --------------------------------------------------------------------------
// 3. Reporte y escritura
// --------------------------------------------------------------------------
console.log(`\nleido: ${unicas.length} fichas en ${PDFS.length} PDF`);
console.log(`cruzado: ${entradas.length} con producto en el catalogo`);
console.log('\nsecciones, en el orden impreso:');
secciones.forEach((s, i) => {
  const cuantas = entradas.filter((e) => e.seccion === s).length;
  console.log(`  ${i + 1}. ${s}  (${cuantas})`);
});

const avisos = [
  ['sin producto en el catalogo', sinProducto],
  ['sin medidas', sinMedidas],
  ['sin ningun color', sinColor],
  ['sin foto del negro', sinFotoNegra],
];

const notas = new Set(unicas.flatMap((f) => f.notas));
if (notas.size > 0) {
  // SE IMPRIMEN SIEMPRE. Son las lineas que no cayeron en color, medidas ni rotulo: en
  // el catalogo 2026 fueron las etiquetas sueltas del impreso, pero es tambien donde
  // aparecera un dato nuevo que este script todavia no sabe leer.
  console.log('\nlineas sueltas (etiquetas del impreso, o datos que nadie supo leer):');
  for (const n of notas) console.log(`  ${JSON.stringify(n)}`);
}

let hayProblemas = false;
for (const [que, cuales] of avisos) {
  if (cuales.length === 0) continue;
  hayProblemas = true;
  console.log(`\n${cuales.length} ${que}: ${cuales.join(', ')}`);
}

if (hayProblemas) {
  console.log(
    '\nNO SE ESCRIBE NADA. El catalogo 2026 salio con cero de cada uno, asi que algo\n' +
      'cambio en el formato del PDF o el producto no esta cargado todavia. Revisar antes\n' +
      'de publicar una ficha a medias: una ficha sin medidas ni colores no se ve rota, se\n' +
      've vacia, y eso se descubre en produccion.'
  );
  process.exit(1);
}

if (ENSAYO) {
  console.log(`\nENSAYO: no se escribio ${SALIDA}.`);
} else {
  writeFileSync(SALIDA, `${JSON.stringify(entradas, null, 2)}\n`, 'utf8');
  console.log(`\nescrito: ${SALIDA} (${entradas.length} entradas)`);
}
