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

/**
 * El listado por categoría (medido el 2026-08-26 sobre `/categoria/1-cartera`).
 *
 * Doce fichas por página, paginación RELATIVA `?page={N}` y sin `lz`. El encabezado
 * declara «431 Productos», que es lo único que dice cuántas páginas hay de verdad.
 */

const CATEGORIA = `${HOST}/categoria/1-cartera`;

test('junta las fichas de una categoría', () => {
  const a = new AcumuladorListado(CATEGORIA);
  a.verEnlace('/producto/67540-cg34283');
  a.verEnlace('/producto/67540-cg34283');

  const r = a.resultado();
  assert.equal(r.clase, 'categoria');
  assert.deepEqual(r.fichas, [`${HOST}/producto/67540-cg34283`]);
});

test('sigue la paginación relativa de la categoría', () => {
  // El proveedor las escribe asi, sin repetir el pathname: `<a href="?page=2">`.
  const a = new AcumuladorListado(CATEGORIA);
  for (const n of [1, 2, 3, 4, 5, 6]) a.verEnlace(`?page=${n}`);

  const r = a.resultado();
  assert.deepEqual(r.paginas, [1, 2, 3, 4, 5, 6].map((n) => `${CATEGORIA}?page=${n}`));
});

test('NO sale de la categoría que se pidió', () => {
  /**
   * La misma trampa que los lanzamientos anteriores, con otra cara: la pagina enlaza
   * TODAS las demas categorias en su menu, y sus subcategorias y filtros en la barra
   * lateral. Seguirlos convertiria «importar carteras» en «importar el catalogo
   * entero», que es una decision de quien opera y no de este acumulador.
   */
  const a = new AcumuladorListado(CATEGORIA);
  a.verEnlace('/categoria/10-necessaire?page=2');
  a.verEnlace('/categoria/1-cartera/38-cartera?page=2');
  a.verEnlace('/categoria/1-cartera?f=collection--109');
  a.verEnlace('?page=2');

  assert.deepEqual(a.resultado().paginas, [`${CATEGORIA}?page=2`]);
});

test('la barra lateral de una categoría no aporta páginas', () => {
  // Los filtros son `?f=...` sin `page`: no son paginacion de nada.
  const a = new AcumuladorListado(CATEGORIA);
  for (const f of ['?f=collection--16', '?f=subcategory--102', '/categoria/1-cartera/outlet']) {
    a.verEnlace(f);
  }
  assert.equal(a.resultado().totalPaginas, 1);
});

test('lee el total de productos que declara la categoría', () => {
  const a = new AcumuladorListado(CATEGORIA);
  a.verTotal('431 Productos');
  assert.equal(a.resultado().totalProductos, 431);
});

test('sin encabezado no se inventa un total', () => {
  /**
   * `/lanzamientos` sirve el MISMO `<p>` vacio, asi que este caso no es defensivo: es el
   * camino normal de la otra clase de listado. `null` y no 0 — el progreso tiene que
   * poder distinguir «no lo se» de «no hay ninguno».
   */
  const a = new AcumuladorListado(LISTADO);
  a.verTotal('');
  assert.equal(a.resultado().totalProductos, null);
});

test('una categoría se reconoce con y sin barra final', () => {
  // La paginacion es relativa, asi que el pathname de las paginas hereda la barra de la
  // URL que se pego. Comparar los strings crudos partiria la categoria en dos.
  const a = new AcumuladorListado(`${CATEGORIA}/`);
  a.verEnlace('?page=2');
  assert.deepEqual(a.resultado().paginas, [`${CATEGORIA}/?page=2`]);
});

test('la clase del listado viaja en el resultado', () => {
  assert.equal(new AcumuladorListado(LISTADO).resultado().clase, 'lanzamiento');
});
