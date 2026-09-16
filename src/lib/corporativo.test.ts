import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  agruparPorSeccion,
  derivarProductoCorporativo,
  resolverSeleccion,
  type ProductoCorporativo,
  type ProductoCorporativoOrigen,
  type RegaloSeleccionado,
} from './corporativo.ts';

/**
 * Tests del catalogo corporativo (regalos empresariales).
 *
 * PIEZAS PURAS: nada de esto toca astro:content. Los productos y entradas son
 * objetos armados a mano, con la forma minima que cada funcion necesita.
 */

// --------------------------------------------------------------------------
// resolverSeleccion
// --------------------------------------------------------------------------

function entrada(extra: Partial<RegaloSeleccionado> = {}): RegaloSeleccionado {
  return {
    id: 'mochila-a',
    orden: 1,
    seccion: 'MOCHILAS',
    ordenSeccion: 4,
    codigo: 'CG85527',
    medidas: '30 x 40 x 15',
    consultarOtros: false,
    colores: [{ codigo: '3', nombre: 'NEGRO', alternativo: false }],
    ...extra,
  };
}

test('resolverSeleccion: descarta en silencio un id sin producto', () => {
  const seleccion: RegaloSeleccionado[] = [
    entrada({ id: 'mochila-a', orden: 1 }),
    entrada({ id: 'no-existe', orden: 2 }),
  ];
  const productos = [{ id: 'mochila-a' }];

  const resueltos = resolverSeleccion(seleccion, productos);

  assert.deepEqual(
    resueltos.map((r) => r.producto.id),
    ['mochila-a']
  );
});

test('resolverSeleccion: una seleccion vacia devuelve un arreglo vacio', () => {
  const productos = [{ id: 'mochila-a' }, { id: 'mochila-b' }];
  assert.deepEqual(resolverSeleccion([], productos), []);
});

test('resolverSeleccion: sin ningun producto que coincida devuelve vacio', () => {
  const seleccion: RegaloSeleccionado[] = [entrada({ id: 'no-existe', orden: 1 })];
  assert.deepEqual(resolverSeleccion(seleccion, []), []);
});

test('resolverSeleccion: ordena por `orden`, no por el orden del arreglo de entrada', () => {
  const seleccion: RegaloSeleccionado[] = [
    entrada({ id: 'c', orden: 3 }),
    entrada({ id: 'a', orden: 1 }),
    entrada({ id: 'b', orden: 2 }),
  ];
  const productos = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  assert.deepEqual(
    resolverSeleccion(seleccion, productos).map((r) => r.producto.id),
    ['a', 'b', 'c']
  );
});

test('resolverSeleccion: un empate en `orden` desempata por id, de forma estable', () => {
  const seleccion: RegaloSeleccionado[] = [entrada({ id: 'z', orden: 5 }), entrada({ id: 'a', orden: 5 })];
  const productos = [{ id: 'a' }, { id: 'z' }];

  assert.deepEqual(
    resolverSeleccion(seleccion, productos).map((r) => r.producto.id),
    ['a', 'z']
  );
});

test('resolverSeleccion: conserva la entrada impresa de cada match', () => {
  const seleccion: RegaloSeleccionado[] = [entrada({ id: 'a', codigo: 'CG1', orden: 1 })];
  const productos = [{ id: 'a' }];

  const [resuelto] = resolverSeleccion(seleccion, productos);

  assert.equal(resuelto?.entrada.codigo, 'CG1');
});

// --------------------------------------------------------------------------
// derivarProductoCorporativo
// --------------------------------------------------------------------------

const IMG = (base: string): { base: string; anchos: number[] } => ({ base, anchos: [300, 600] });

function producto(extra: Partial<ProductoCorporativoOrigen> = {}): ProductoCorporativoOrigen {
  return {
    id: 'mochila-a',
    nombre: 'Mochila urbana',
    variantes: [{ sku: 'CG85527-3', imagenes: [IMG('catalogo/negro')] }],
    ...extra,
  };
}

test('derivarProductoCorporativo: el codigo, medidas y colores salen de la entrada, no del producto', () => {
  const p = derivarProductoCorporativo(
    producto(),
    entrada({ codigo: 'CG85527', medidas: '30 x 40 x 15' })
  );

  assert.equal(p.codigo, 'CG85527');
  assert.equal(p.medidas, '30 x 40 x 15');
  assert.deepEqual(p.colores, [{ codigo: '3', nombre: 'NEGRO', alternativo: false }]);
});

test('derivarProductoCorporativo: conserva seccion, ordenSeccion y orden de la entrada', () => {
  const p = derivarProductoCorporativo(
    producto(),
    entrada({ seccion: 'BOLSO', ordenSeccion: 2, orden: 7 })
  );

  assert.equal(p.seccion, 'BOLSO');
  assert.equal(p.ordenSeccion, 2);
  assert.equal(p.orden, 7);
});

test('derivarProductoCorporativo: la etiqueta es opcional y se conserva cuando esta', () => {
  const sinEtiqueta = derivarProductoCorporativo(producto(), entrada());
  assert.equal(sinEtiqueta.etiqueta, undefined);

  const conEtiqueta = derivarProductoCorporativo(producto(), entrada({ etiqueta: 'sin tira larga' }));
  assert.equal(conEtiqueta.etiqueta, 'sin tira larga');
});

// --------------------------------------------------------------------------
// derivarProductoCorporativo: resolucion de foto por `fotoColor`
// --------------------------------------------------------------------------

test('resolucion de foto: match exacto `<codigo>-<fotoColor>`', () => {
  const p = derivarProductoCorporativo(
    producto({ variantes: [{ sku: 'CG85527-3', imagenes: [IMG('catalogo/negro')] }] }),
    entrada({ codigo: 'CG85527', fotoColor: '3' })
  );

  assert.equal(p.imagen?.base, 'catalogo/negro');
});

test('resolucion de foto: sufijo `-<nombre>` del sku tambien matchea', () => {
  const p = derivarProductoCorporativo(
    producto({ variantes: [{ sku: '1731466-3-negro', imagenes: [IMG('catalogo/negro')] }] }),
    entrada({ codigo: '1731466', fotoColor: '3' })
  );

  assert.equal(p.imagen?.base, 'catalogo/negro');
});

test('resolucion de foto: la trampa `3` vs `3-23` no matchea sin el guion de cierre', () => {
  const p = derivarProductoCorporativo(
    producto({
      variantes: [
        { sku: '1731466-33-gris', imagenes: [IMG('catalogo/gris')] },
        { sku: '1731466-3-negro', imagenes: [IMG('catalogo/negro')] },
      ],
    }),
    entrada({ codigo: '1731466', fotoColor: '3' })
  );

  // Si el match fuera un `startsWith` sin el guion, la primera variante (sku "33")
  // matchearia primero y la foto saldria gris en vez de negra.
  assert.equal(p.imagen?.base, 'catalogo/negro');
});

test('resolucion de foto: el match es case-insensitive', () => {
  const p = derivarProductoCorporativo(
    producto({ variantes: [{ sku: 'CG85527-R1', imagenes: [IMG('catalogo/rojo')] }] }),
    entrada({ codigo: 'CG85527', fotoColor: 'r1' })
  );

  assert.equal(p.imagen?.base, 'catalogo/rojo');
});

test('resolucion de foto: sin `fotoColor` cae a la portada normal del producto', () => {
  const p = derivarProductoCorporativo(
    producto({ variantes: [{ sku: 'CG85527-3', imagenes: [IMG('catalogo/negro')] }] }),
    entrada({ fotoColor: undefined })
  );

  assert.equal(p.imagen?.base, 'catalogo/negro');
});

test('resolucion de foto: la variante que matchea sin imagenes cae a la portada normal', () => {
  const p = derivarProductoCorporativo(
    producto({
      variantes: [
        { sku: 'CG85527-R1', imagenes: [IMG('catalogo/rojo')] },
        { sku: 'CG85527-3', imagenes: [] },
      ],
    }),
    entrada({ codigo: 'CG85527', fotoColor: '3' })
  );

  // La portada normal es la PRIMERA variante activa del producto (mismo criterio que
  // `imagenPrincipal` en productos.ts) — no busca entre las demas cual tiene foto.
  assert.equal(p.imagen?.base, 'catalogo/rojo');
});

// --------------------------------------------------------------------------
// agruparPorSeccion
// --------------------------------------------------------------------------

function productoCorp(extra: Partial<ProductoCorporativo> = {}): ProductoCorporativo {
  return {
    id: 'p',
    nombre: 'Producto',
    codigo: 'C1',
    medidas: '1 x 1 x 1',
    consultarOtros: false,
    etiqueta: undefined,
    colores: [{ codigo: '3', nombre: 'NEGRO', alternativo: false }],
    imagen: undefined,
    seccion: 'MOCHILAS',
    ordenSeccion: 4,
    orden: 1,
    ...extra,
  };
}

test('agruparPorSeccion: ordena los grupos por `ordenSeccion`, no por orden de aparicion', () => {
  const productos = [
    productoCorp({ id: 'a', seccion: 'MOCHILAS', ordenSeccion: 4, orden: 1 }),
    productoCorp({ id: 'b', seccion: 'BOLSO', ordenSeccion: 2, orden: 1 }),
  ];

  const grupos = agruparPorSeccion(productos);

  assert.deepEqual(
    grupos.map((g) => g.seccion),
    ['BOLSO', 'MOCHILAS']
  );
});

test('agruparPorSeccion: ordena los productos dentro de cada grupo por `orden`', () => {
  const productos = [
    productoCorp({ id: 'z', seccion: 'BOLSO', ordenSeccion: 2, orden: 5 }),
    productoCorp({ id: 'a', seccion: 'BOLSO', ordenSeccion: 2, orden: 1 }),
  ];

  const [grupo] = agruparPorSeccion(productos);

  assert.deepEqual(
    grupo?.productos.map((p) => p.id),
    ['a', 'z']
  );
});

test('agruparPorSeccion: sin productos no hay ningun grupo', () => {
  assert.deepEqual(agruparPorSeccion([]), []);
});
