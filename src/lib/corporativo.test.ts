import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  agruparPorCategoria,
  derivarProductoCorporativo,
  resolverSeleccion,
  type CategoriaCorporativa,
  type ProductoCorporativoOrigen,
  type RegaloSeleccionado,
} from './corporativo.ts';

/**
 * Tests del catalogo corporativo (regalos empresariales).
 *
 * PIEZAS PURAS: nada de esto toca astro:content. Los productos y categorias son
 * objetos armados a mano, con la forma minima que cada funcion necesita.
 */

// --------------------------------------------------------------------------
// resolverSeleccion
// --------------------------------------------------------------------------

test('resolverSeleccion: descarta en silencio un id sin producto', () => {
  const seleccion: RegaloSeleccionado[] = [
    { id: 'mochila-a', orden: 1 },
    { id: 'no-existe', orden: 2 },
  ];
  const productos = [{ id: 'mochila-a' }];

  const resueltos = resolverSeleccion(seleccion, productos);

  assert.deepEqual(
    resueltos.map((p) => p.id),
    ['mochila-a']
  );
});

test('resolverSeleccion: una seleccion vacia devuelve un arreglo vacio', () => {
  const productos = [{ id: 'mochila-a' }, { id: 'mochila-b' }];
  assert.deepEqual(resolverSeleccion([], productos), []);
});

test('resolverSeleccion: sin ningun producto que coincida devuelve vacio', () => {
  const seleccion: RegaloSeleccionado[] = [{ id: 'no-existe', orden: 1 }];
  assert.deepEqual(resolverSeleccion(seleccion, []), []);
});

test('resolverSeleccion: ordena por `orden`, no por el orden del arreglo de entrada', () => {
  const seleccion: RegaloSeleccionado[] = [
    { id: 'c', orden: 3 },
    { id: 'a', orden: 1 },
    { id: 'b', orden: 2 },
  ];
  const productos = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  assert.deepEqual(
    resolverSeleccion(seleccion, productos).map((p) => p.id),
    ['a', 'b', 'c']
  );
});

test('resolverSeleccion: un empate en `orden` desempata por id, de forma estable', () => {
  const seleccion: RegaloSeleccionado[] = [
    { id: 'z', orden: 5 },
    { id: 'a', orden: 5 },
  ];
  const productos = [{ id: 'a' }, { id: 'z' }];

  assert.deepEqual(
    resolverSeleccion(seleccion, productos).map((p) => p.id),
    ['a', 'z']
  );
});

// --------------------------------------------------------------------------
// derivarProductoCorporativo
// --------------------------------------------------------------------------

const IMG = (base: string): { base: string; anchos: number[] } => ({ base, anchos: [300, 600] });

function producto(extra: Partial<ProductoCorporativoOrigen> = {}): ProductoCorporativoOrigen {
  return {
    id: 'mochila-a',
    nombre: 'Mochila urbana',
    descripcion: 'Medidas aprox.: 30 x 40 x 15 cm',
    origen: { ref: 'CG85527' },
    variantes: [{ color: 'Negro', imagenes: [IMG('catalogo/1')] }],
    ...extra,
  };
}

test('derivarProductoCorporativo: expone el codigo desde origen.ref', () => {
  const p = derivarProductoCorporativo(producto(), 'mochilas');
  assert.equal(p.codigo, 'CG85527');
});

test('derivarProductoCorporativo: un producto con varias variantes lista todos sus colores', () => {
  const p = derivarProductoCorporativo(
    producto({
      variantes: [
        { color: 'Negro', imagenes: [IMG('catalogo/1')] },
        { color: 'Azul marino', imagenes: [IMG('catalogo/2')] },
        { color: 'Gris', imagenes: [IMG('catalogo/3')] },
      ],
    }),
    'mochilas'
  );

  assert.deepEqual(p.colores, ['Negro', 'Azul marino', 'Gris']);
});

test('derivarProductoCorporativo: dos variantes con el mismo color no se repiten', () => {
  const p = derivarProductoCorporativo(
    producto({
      variantes: [
        { color: 'Negro', imagenes: [IMG('catalogo/1')] },
        { color: 'Negro', imagenes: [IMG('catalogo/2')] },
      ],
    }),
    'mochilas'
  );

  assert.deepEqual(p.colores, ['Negro']);
});

test('derivarProductoCorporativo: una variante inactiva no aporta color ni foto', () => {
  const p = derivarProductoCorporativo(
    producto({
      variantes: [
        { color: 'Descontinuado', activo: false, imagenes: [IMG('catalogo/viejo')] },
        { color: 'Negro', imagenes: [IMG('catalogo/1')] },
      ],
    }),
    'mochilas'
  );

  assert.deepEqual(p.colores, ['Negro']);
  assert.equal(p.imagen?.base, 'catalogo/1');
});

test('derivarProductoCorporativo: usa la primera imagen de la primera variante activa', () => {
  const p = derivarProductoCorporativo(producto(), 'mochilas');
  assert.equal(p.imagen?.base, 'catalogo/1');
});

test('derivarProductoCorporativo: conserva la categoria que se le pasa', () => {
  const p = derivarProductoCorporativo(producto(), 'mochilas');
  assert.equal(p.categoriaId, 'mochilas');
});

// --------------------------------------------------------------------------
// agruparPorCategoria
// --------------------------------------------------------------------------

const CAT_MOCHILAS: CategoriaCorporativa = { id: 'mochilas', nombre: 'Mochila Básica' };
const CAT_BOLSOS: CategoriaCorporativa = { id: 'bolsos', nombre: 'Bolso de Viaje' };
const CAT_LONCHERAS: CategoriaCorporativa = { id: 'loncheras', nombre: 'Lonchera para Adulto' };

test('agruparPorCategoria: preserva el orden de categorias que recibe', () => {
  const productos = [
    derivarProductoCorporativo(producto({ id: 'p-bolso' }), 'bolsos'),
    derivarProductoCorporativo(producto({ id: 'p-mochila' }), 'mochilas'),
  ];

  const grupos = agruparPorCategoria(productos, [CAT_MOCHILAS, CAT_BOLSOS]);

  assert.deepEqual(
    grupos.map((g) => g.categoria.id),
    ['mochilas', 'bolsos']
  );
});

test('agruparPorCategoria: una categoria sin productos en la seleccion no genera grupo', () => {
  const productos = [derivarProductoCorporativo(producto(), 'mochilas')];

  const grupos = agruparPorCategoria(productos, [CAT_MOCHILAS, CAT_BOLSOS, CAT_LONCHERAS]);

  assert.deepEqual(
    grupos.map((g) => g.categoria.id),
    ['mochilas']
  );
});

test('agruparPorCategoria: sin productos no hay ningun grupo', () => {
  assert.deepEqual(agruparPorCategoria([], [CAT_MOCHILAS]), []);
});
