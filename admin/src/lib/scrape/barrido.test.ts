import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AVANCE_INICIAL,
  interpretarPostDeBarrido,
  porcentaje,
  restoDelBarrido,
  revisados,
  sumar,
  textoDeBarrido,
} from './barrido.ts';

const avanceDe = (...presencias: Array<'presente' | 'ausente' | 'indeterminado'>) =>
  presencias.reduce((a, p) => sumar(a, p), { ...AVANCE_INICIAL, total: 10 });

test('suma cada respuesta en su columna', () => {
  const a = avanceDe('presente', 'presente', 'ausente', 'indeterminado');

  assert.equal(a.presentes, 2);
  assert.equal(a.ausentes, 1);
  assert.equal(a.indeterminados, 1);
  assert.equal(revisados(a), 4);
});

test('no muta el avance que recibe', () => {
  const antes = { ...AVANCE_INICIAL, total: 10 };
  sumar(antes, 'ausente');
  assert.equal(antes.ausentes, 0);
});

test('el porcentaje cuenta los indeterminados como recorridos', () => {
  /**
   * La barra mide CUÁNTO FALTA DEL RECORRIDO, no cuántas respuestas fueron útiles. Un
   * producto que no se pudo resolver ya se pidió y no se vuelve a pedir en esta
   * corrida: dejarlo afuera haría una barra que nunca llega al final.
   */
  assert.equal(porcentaje(avanceDe('indeterminado', 'indeterminado')), 20);
});

test('un total en cero no rompe la barra', () => {
  // Sin catálogo que barrer no hay division: sin este corte la barra desaparece con NaN.
  assert.equal(porcentaje(AVANCE_INICIAL), 0);
});

test('el renglón dice dónde está el recorrido y qué encontró', () => {
  const texto = textoDeBarrido(avanceDe('presente', 'ausente'));
  assert.match(texto, /2 de 10/);
  assert.match(texto, /1 dado de baja/);
});

test('los sin respuesta se nombran sólo si los hay', () => {
  /**
   * Un «0 sin respuesta» permanente enseña a ignorar el lugar donde después aparece el
   * aviso de verdad. Mismo criterio que los errores en `textoDeMarcha`.
   */
  assert.doesNotMatch(textoDeBarrido(avanceDe('presente')), /sin respuesta/);
  assert.match(textoDeBarrido(avanceDe('indeterminado')), /1 sin respuesta/);
});

test('el singular y el plural no se mezclan', () => {
  assert.match(textoDeBarrido(avanceDe('ausente')), /1 dado de baja/);
  assert.match(textoDeBarrido(avanceDe('ausente', 'ausente')), /2 dados de baja/);
});

test('sin bajas lo dice, en vez de callarse', () => {
  // Es el resultado bueno y el mas frecuente: un renglon que no lo nombra deja a quien
  // mira sin saber si el barrido reviso algo.
  assert.match(textoDeBarrido(avanceDe('presente', 'presente')), /ninguno dado de baja/i);
});

// --- Qué pide un POST a /barrido ---

test('la grilla manda una selección, no un cierre de corrida', () => {
  /**
   * EL BUG QUE ESTA FUNCIÓN CIERRA, reportado el 2026-08-12: se tildaban dos productos,
   * la pantalla decía «Se van a revisar 6».
   *
   * La decisión era `Number.isInteger(Number(form.get('scrapeId')))`, y `Number(null)`
   * es `0`, QUE ES UN ENTERO. Así que todo POST de la grilla —que no manda `scrapeId`—
   * se leía como «cerrá la corrida 0», redirigía, y la selección se perdía. La pantalla
   * caía a la cola automática y «Verificar en el proveedor» nunca revisó lo tildado.
   */
  assert.deepEqual(interpretarPostDeBarrido(null, ['7', '9']), {
    tipo: 'seleccion',
    ids: [7, 9],
  });
});

test('una selección vacía sigue siendo una selección', () => {
  // NO puede caer a la cola automatica: `barrido.astro` distingue por `null`, y una
  // seleccion vacia con la que alguien apreto el boton significa «cero productos»,
  // no «barreme el catalogo entero».
  assert.deepEqual(interpretarPostDeBarrido(null, []), { tipo: 'seleccion', ids: [] });
});

test('con scrapeId es un cierre de corrida', () => {
  assert.deepEqual(interpretarPostDeBarrido('42', []), { tipo: 'cerrar', scrapeId: 42 });
});

test('un scrapeId que no es un id no cierra nada', () => {
  // `''` importa: `Number('')` es 0, la misma trampa que `Number(null)`. Y no existe
  // ninguna corrida 0, asi que un 0 nunca es un cierre legitimo.
  for (const crudo of ['', '0', 'abc', '-1', '1.5']) {
    assert.equal(interpretarPostDeBarrido(crudo, ['3']).tipo, 'seleccion', `con ${JSON.stringify(crudo)}`);
  }
});

test('los ids que no son ids se descartan', () => {
  assert.deepEqual(interpretarPostDeBarrido(null, ['3', '', 'abc', '0', '-2', '8']), {
    tipo: 'seleccion',
    ids: [3, 8],
  });
});

/**
 * EL RESTO DE LA CORRIDA.
 *
 * El bug que estos tests cierran, reportado el 2026-09-10 con el sintoma «dice que
 * quedan 1157 y en la segunda corrida dice lo mismo»: el resto se calculaba como
 * `contarBarribles() - cola.length`, o sea `1457 - 300`, y los dos terminos son
 * constantes. El numero no se movia nunca aunque el barrido avanzara perfecto.
 */
test('el resto son los que nunca se revisaron y no entraron en la corrida', () => {
  const resto = restoDelBarrido({
    aMano: false,
    total: 1457,
    enLaCorrida: 300,
    sinRevisarNunca: 1457,
    sinRevisarEnLaCorrida: 300,
  });

  assert.deepEqual(resto, { tipo: 'sin-revisar', cuantos: 1157 });
});

test('EL RESTO BAJA DE UNA CORRIDA A LA OTRA', () => {
  // Es el test del bug. Misma base, mismo tope, pero 300 ya revisados.
  const primera = restoDelBarrido({
    aMano: false,
    total: 1457,
    enLaCorrida: 300,
    sinRevisarNunca: 1457,
    sinRevisarEnLaCorrida: 300,
  });
  const segunda = restoDelBarrido({
    aMano: false,
    total: 1457,
    enLaCorrida: 300,
    sinRevisarNunca: 1157,
    sinRevisarEnLaCorrida: 300,
  });

  assert.deepEqual(primera, { tipo: 'sin-revisar', cuantos: 1157 });
  assert.deepEqual(segunda, { tipo: 'sin-revisar', cuantos: 857 });
});

test('cuando ya se revisaron todos alguna vez, el tope NO se calla', () => {
  /**
   * Que no queden virgenes no significa que no quede trabajo: el barrido es una
   * rotacion. Un tope silencioso se lee como «ya se reviso todo», que es justo lo que
   * el mensaje viejo trataba de evitar.
   */
  const resto = restoDelBarrido({
    aMano: false,
    total: 1457,
    enLaCorrida: 300,
    sinRevisarNunca: 0,
    sinRevisarEnLaCorrida: 0,
  });

  assert.deepEqual(resto, { tipo: 'rotacion', enLaCorrida: 300, total: 1457 });
});

test('si el catalogo entero entra en una corrida no hay resto que anunciar', () => {
  const resto = restoDelBarrido({
    aMano: false,
    total: 42,
    enLaCorrida: 42,
    sinRevisarNunca: 42,
    sinRevisarEnLaCorrida: 42,
  });

  assert.deepEqual(resto, { tipo: 'nada' });
});

test('una seleccion a mano no anuncia resto: quien tildo ya eligio', () => {
  const resto = restoDelBarrido({
    aMano: true,
    total: 1457,
    enLaCorrida: 3,
    sinRevisarNunca: 1457,
    sinRevisarEnLaCorrida: 3,
  });

  assert.deepEqual(resto, { tipo: 'nada' });
});

test('el resto nunca es negativo aunque los conteos lleguen desfasados', () => {
  /**
   * Los dos conteos y la cola salen de tres consultas distintas: entre una y otra puede
   * entrar un alta o una baja desde otra pestaña. Un resto negativo rendiria «quedan -4».
   */
  const resto = restoDelBarrido({
    aMano: false,
    total: 300,
    enLaCorrida: 300,
    sinRevisarNunca: 296,
    sinRevisarEnLaCorrida: 300,
  });

  assert.deepEqual(resto, { tipo: 'nada' });
});

test('un desfasaje NO puede rendir «ya se revisaron todos»', () => {
  /**
   * El clampeo a cero cambiaba una mentira por otra mas sutil: con `total` mayor que la
   * corrida, un resto clampeado caia en `rotacion` y la pantalla anunciaba «ya se
   * revisaron todos alguna vez» habiendo 296 sin revisar. `rotacion` significa que NO
   * queda ninguno virgen, y eso lo dice `sinRevisarNunca`, no una resta.
   */
  const resto = restoDelBarrido({
    aMano: false,
    total: 1457,
    enLaCorrida: 300,
    sinRevisarNunca: 296,
    sinRevisarEnLaCorrida: 300,
  });

  assert.deepEqual(resto, { tipo: 'nada' });
});

test('un catalogo sin nada que barrer no anuncia nada', () => {
  const resto = restoDelBarrido({
    aMano: false,
    total: 0,
    enLaCorrida: 0,
    sinRevisarNunca: 0,
    sinRevisarEnLaCorrida: 0,
  });

  assert.deepEqual(resto, { tipo: 'nada' });
});
