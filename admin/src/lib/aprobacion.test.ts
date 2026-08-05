import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validarParaAprobar } from './aprobacion.ts';

/**
 * Tests de las validaciones para pasar a `aprobado` (SPEC-etapa2 §5.2).
 *
 * Este modulo decide dos cosas a la vez: si el boton "Aprobar" se habilita, y que
 * dice la grilla debajo de cada producto («⚠ sin nombre, sin precio» o «✓ listo
 * para aprobar», §10.3). Por eso no devuelve un booleano: devuelve QUE falta, en
 * texto que se pueda mostrar.
 *
 * Un validador que solo dijera si/no obligaria a reimplementar los motivos en la
 * vista, y ahi es donde las dos versiones se separan.
 */

const CATEGORIAS = new Set(['carteras', 'mochilas', 'fiesta', 'dama']);

const producto = (extra: Record<string, unknown> = {}) => ({
  codigo: 'CG85527',
  nombre: 'Cartera de fiesta',
  precio: 195000,
  categorias: ['carteras'],
  variantes: [{ sku: 'CG85527-E', color: 'Champagne', imagenes: 1 }],
  ...extra,
});

const validar = (p: ReturnType<typeof producto>, opciones = {}) =>
  validarParaAprobar(p, { categoriasValidas: CATEGORIAS, ...opciones });

// --------------------------------------------------------------------------
// El caso completo
// --------------------------------------------------------------------------

test('un producto completo se puede aprobar y no tiene faltantes', () => {
  const r = validar(producto());
  assert.equal(r.puede, true);
  assert.deepEqual(r.faltantes, []);
});

// --------------------------------------------------------------------------
// 1. nombre no vacio
// --------------------------------------------------------------------------

test('sin nombre no se puede aprobar, y lo dice', () => {
  for (const nombre of [null, '', '   ']) {
    const r = validar(producto({ nombre }));
    assert.equal(r.puede, false);
    assert.ok(
      r.faltantes.some((f) => /nombre/i.test(f)),
      `deberia mencionar el nombre, dijo: ${r.faltantes.join(' | ')}`
    );
  }
});

test('el nombre igual al codigo cuenta como SIN nombre', () => {
  // El importador usa el codigo como marcador cuando no hay nombre (SPEC §6.6, el
  // caso CG85900). Tratarlo como nombre valido dejaria publicar "CG85900" como
  // titulo de producto, que es exactamente lo que el marcador queria evitar.
  const r = validar(producto({ nombre: 'CG85527' }));
  assert.equal(r.puede, false);
  assert.ok(r.faltantes.some((f) => /nombre/i.test(f)));
});

// --------------------------------------------------------------------------
// 2. al menos una categoria, y todas validas
// --------------------------------------------------------------------------

test('sin categorias no se puede aprobar', () => {
  const r = validar(producto({ categorias: [] }));
  assert.equal(r.puede, false);
  assert.ok(r.faltantes.some((f) => /categor/i.test(f)));
});

test('una categoria que no existe en categorias.json bloquea y se nombra', () => {
  // Sin esto el build revienta con un error de Zod que no dice cual de 1.500
  // productos es. Mejor bloquear en el admin, donde se cometio.
  const r = validar(producto({ categorias: ['carteras', 'inventada'] }));
  assert.equal(r.puede, false);
  const texto = r.faltantes.join(' ');
  assert.match(texto, /inventada/);
  assert.doesNotMatch(texto, /carteras/, 'no deberia culpar a la categoria valida');
});

// --------------------------------------------------------------------------
// 3. al menos una variante con al menos una imagen, O confirmacion explicita
// --------------------------------------------------------------------------

test('sin variantes no se puede aprobar', () => {
  const r = validar(producto({ variantes: [] }));
  assert.equal(r.puede, false);
  assert.ok(r.faltantes.some((f) => /variante|color/i.test(f)));
});

test('con variantes pero sin ninguna imagen, bloquea por defecto', () => {
  const r = validar(producto({ variantes: [{ sku: 'X', color: 'Negro', imagenes: 0 }] }));
  assert.equal(r.puede, false);
  assert.ok(r.faltantes.some((f) => /foto|imagen/i.test(f)));
});

test('sin fotos SI se puede aprobar con confirmacion explicita', () => {
  // SPEC.md §5.4 lo permite: el producto sigue visible y contactable. Pero tiene
  // que ser una decision tomada, no un descuido que pasa solo.
  const r = validar(producto({ variantes: [{ sku: 'X', color: 'Negro', imagenes: 0 }] }), {
    permitirSinFoto: true,
  });
  assert.equal(r.puede, true);
  assert.deepEqual(r.faltantes, []);
  assert.ok(
    r.avisos.some((a) => /sin foto/i.test(a)),
    'aprobar sin foto deja aviso: es una decision, no un silencio'
  );
});

test('la confirmacion sin foto NO tapa otros faltantes', () => {
  // El riesgo real: que un "publicar sin foto" se convierta en un pase libre.
  const r = validar(producto({ nombre: null, variantes: [{ sku: 'X', color: 'N', imagenes: 0 }] }), {
    permitirSinFoto: true,
  });
  assert.equal(r.puede, false);
  assert.ok(r.faltantes.some((f) => /nombre/i.test(f)));
});

test('alcanza con que UNA variante tenga imagen', () => {
  const r = validar(
    producto({
      variantes: [
        { sku: 'A', color: 'Negro', imagenes: 0 },
        { sku: 'B', color: 'Rojo', imagenes: 2 },
      ],
    })
  );
  assert.equal(r.puede, true);
});

// --------------------------------------------------------------------------
// 4. precio opcional
// --------------------------------------------------------------------------

test('precio null NO bloquea: es "Consultar precio"', () => {
  const r = validar(producto({ precio: null }));
  assert.equal(r.puede, true);
  assert.ok(
    r.avisos.some((a) => /consultar/i.test(a)),
    'deberia avisar que sale como "Consultar precio", que es una decision comercial'
  );
});

test('precio 0 se trata como dato sospechoso, no como precio', () => {
  // Un cero es casi siempre un error de tipeo. No bloquea — puede ser
  // intencional — pero no puede pasar callado.
  const r = validar(producto({ precio: 0 }));
  assert.equal(r.puede, true);
  assert.ok(r.avisos.some((a) => /precio/i.test(a)));
});

test('precio negativo SI bloquea', () => {
  const r = validar(producto({ precio: -100 }));
  assert.equal(r.puede, false);
  assert.ok(r.faltantes.some((f) => /precio/i.test(f)));
});

// --------------------------------------------------------------------------
// 5. aviso (no bloqueo) por variacion de precio mayor a ±25 %
// --------------------------------------------------------------------------

test('una variacion de precio mayor a 25 % avisa pero NO bloquea', () => {
  const r = validar(producto({ precio: 300000 }), { precioAnterior: 200000 });
  assert.equal(r.puede, true, 'es aviso, no bloqueo');
  assert.ok(r.avisos.some((a) => /50\s?%|precio/i.test(a)));
});

test('una variacion chica no avisa', () => {
  const r = validar(producto({ precio: 210000 }), { precioAnterior: 200000 });
  assert.deepEqual(r.avisos, []);
});

test('el aviso de precio funciona para arriba y para abajo', () => {
  const baja = validar(producto({ precio: 100000 }), { precioAnterior: 200000 });
  assert.ok(baja.avisos.some((a) => /precio/i.test(a)));
});

test('sin precio anterior no hay con que comparar y no se avisa', () => {
  const r = validar(producto({ precio: 999999 }));
  assert.deepEqual(r.avisos, []);
});

test('un precio anterior de 0 no genera una division por cero', () => {
  const r = validar(producto({ precio: 100 }), { precioAnterior: 0 });
  assert.equal(r.puede, true);
  assert.ok(r.avisos.every((a) => Number.isFinite(0) && !/Infinity|NaN/.test(a)));
});

// --------------------------------------------------------------------------
// Varios faltantes a la vez: la grilla los muestra juntos
// --------------------------------------------------------------------------

test('acumula todos los faltantes, no corta en el primero', () => {
  // La grilla muestra «⚠ sin nombre, sin precio» (§10.3). Cortar en el primero
  // obligaria a arreglar de a uno y volver a guardar para descubrir el siguiente.
  const r = validar(producto({ nombre: null, categorias: [], variantes: [] }));
  assert.equal(r.puede, false);
  assert.equal(r.faltantes.length, 3, `dijo: ${r.faltantes.join(' | ')}`);
});
