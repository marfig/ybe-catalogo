import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CUERPO_MINIMO_DE_TITULO,
  REFERENCIA,
  esEncabezado,
  leerFicha,
  repartirEnAnclas,
} from '../fichas.mjs';
import { fragmentosDeFlujo } from '../pdf.mjs';

/**
 * Tests del lector del catalogo corporativo impreso.
 *
 * LOS PDF NO ESTAN EN EL REPO: son material de temporada y se borran despues de usar.
 * Por eso los fixtures son fragmentos sinteticos con la MISMA forma que devuelve
 * `pdf.mjs` — posicion, cuerpo y texto. Es lo que permite defender el comportamiento
 * sin el archivo original.
 *
 * Lo que se defiende aca es lo que se rompe EN SILENCIO: un color asignado a la ficha
 * de al lado o unas medidas robadas al vecino no tiran ningun error, salen publicadas.
 */

/** Un fragmento como los que produce `pdf.mjs`. */
function frag(texto, x, y, cuerpo = 8) {
  return { x, y, cuerpo, texto };
}

// --------------------------------------------------------------------------
// Lectura del texto: el kerning no puede comerse las referencias
// --------------------------------------------------------------------------

test('un arreglo TJ conserva los digitos del texto y descarta el kerning', () => {
  // Asi imprime Adobe una referencia: la cadena partida y numeros de ajuste entre medio.
  const flujo = '1 0 0 1 100 700 Tm\n[(Ref.: 813)-20(0194)]TJ';
  const [f] = fragmentosDeFlujo(flujo);

  assert.equal(f.texto, 'Ref.: 8130194');
  assert.equal(f.texto.match(REFERENCIA)[1], '8130194');
});

test('el cuerpo de letra sale de la escala horizontal de la matriz Tm', () => {
  const flujo = '29.6 0 0 29.6 50 800 Tm\n(MOCHILAS)Tj';
  const [f] = fragmentosDeFlujo(flujo);

  assert.equal(f.cuerpo, 29.6);
  assert.equal(f.x, 50);
  assert.equal(f.y, 800);
});

// --------------------------------------------------------------------------
// Titulos de seccion contra etiquetas sueltas
// --------------------------------------------------------------------------

test('distingue un titulo de seccion de una etiqueta suelta por el cuerpo', () => {
  // Las dos son mayusculas sin parentesis: por forma son indistinguibles.
  assert.equal(esEncabezado(frag('MOCHILAS', 50, 800, 29.6)), true);
  assert.equal(esEncabezado(frag('MOCHILA TÉRMICA', 300, 400, 8.5)), false);
});

test('no toma por titulo una linea con referencia ni una con codigo de color', () => {
  assert.equal(esEncabezado(frag('REF.: 8130194', 50, 800, 29.6)), false);
  assert.equal(esEncabezado(frag('(3) NEGRO', 50, 800, 29.6)), false);
});

test('el umbral de cuerpo deja fuera lo que esta justo por debajo', () => {
  assert.equal(esEncabezado(frag('PORTAFOLIOS', 50, 800, CUERPO_MINIMO_DE_TITULO)), true);
  assert.equal(esEncabezado(frag('PORTAFOLIOS', 50, 800, CUERPO_MINIMO_DE_TITULO - 0.1)), false);
});

// --------------------------------------------------------------------------
// El reparto en columnas: el corazon del script
// --------------------------------------------------------------------------

test('dos fichas lado a lado no se mezclan aunque compartan renglon', () => {
  // Maqueta real: dos columnas, mismo alto. Leido por altura, los cuatro datos del
  // medio salen entreverados.
  const fragmentos = [
    frag('Ref.: 8130194', 60, 700),
    frag('Ref.: 8130195', 320, 700),
    frag('(3) NEGRO', 60, 680),
    frag('(2) GRIS', 320, 680),
    frag('49 x 36 x 19 cm', 60, 660),
    frag('50 x 35 x 21 cm', 320, 660),
  ];

  const anclas = repartirEnAnclas(fragmentos);
  const porRef = Object.fromEntries(anclas.map((a) => [a.referencia, a.hijos.map((h) => h.texto)]));

  assert.deepEqual(porRef['8130194'], ['(3) NEGRO', '49 x 36 x 19 cm']);
  assert.deepEqual(porRef['8130195'], ['(2) GRIS', '50 x 35 x 21 cm']);
});

test('una ficha no se roba el texto de la que tiene encima', () => {
  // La de abajo esta mas cerca en horizontal, pero su texto quedo por ARRIBA de ella.
  const fragmentos = [
    frag('Ref.: 1111111', 60, 700),
    frag('44 x 30 x 12 cm', 60, 690),
    frag('Ref.: 2222222', 60, 600),
    frag('45 x 31 x 15 cm', 60, 590),
  ];

  const anclas = repartirEnAnclas(fragmentos);
  const porRef = Object.fromEntries(anclas.map((a) => [a.referencia, a.hijos.map((h) => h.texto)]));

  assert.deepEqual(porRef['1111111'], ['44 x 30 x 12 cm']);
  assert.deepEqual(porRef['2222222'], ['45 x 31 x 15 cm']);
});

test('una pagina sin referencias no devuelve anclas', () => {
  assert.deepEqual(repartirEnAnclas([frag('MOCHILAS', 50, 800, 29.6)]), []);
});

// --------------------------------------------------------------------------
// Lectura de la ficha
// --------------------------------------------------------------------------

test('lee color de portada, alternativos, medidas y el aviso de otros colores', () => {
  const ficha = leerFicha([
    'Color (3) NEGRO',
    'También disponible en:',
    '(2) GRIS',
    '(R1) ROJO/GRIS',
    'Consulte los demás colores.',
    'Medidas aprox.:',
    '(alto x largo x ancho)',
    '49 x 36 x 19 cm',
  ]);

  assert.equal(ficha.medidas, '49 x 36 x 19');
  assert.equal(ficha.consultarOtros, true);
  assert.deepEqual(ficha.colores, [
    { codigo: '3', nombre: 'NEGRO', alternativo: false },
    { codigo: '2', nombre: 'GRIS', alternativo: true },
    { codigo: 'R1', nombre: 'ROJO/GRIS', alternativo: true },
  ]);
});

test('«(alto x largo x ancho)» es un rotulo y no un color', () => {
  // Tiene la forma exacta de un codigo entre parentesis: si se lee como color, TODA
  // ficha del catalogo se publica con un color inventado.
  const ficha = leerFicha(['(alto x largo x ancho)', '45 x 31 x 15 cm']);

  assert.deepEqual(ficha.colores, []);
  assert.equal(ficha.medidas, '45 x 31 x 15');
});

test('un segundo color sin rotulo de por medio igual queda como alternativo', () => {
  const ficha = leerFicha(['Color (33) NEGRO/NEGRO', '(62) AZUL/GRIS']);

  assert.deepEqual(
    ficha.colores.map((c) => c.alternativo),
    [false, true]
  );
});

test('se queda con las primeras medidas y no con las de la ficha siguiente', () => {
  const ficha = leerFicha(['48,5 x 34 x 17cm', '45 x 31 x 13,5 cm']);
  assert.equal(ficha.medidas, '48,5 x 34 x 17');
});

test('el codigo de color se normaliza a mayusculas', () => {
  assert.equal(leerFicha(['(r1) ROJO/GRIS']).colores[0].codigo, 'R1');
});

test('lo que no es color, medida ni rotulo se guarda en notas en vez de perderse', () => {
  const ficha = leerFicha(['Porta notebook', 'Color (3) NEGRO', '47 x 34 x 22 cm']);

  assert.deepEqual(ficha.notas, ['Porta notebook']);
  assert.equal(ficha.colores.length, 1);
});

test('una ficha vacia no inventa datos', () => {
  const ficha = leerFicha([]);

  assert.deepEqual(ficha.colores, []);
  assert.deepEqual(ficha.notas, []);
  assert.equal(ficha.medidas, null);
  assert.equal(ficha.consultarOtros, false);
});
