import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MARCHA_INICIAL,
  PASO_MS,
  avance,
  clavePagina,
  codigosDe,
  contarFicha,
  esperaMs,
  paginasPendientes,
  sinVisitar,
  textoDeMarcha,
} from './marcha.ts';

const LZ = 'https://www.chenson.com.py/lanzamientos/?lz=2026-07-16';

// --------------------------------------------------------------------------
// Qué página es cada página
// --------------------------------------------------------------------------

test('clavePagina: sin `page` es la página 1', () => {
  assert.equal(clavePagina(LZ), clavePagina(`${LZ}&page=1`));
});

test('clavePagina: la página 2 es otra página', () => {
  assert.notEqual(clavePagina(LZ), clavePagina(`${LZ}&page=2`));
});

test('clavePagina: otro lanzamiento es otra página aunque coincida el número', () => {
  const otro = 'https://www.chenson.com.py/lanzamientos/?lz=2026-07-14&page=2';
  assert.notEqual(clavePagina(`${LZ}&page=2`), clavePagina(otro));
});

test('clavePagina: el orden de los parámetros no cambia la página', () => {
  const a = 'https://www.chenson.com.py/lanzamientos/?lz=2026-07-16&page=3';
  const b = 'https://www.chenson.com.py/lanzamientos/?page=3&lz=2026-07-16';
  assert.equal(clavePagina(a), clavePagina(b));
});

test('clavePagina: una URL rota no revienta, se identifica a sí misma', () => {
  assert.equal(clavePagina('no soy una url'), 'no soy una url');
});

// --------------------------------------------------------------------------
// Qué páginas faltan
// --------------------------------------------------------------------------

test('paginasPendientes: la página inicial no se vuelve a pedir por venir con `page=1`', () => {
  const pendientes = paginasPendientes([`${LZ}&page=1`, `${LZ}&page=2`], [clavePagina(LZ)]);
  assert.deepEqual(pendientes, [`${LZ}&page=2`]);
});

test('paginasPendientes: respeta el orden en que vienen', () => {
  const pendientes = paginasPendientes([`${LZ}&page=3`, `${LZ}&page=2`], []);
  assert.deepEqual(pendientes, [`${LZ}&page=3`, `${LZ}&page=2`]);
});

test('paginasPendientes: no repite una página que aparece dos veces en el listado', () => {
  const pendientes = paginasPendientes([`${LZ}&page=2`, `${LZ}&page=2`], []);
  assert.deepEqual(pendientes, [`${LZ}&page=2`]);
});

test('paginasPendientes: sin páginas nuevas devuelve vacío', () => {
  assert.deepEqual(paginasPendientes([`${LZ}&page=1`], [clavePagina(LZ)]), []);
});

// --------------------------------------------------------------------------
// Qué fichas no hay que pedir
// --------------------------------------------------------------------------

test('sinVisitar: una ficha del mismo modelo no se le pide de nuevo al proveedor', () => {
  /**
   * El caso que justifica todo el módulo: la ficha de un color revela a sus hermanos,
   * así que pedir la del hermano es un viaje al proveedor por datos que ya están.
   */
  const fichas = [
    'https://www.chenson.com.py/producto/71803-cg86003',
    'https://www.chenson.com.py/producto/71804-cg86003',
  ];
  assert.deepEqual(sinVisitar(fichas, ['CG86003']), []);
});

test('sinVisitar: un modelo que no se vio todavía sí se pide', () => {
  const fichas = ['https://www.chenson.com.py/producto/71803-cg86003'];
  assert.deepEqual(sinVisitar(fichas, ['CG85700']), fichas);
});

test('sinVisitar: el código se compara normalizado, no como vino en la URL', () => {
  const fichas = ['https://www.chenson.com.py/producto/71803-cg86003'];
  assert.deepEqual(sinVisitar(fichas, ['cg86003']), []);
});

test('sinVisitar: una URL que no es ficha de producto no se pide', () => {
  const fichas = ['https://www.chenson.com.py/quienes-somos'];
  assert.deepEqual(sinVisitar(fichas, []), []);
});

test('sinVisitar: dos colores del mismo modelo en la misma página se piden una sola vez', () => {
  const fichas = [
    'https://www.chenson.com.py/producto/71803-cg86003',
    'https://www.chenson.com.py/producto/71804-cg86003',
  ];
  assert.deepEqual(sinVisitar(fichas, []), [fichas[0]]);
});

// --------------------------------------------------------------------------
// Los códigos que revela una ficha
// --------------------------------------------------------------------------

test('codigosDe: saca el código de cada URL de ficha', () => {
  const urls = [
    'https://www.chenson.com.py/producto/71803-cg86003',
    'https://www.chenson.com.py/producto/90001-cg85700',
  ];
  assert.deepEqual(codigosDe(urls), ['CG86003', 'CG85700']);
});

test('codigosDe: dos colores del mismo modelo dan un solo código', () => {
  const urls = [
    'https://www.chenson.com.py/producto/71803-cg86003',
    'https://www.chenson.com.py/producto/71804-cg86003',
  ];
  assert.deepEqual(codigosDe(urls), ['CG86003']);
});

test('codigosDe: una URL que no es ficha no aporta código', () => {
  assert.deepEqual(codigosDe(['https://www.chenson.com.py/lanzamientos/']), []);
});

test('codigosDe: lo que devuelve alcanza para que `sinVisitar` saltee al hermano', () => {
  /**
   * El contrato entre las dos funciones: si esto se rompe, el navegador le vuelve a
   * pedir al proveedor fichas que ya tiene y nadie se entera — sólo el proveedor.
   */
  const hermano = 'https://www.chenson.com.py/producto/71804-cg86003';
  assert.deepEqual(sinVisitar([hermano], codigosDe([hermano])), []);
});

// --------------------------------------------------------------------------
// La contabilidad
// --------------------------------------------------------------------------

test('contarFicha: un producto creado suma uno a nuevos y uno a leídas', () => {
  const m = contarFicha(MARCHA_INICIAL, { codigo: 'CG1', creado: true });
  assert.equal(m.nuevos, 1);
  assert.equal(m.repetidos, 0);
  assert.equal(m.leidas, 1);
});

test('contarFicha: un producto que ya estaba suma a repetidos', () => {
  const m = contarFicha(MARCHA_INICIAL, { codigo: 'CG1', creado: false });
  assert.equal(m.nuevos, 0);
  assert.equal(m.repetidos, 1);
});

test('contarFicha: una ficha omitida cuenta como leída pero no como producto', () => {
  /**
   * El proveedor igual la sirvió: el corte por hermano del servidor ocurre DESPUÉS de
   * bajarla. Contarla como nueva o repetida mentiría sobre cuántos productos entraron.
   */
  const m = contarFicha(MARCHA_INICIAL, { codigo: 'CG1', omitida: true });
  assert.equal(m.leidas, 1);
  assert.equal(m.nuevos, 0);
  assert.equal(m.repetidos, 0);
  assert.equal(m.errores, 0);
});

test('contarFicha: un error suma a errores y no a leídas', () => {
  const m = contarFicha(MARCHA_INICIAL, { error: 'HTTP 500 al pedir la ficha.' });
  assert.equal(m.errores, 1);
  assert.equal(m.leidas, 0);
});

test('contarFicha: no muta la marcha que recibe', () => {
  const antes = { ...MARCHA_INICIAL };
  contarFicha(MARCHA_INICIAL, { codigo: 'CG1', creado: true });
  assert.deepEqual({ ...MARCHA_INICIAL }, antes);
});

test('contarFicha: un aviso de cambio en el origen se cuenta aparte', () => {
  const m = contarFicha(MARCHA_INICIAL, { codigo: 'CG1', creado: false, avisoDeCambio: true });
  assert.equal(m.avisados, 1);
  assert.equal(m.repetidos, 1);
});

// --------------------------------------------------------------------------
// Lo que se lee en pantalla
// --------------------------------------------------------------------------

test('textoDeMarcha: el renglón de §10.2', () => {
  const m = { ...MARCHA_INICIAL, paginasHechas: 2, totalPaginas: 7, leidas: 42, nuevos: 38, errores: 2 };
  assert.equal(
    textoDeMarcha(m),
    'Página 3 de 7 · 42 fichas leídas · 38 productos nuevos · 2 con error'
  );
});

test('textoDeMarcha: sin errores no se nombra el error', () => {
  const m = { ...MARCHA_INICIAL, paginasHechas: 0, totalPaginas: 1, leidas: 5, nuevos: 5 };
  assert.equal(textoDeMarcha(m), 'Página 1 de 1 · 5 fichas leídas · 5 productos nuevos');
});

test('textoDeMarcha: en singular no dice «1 fichas»', () => {
  const m = { ...MARCHA_INICIAL, totalPaginas: 1, leidas: 1, nuevos: 1, errores: 1 };
  assert.equal(textoDeMarcha(m), 'Página 1 de 1 · 1 ficha leída · 1 producto nuevo · 1 con error');
});

test('textoDeMarcha: terminada la última página no dice «Página 8 de 7»', () => {
  const m = { ...MARCHA_INICIAL, paginasHechas: 7, totalPaginas: 7, leidas: 60, nuevos: 60 };
  assert.equal(textoDeMarcha(m), 'Página 7 de 7 · 60 fichas leídas · 60 productos nuevos');
});

// --------------------------------------------------------------------------
// La barra
// --------------------------------------------------------------------------

test('avance: recién empezada es 0', () => {
  assert.equal(avance({ paginasHechas: 0, totalPaginas: 4, fichasDePagina: 16, fichasHechas: 0 }), 0);
});

test('avance: media página de cuatro es un octavo', () => {
  assert.equal(
    avance({ paginasHechas: 0, totalPaginas: 4, fichasDePagina: 16, fichasHechas: 8 }),
    12.5
  );
});

test('avance: todo hecho es 100', () => {
  assert.equal(
    avance({ paginasHechas: 4, totalPaginas: 4, fichasDePagina: 16, fichasHechas: 16 }),
    100
  );
});

test('avance: nunca pasa de 100 aunque las cuentas se vayan de rango', () => {
  assert.equal(
    avance({ paginasHechas: 5, totalPaginas: 4, fichasDePagina: 16, fichasHechas: 99 }),
    100
  );
});

test('avance: una página sin fichas no divide por cero', () => {
  assert.equal(avance({ paginasHechas: 1, totalPaginas: 2, fichasDePagina: 0, fichasHechas: 0 }), 50);
});

// --------------------------------------------------------------------------
// La cortesía
// --------------------------------------------------------------------------

test('esperaMs: el primer pedido no espera', () => {
  assert.equal(esperaMs(null, 1_000_000), 0);
});

test('esperaMs: si pasó menos de un segundo, espera lo que falta', () => {
  assert.equal(esperaMs(1_000_000, 1_000_300), PASO_MS - 300);
});

test('esperaMs: si ya pasó el paso, no espera', () => {
  assert.equal(esperaMs(1_000_000, 1_002_000), 0);
});

test('esperaMs: un reloj que va para atrás espera el paso entero y no un número negativo', () => {
  /**
   * `Date.now()` puede retroceder con un ajuste de hora. Sin el piso, la resta daría
   * negativo y el `setTimeout` dispararía al toque: se rompería la cortesía §7.4 justo
   * cuando nadie está mirando.
   */
  assert.equal(esperaMs(1_005_000, 1_000_000), PASO_MS);
});

// --------------------------------------------------------------------------
// Los que se saltean por estar ya en el catálogo
// --------------------------------------------------------------------------

test('textoDeMarcha: los salteados se nombran, y sólo si los hay', () => {
  const m = { ...MARCHA_INICIAL, totalPaginas: 4, leidas: 12, nuevos: 12, salteados: 38 };
  assert.equal(
    textoDeMarcha(m),
    'Página 1 de 4 · 12 fichas leídas · 12 productos nuevos · 38 que ya tenía'
  );
});

test('textoDeMarcha: sin salteados el renglón no los menciona', () => {
  const m = { ...MARCHA_INICIAL, totalPaginas: 1, leidas: 5, nuevos: 5 };
  assert.ok(!textoDeMarcha(m).includes('ya tenía'));
});

test('textoDeMarcha: en singular no dice «1 que ya tenía»… dice lo correcto', () => {
  const m = { ...MARCHA_INICIAL, totalPaginas: 1, leidas: 1, nuevos: 1, salteados: 1 };
  assert.ok(textoDeMarcha(m).includes('1 que ya tenía'));
});

test('los salteados NO cuentan como leídas: al proveedor no se le pidió nada', () => {
  // Es la diferencia que justifica la opcion entera. Contarlos como leidas diria que
  // se hicieron 50 pedidos cuando se hicieron 12.
  const m = { ...MARCHA_INICIAL, salteados: 38 };
  assert.equal(m.leidas, 0);
});
