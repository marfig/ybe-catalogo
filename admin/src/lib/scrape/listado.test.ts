import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AcumuladorListado } from './listado.ts';

/**
 * Medido el 2026-08-06 sobre `/lanzamientos/?lz=2026-07-16`: 16 fichas por página y
 * paginación `?lz={fecha}&page={N}` con los números 1 a 4.
 */

const HOST = 'https://www.chenson.com.py';
const LISTADO = `${HOST}/lanzamientos/?lz=2026-07-16`;

test('junta las fichas en orden de documento y sin repetir', () => {
  // Cada producto del listado se enlaza dos veces: desde la imagen y desde el título.
  const a = new AcumuladorListado(LISTADO);
  a.verEnlace('/producto/71803-cg86003');
  a.verEnlace('/producto/71803-cg86003');
  a.verEnlace('/producto/71786-cg85994');

  assert.deepEqual(a.resultado().fichas, [
    `${HOST}/producto/71803-cg86003`,
    `${HOST}/producto/71786-cg85994`,
  ]);
});

test('cuenta las páginas del lanzamiento', () => {
  const a = new AcumuladorListado(LISTADO);
  for (const n of [1, 2, 3, 4]) a.verEnlace(`?lz=2026-07-16&page=${n}`);
  const r = a.resultado();

  assert.equal(r.totalPaginas, 4);
  assert.deepEqual(r.paginas, [
    `${HOST}/lanzamientos/?lz=2026-07-16&page=1`,
    `${HOST}/lanzamientos/?lz=2026-07-16&page=2`,
    `${HOST}/lanzamientos/?lz=2026-07-16&page=3`,
    `${HOST}/lanzamientos/?lz=2026-07-16&page=4`,
  ]);
});

test('NO sigue los enlaces a otros lanzamientos', () => {
  /**
   * La trampa del listado. La pagina enlaza los lanzamientos anteriores
   * (`?lz=2026-07-14`, `?lz=2026-06-10`…). Seguirlos convertiria "importar la tanda
   * del 16 de julio" en "importar el catalogo entero", sin que nadie lo pidiera.
   */
  const a = new AcumuladorListado(LISTADO);
  a.verEnlace('/lanzamientos/?lz=2026-07-14');
  a.verEnlace('/lanzamientos/?lz=2026-06-10');
  a.verEnlace('?lz=2026-07-16&page=2');

  const r = a.resultado();
  assert.equal(r.totalPaginas, 2);
  assert.ok(r.paginas.every((p) => p.includes('lz=2026-07-16')));
});

test('una sola página cuenta como una', () => {
  // Un lanzamiento chico no emite paginacion. Sin este piso, el progreso mostraria
  // "pagina 1 de 0".
  const a = new AcumuladorListado(LISTADO);
  a.verEnlace('/producto/71803-cg86003');
  assert.equal(a.resultado().totalPaginas, 1);
});

test('ignora lo que no es ficha ni paginación', () => {
  const a = new AcumuladorListado(LISTADO);
  for (const href of ['/carrito', '#', '', 'https://facebook.com/chenson', '/producto/sin-id']) {
    a.verEnlace(href);
  }
  const r = a.resultado();
  assert.deepEqual(r.fichas, []);
  assert.equal(r.totalPaginas, 1);
});

test('no sale del origen aunque el listado enlace afuera', () => {
  const a = new AcumuladorListado(LISTADO);
  a.verEnlace('https://otro-sitio.com/producto/71803-cg86003');
  assert.deepEqual(a.resultado().fichas, []);
});

test('la misma página dos veces da el mismo resultado', () => {
  // Precondicion de la idempotencia de §7.5.
  const armar = () => {
    const a = new AcumuladorListado(LISTADO);
    a.verEnlace('/producto/71803-cg86003');
    a.verEnlace('?lz=2026-07-16&page=2');
    return a.resultado();
  };
  assert.deepEqual(armar(), armar());
});

test('rechaza una URL que no es de listado', () => {
  assert.throws(() => new AcumuladorListado(`${HOST}/producto/71803-cg86003`), /listado/i);
});
