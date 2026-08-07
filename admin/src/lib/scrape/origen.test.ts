import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  codigoDesdeUrl,
  colorDesdeTitulo,
  esFichaDelMismoModelo,
  normalizarUrl,
  separarColor,
  skuDeOrigen,
} from './origen.ts';

/**
 * Las convenciones del sitio de origen, aisladas y testeadas.
 *
 * Van en su propio módulo y no dentro del extractor porque son lo que se rompe
 * cuando el proveedor cambia algo, y conviene que ese día haya un solo archivo que
 * mirar y una sola tanda de tests que se ponga roja.
 */

// --- El código sale de la URL, que es lo más estable que expone el sitio ---

test('codigoDesdeUrl toma el código del último segmento', () => {
  assert.equal(codigoDesdeUrl('https://www.chenson.com.py/producto/71803-cg86003'), 'CG86003');
});

test('codigoDesdeUrl normaliza a mayúsculas', () => {
  // `productos.codigo` se compara con un índice `upper(codigo)` (migración 0002):
  // devolver el código en minúsculas crearía un duplicado que el UNIQUE sí atrapa,
  // pero recién al escribir y con un mensaje que no señala la causa.
  assert.equal(codigoDesdeUrl('https://www.chenson.com.py/producto/71803-CG86003/'), 'CG86003');
});

test('codigoDesdeUrl rechaza lo que no tenga forma de ficha', () => {
  for (const mala of [
    'https://www.chenson.com.py/lanzamientos/?lz=2026-07-16',
    'https://www.chenson.com.py/producto/cg86003',
    'https://www.chenson.com.py/producto/71803-',
    'https://www.chenson.com.py/',
    'no es una url',
  ]) {
    assert.equal(codigoDesdeUrl(mala), null, `deberia rechazar ${JSON.stringify(mala)}`);
  }
});

// --- Los colores hermanos se agrupan por URL, no por markup ---

test('otra ficha del mismo código es del mismo modelo', () => {
  // La agrupación vive en la URL. Un selector de markup (`#other-colors-tbl`) se
  // rompe con el próximo rediseño; el patrón de URL sobrevive (§7.2).
  assert.equal(esFichaDelMismoModelo('/producto/71804-cg86003', 'CG86003'), true);
});

test('una ficha de otro código NO es del mismo modelo', () => {
  // Es lo que separa un color hermano de un recomendado del carrusel.
  assert.equal(esFichaDelMismoModelo('/producto/71804-cg85401', 'CG86003'), false);
});

test('la comparación de código no distingue mayúsculas', () => {
  assert.equal(esFichaDelMismoModelo('/producto/71804-CG86003', 'cg86003'), true);
});

test('un enlace que no es de producto no es del mismo modelo', () => {
  for (const href of ['/lanzamientos/', '/carrito', '#', '']) {
    assert.equal(esFichaDelMismoModelo(href, 'CG86003'), false, href);
  }
});

// --- El prefijo (X) del color es el código de color del proveedor ---

test('separarColor parte el prefijo del nombre', () => {
  assert.deepEqual(separarColor('(E) CREMA'), { prefijo: 'E', nombre: 'CREMA' });
  assert.deepEqual(separarColor('(A) VERDE OSCURO'), { prefijo: 'A', nombre: 'VERDE OSCURO' });
  assert.deepEqual(separarColor('(3) NEGRO'), { prefijo: '3', nombre: 'NEGRO' });
});

test('separarColor tolera espacios de más', () => {
  assert.deepEqual(separarColor('  (P)   ROSADO  '), { prefijo: 'P', nombre: 'ROSADO' });
});

test('separarColor devuelve prefijo nulo cuando no hay', () => {
  assert.deepEqual(separarColor('ROSADO'), { prefijo: null, nombre: 'ROSADO' });
});

test('un paréntesis que no está al principio no es prefijo', () => {
  assert.deepEqual(separarColor('VERDE (OSCURO)'), { prefijo: null, nombre: 'VERDE (OSCURO)' });
});

// --- El SKU: la regla completa de SPEC.md §6.6 ---

test('skuDeOrigen usa el código de color del proveedor', () => {
  // ESTE es el SKU real del origen. El `skuDe()` genérico implementa sólo la rama
  // del fallback, y por eso recomputarlo nunca coincidía con lo scrapeado.
  assert.equal(skuDeOrigen('CG85527', '(P) ROSADO'), 'CG85527-P');
  assert.equal(skuDeOrigen('CG85527', '(3) NEGRO'), 'CG85527-3');
  assert.equal(skuDeOrigen('CG85527', '(E) CREMA'), 'CG85527-E');
});

test('sin prefijo el SKU cae al slug del color', () => {
  assert.equal(skuDeOrigen('CG85527', 'ROSADO VIEJO'), 'CG85527-rosado-viejo');
});

test('el SKU no depende de la posición de la variante', () => {
  // Si el proveedor agrega un color, los SKU existentes no se pueden mover: ya
  // viajaron en pedidos por WhatsApp.
  const antes = ['(P) ROSADO', '(E) CREMA'].map((c) => skuDeOrigen('CG85527', c));
  const despues = ['(A) VERDE', '(P) ROSADO', '(E) CREMA'].map((c) => skuDeOrigen('CG85527', c));
  assert.deepEqual(antes, ['CG85527-P', 'CG85527-E']);
  assert.deepEqual(despues.slice(1), antes);
});

test('skuDeOrigen lanza si del color no queda nada', () => {
  assert.throws(() => skuDeOrigen('CG85527', '   '), /color/i);
});

// --- El color de la propia ficha sale del título, y de ningún otro lado ---

test('colorDesdeTitulo saca el color de la ficha abierta', () => {
  // Medido el 2026-08-06 sobre 5 fichas reales. Es el UNICO lugar donde aparece el
  // color de la pagina que se esta mirando: el bloque de colores lista solo hermanos.
  assert.equal(colorDesdeTitulo('Producto: CG85700 (3) NEGRO', 'CG85700'), '(3) NEGRO');
  assert.equal(colorDesdeTitulo('Producto: CG86003 (9) AZUL', 'CG86003'), '(9) AZUL');
});

test('colorDesdeTitulo tolera un nombre con espacios', () => {
  assert.equal(colorDesdeTitulo('Producto: CG85700 (T) MARRON CLARO', 'CG85700'), '(T) MARRON CLARO');
});

test('colorDesdeTitulo exige que el código coincida', () => {
  // Si la plantilla del proveedor cambia y el titulo pasa a ser de otra cosa, es
  // preferible quedarse sin color que colgarle a la variante un color ajeno.
  assert.equal(colorDesdeTitulo('Producto: CG99999 (3) NEGRO', 'CG85700'), null);
});

test('colorDesdeTitulo devuelve null ante un título que no tiene la forma', () => {
  for (const malo of ['CG85700 (3) NEGRO', 'Producto: CG85700', 'Chenson · Marroquinería', '']) {
    assert.equal(colorDesdeTitulo(malo, 'CG85700'), null, JSON.stringify(malo));
  }
});

// --- Las URLs del origen traen el puerto explícito ---

test('normalizarUrl saca el puerto 443 explícito', () => {
  // Los `src` del origen vienen como `https://host:443/...`. Comparar strings
  // crudos duplicaría cada imagen contra la misma ya guardada (§7.2).
  assert.equal(
    normalizarUrl('https://www.chenson.com.py:443/Prelude-images/product/abc.jpg', 'https://www.chenson.com.py'),
    'https://www.chenson.com.py/Prelude-images/product/abc.jpg'
  );
});

test('normalizarUrl resuelve rutas relativas contra el origen', () => {
  assert.equal(
    normalizarUrl('/Prelude-images/product/abc.jpg', 'https://www.chenson.com.py'),
    'https://www.chenson.com.py/Prelude-images/product/abc.jpg'
  );
});

test('normalizarUrl devuelve null ante una URL ilegible', () => {
  assert.equal(normalizarUrl('', 'https://www.chenson.com.py'), null);
  assert.equal(normalizarUrl('http://[', 'https://www.chenson.com.py'), null);
});
