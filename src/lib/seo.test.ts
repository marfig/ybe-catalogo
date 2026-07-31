import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rutaCanonica } from './seo.ts';

// Con build.format: 'file', Astro.url.pathname trae el path del archivo
// construido (/index.html, /productos/x.html), no la URL publica. El canonical
// tiene que normalizarse antes de armarse. Ver SPEC §7.1.
test('rutaCanonica: quita .html de las rutas construidas', () => {
  assert.equal(rutaCanonica('/productos/mochila-urbana.html'), '/productos/mochila-urbana');
  assert.equal(rutaCanonica('/categorias/mochilas.html'), '/categorias/mochilas');
  assert.equal(rutaCanonica('/404.html'), '/404');
});

test('rutaCanonica: la home colapsa a la raiz', () => {
  assert.equal(rutaCanonica('/index.html'), '/');
  assert.equal(rutaCanonica('/'), '/');
});

test('rutaCanonica: un index anidado colapsa a su directorio', () => {
  assert.equal(rutaCanonica('/categorias/index.html'), '/categorias');
  assert.equal(rutaCanonica('/categorias/index'), '/categorias');
});

test('rutaCanonica: paginacion conserva el numero de pagina', () => {
  // Con el rest param [...page], la pagina 1 es la ruta limpia y el resto
  // lleva numero. Ver SPEC §9.5.
  assert.equal(rutaCanonica('/categorias/mochilas.html'), '/categorias/mochilas');
  assert.equal(rutaCanonica('/categorias/mochilas/2.html'), '/categorias/mochilas/2');
  assert.equal(rutaCanonica('/categorias/mochilas/10.html'), '/categorias/mochilas/10');
});

test('rutaCanonica: es idempotente y sirve igual en dev', () => {
  // En dev el pathname no trae .html. La misma funcion debe valer en ambos
  // modos, o el canonical difiere entre dev y produccion.
  assert.equal(rutaCanonica('/productos/mochila-urbana'), '/productos/mochila-urbana');
  assert.equal(rutaCanonica(rutaCanonica('/productos/x.html')), '/productos/x');
  assert.equal(rutaCanonica(rutaCanonica('/index.html')), '/');
});

test('rutaCanonica: nunca deja barra final salvo en la raiz', () => {
  assert.equal(rutaCanonica('/categorias/'), '/categorias');
  assert.equal(rutaCanonica('/productos/x/'), '/productos/x');
  assert.equal(rutaCanonica('/'), '/');
});

test('rutaCanonica: no confunde un slug que contiene "index"', () => {
  // "indexado" empieza con "index" pero no es un archivo index.
  assert.equal(rutaCanonica('/productos/indexado.html'), '/productos/indexado');
  assert.equal(rutaCanonica('/productos/index-glass.html'), '/productos/index-glass');
});

test('rutaCanonica: no rompe con un punto en el slug', () => {
  // Los nombres del proveedor pueden traer medidas: mochila 18.5"
  assert.equal(rutaCanonica('/productos/mochila-18.5.html'), '/productos/mochila-18.5');
});
