import { test } from 'node:test';
import assert from 'node:assert/strict';

import { construirProductos, contarEnElCatalogo, serializar } from '../construir.mjs';

/**
 * Tests del volcado D1 -> productos.json (SPEC-etapa2 §5.5).
 *
 * `construirProductos` es PURA: recibe las filas tal como las devuelve D1 y
 * devuelve la estructura de SPEC §4.4. Toda la E/S vive en index.mjs, asi que
 * estos tests corren en node --test sin red, sin base y sin workerd.
 *
 * El contrato de salida no es negociable: lo consume content.config.ts con Zod,
 * y un campo mal formado rompe el build del sitio.
 */

// --------------------------------------------------------------------------
// Fixtures: filas crudas, snake_case, enteros por booleano — como D1.
// --------------------------------------------------------------------------

/** Un producto publicado, completo, con 2 colores y 2 fotos en uno. */
function base() {
  return {
    productos: [
      {
        id: 1,
        codigo: 'CG85527',
        proveedor: 'chenson',
        slug: 'cartera-de-fiesta-con-strass',
        nombre: 'Cartera de fiesta con strass',
        descripcion: 'Cartera de mano rigida con aplicacion de strass.',
        precio: 195000,
        estado: 'publicado',
        actualizado_en: '2026-07-31T14:02:11Z',
      },
    ],
    categorias: [
      { producto_id: 1, categoria_slug: 'carteras', orden: 0 },
      { producto_id: 1, categoria_slug: 'fiesta', orden: 1 },
    ],
    variantes: [
      { id: 10, producto_id: 1, sku: 'CG85527-P', color: 'Rosado', color_hex: '#e8a0a8', activo: 1, orden: 0 },
      { id: 11, producto_id: 1, sku: 'CG85527-3', color: 'Negro', color_hex: '#1a1a1a', activo: 1, orden: 1 },
    ],
    imagenes: [
      { variante_id: 10, hash16: '9dadecbc3b4c69f4', anchos: '[300,600]', orden: 0 },
      { variante_id: 10, hash16: '295134cac99c4701', anchos: '[300,600]', orden: 1 },
      { variante_id: 11, hash16: 'c791d42bad0d298b', anchos: '[300,600]', orden: 0 },
    ],
  };
}

/** Atajo: construye y devuelve el unico producto resultante. */
function uno(filas) {
  const r = construirProductos(filas);
  assert.equal(r.length, 1, 'el fixture debe producir exactamente 1 producto');
  return r[0];
}

// --------------------------------------------------------------------------
// Forma general
// --------------------------------------------------------------------------

test('el id publico es el slug, no el id numerico de D1', () => {
  // El slug es la URL. El id de D1 es interno y no debe filtrarse nunca.
  assert.equal(uno(base()).id, 'cartera-de-fiesta-con-strass');
});

test('origen se arma con proveedor y el codigo como ref', () => {
  // SPEC §6.7: la identidad es proveedor + ref. SPEC-etapa2 §5.3: ref ES el codigo.
  assert.deepEqual(uno(base()).origen, { proveedor: 'chenson', ref: 'CG85527' });
});

test('actualizado es solo la fecha, sin hora', () => {
  // content.config.ts usa z.iso.date(): un timestamp completo NO valida.
  assert.equal(uno(base()).actualizado, '2026-07-31');
});

test('las categorias respetan el orden de la columna orden', () => {
  // SPEC §4.3: categorias[0] define el breadcrumb. El orden es curaduria.
  assert.deepEqual(uno(base()).categorias, ['carteras', 'fiesta']);
});

test('una imagen se emite como base + anchos, con base derivada del hash', () => {
  const v = uno(base()).variantes.find((x) => x.sku === 'CG85527-P');
  assert.deepEqual(v.imagenes, [
    { base: 'catalogo/9dadecbc3b4c69f4', anchos: [300, 600] },
    { base: 'catalogo/295134cac99c4701', anchos: [300, 600] },
  ]);
});

test('base cumple el regex de content.config.ts', () => {
  for (const v of uno(base()).variantes) {
    for (const img of v.imagenes) {
      assert.match(img.base, /^catalogo\/[0-9a-f]{16}$/);
    }
  }
});

// --------------------------------------------------------------------------
// Filtro por estado (SPEC-etapa2 §5.2)
// --------------------------------------------------------------------------

test('un producto importado NO entra al volcado', () => {
  // Estado importado = datos incompletos. No se renderiza en ninguna vista.
  const f = base();
  f.productos[0].estado = 'importado';
  f.productos[0].slug = null;
  assert.deepEqual(construirProductos(f), []);
});

test('aprobado y publicado entran con activo implicito en true', () => {
  for (const estado of ['aprobado', 'publicado']) {
    const f = base();
    f.productos[0].estado = estado;
    const p = uno(f);
    assert.ok(!('activo' in p), `${estado}: activo debe omitirse, el default de Zod es true`);
  }
});

test('eliminado entra con activo false, no se borra del JSON', () => {
  // SPEC §6.9: borrar mata la URL y su indexacion. Se oculta, no se elimina.
  const f = base();
  f.productos[0].estado = 'eliminado';
  assert.equal(uno(f).activo, false);
});

// --------------------------------------------------------------------------
// Omision de defaults — mantiene el diff de git legible (SPEC §6.5)
// --------------------------------------------------------------------------

test('destacado NO se emite: la columna quedo congelada en D1', () => {
  // La portada dejo de curar productos (ver `pedidosEspeciales` en content.config.ts).
  // La columna sigue en la base, asi que este test defiende que un valor viejo ahi
  // adentro no se cuele igual al JSON publicado.
  const f = base();
  f.productos[0].destacado = 1;
  assert.ok(!('destacado' in uno(f)));
});

test('descripcion se omite cuando es null', () => {
  const f = base();
  f.productos[0].descripcion = null;
  assert.ok(!('descripcion' in uno(f)));
});

test('colorHex se omite cuando es null y nunca se inventa', () => {
  // SPEC §6.6: un color sin hex cae a boton con texto. No se adivina un color.
  const f = base();
  f.variantes[0].color_hex = null;
  const v = uno(f).variantes.find((x) => x.sku === 'CG85527-P');
  assert.ok(!('colorHex' in v));
});

test('variante.activo se omite cuando es true y se emite cuando es false', () => {
  const f = base();
  f.variantes[1].activo = 0;
  const vs = uno(f).variantes;
  assert.ok(!('activo' in vs.find((x) => x.sku === 'CG85527-P')));
  assert.equal(vs.find((x) => x.sku === 'CG85527-3').activo, false);
});

test('precio SIEMPRE se emite, incluso null', () => {
  // En content.config.ts precio es nullable pero NO optional: la clave es
  // obligatoria. null explicito significa "Consultar precio" (SPEC §7.3).
  const f = base();
  f.productos[0].precio = null;
  const p = uno(f);
  assert.ok('precio' in p);
  assert.equal(p.precio, null);
});

test('imagenes vacias se emiten como array vacio, no se omiten', () => {
  // Un array vacio es un estado con significado: dispara el placeholder de
  // SPEC §5.4. Omitirlo lo volveria indistinguible de un error de volcado.
  const f = base();
  f.imagenes = [];
  for (const v of uno(f).variantes) assert.deepEqual(v.imagenes, []);
});

// --------------------------------------------------------------------------
// Orden de variantes — el punto mas delicado de la idempotencia
// --------------------------------------------------------------------------

test('las variantes se ordenan por la columna orden, que es curaduria', () => {
  // `variantes[0]` es la variante activa en el HTML inicial (SelectorVariante), o
  // sea que este orden decide QUE COLOR se ve al abrir la ficha. Es una decision
  // comercial, no un detalle de serializacion, asi que manda `orden`.
  //
  // El fixture trae Rosado (orden 0) antes que Negro (orden 1) a proposito: si
  // mandara el alfabetico, Negro iria primero.
  assert.deepEqual(
    uno(base()).variantes.map((v) => v.color),
    ['Rosado', 'Negro']
  );
});

test('con el mismo orden decide el color, y es por punto de codigo, NO localeCompare', () => {
  // localeCompare depende del ICU del runtime: la GitHub Action y una maquina
  // local podrian ordenar distinto y el volcado dejaria de ser deterministico.
  // Es el mismo riesgo que SPEC §9.3 evita en el formato de precios.
  //
  // Por punto de codigo: 'A'(0x41) < 'Z'(0x5A) < 'Á'(0xC1)  =>  Azul, Zafiro, Ambar
  // Con localeCompare('es'):                                =>  Ambar, Azul, Zafiro
  //
  // Los tres van con el MISMO `orden` a proposito: si tuvieran orden distinto,
  // `orden` decidiria y este test no probaria nada sobre el comparador de colores.
  const f = base();
  f.variantes = [
    { id: 10, producto_id: 1, sku: 'X-1', color: 'Ámbar', color_hex: null, activo: 1, orden: 0 },
    { id: 11, producto_id: 1, sku: 'X-2', color: 'Azul', color_hex: null, activo: 1, orden: 0 },
    { id: 12, producto_id: 1, sku: 'X-3', color: 'Zafiro', color_hex: null, activo: 1, orden: 0 },
  ];
  f.imagenes = [];
  assert.deepEqual(
    uno(f).variantes.map((v) => v.color),
    ['Azul', 'Zafiro', 'Ámbar']
  );
});

test('con el mismo orden y el mismo color decide el sku', () => {
  // Ultimo desempate: sin el, dos variantes empatadas quedarian en el orden en que
  // las devolvio la base y el volcado dejaria de ser determinista.
  const f = base();
  f.variantes = [
    { id: 10, producto_id: 1, sku: 'X-9', color: 'Negro', color_hex: null, activo: 1, orden: 0 },
    { id: 11, producto_id: 1, sku: 'X-1', color: 'Negro', color_hex: null, activo: 1, orden: 0 },
  ];
  f.imagenes = [];
  assert.deepEqual(
    uno(f).variantes.map((v) => v.sku),
    ['X-1', 'X-9']
  );
});

test('un orden ausente no rompe el ordenamiento', () => {
  // Defensa: la columna es NOT NULL con default 0, pero construirProductos recibe
  // filas de cualquier origen y un NaN en el comparador desordenaria todo.
  const f = base();
  f.variantes = [
    { id: 10, producto_id: 1, sku: 'X-1', color: 'Rojo', color_hex: null, activo: 1 },
    { id: 11, producto_id: 1, sku: 'X-2', color: 'Azul', color_hex: null, activo: 1 },
  ];
  f.imagenes = [];
  assert.deepEqual(
    uno(f).variantes.map((v) => v.color),
    ['Azul', 'Rojo']
  );
});

test('las imagenes de una variante respetan la columna orden', () => {
  const f = base();
  f.imagenes = [
    { variante_id: 10, hash16: 'bbbbbbbbbbbbbbbb', anchos: '[300]', orden: 1 },
    { variante_id: 10, hash16: 'aaaaaaaaaaaaaaaa', anchos: '[300]', orden: 0 },
  ];
  const v = uno(f).variantes.find((x) => x.sku === 'CG85527-P');
  assert.deepEqual(
    v.imagenes.map((i) => i.base),
    ['catalogo/aaaaaaaaaaaaaaaa', 'catalogo/bbbbbbbbbbbbbbbb']
  );
});

test('anchos puede ser solo [300] cuando el origen no alcanzaba a 600', () => {
  // SPEC §5.5: por debajo de 600 px solo se genera w300. srcSetImagen() emite
  // unicamente los anchos que existen, asi que el dato tiene que ser fiel.
  const f = base();
  f.imagenes = [{ variante_id: 10, hash16: 'aaaaaaaaaaaaaaaa', anchos: '[300]', orden: 0 }];
  const v = uno(f).variantes.find((x) => x.sku === 'CG85527-P');
  assert.deepEqual(v.imagenes[0].anchos, [300]);
});

// --------------------------------------------------------------------------
// Determinismo (SPEC §6.5) — es lo que hace legible el diff de git
// --------------------------------------------------------------------------

test('los productos se ordenan por id', () => {
  const f = base();
  f.productos.push({
    ...f.productos[0],
    id: 2,
    codigo: 'CG84102',
    slug: 'aaa-primero',
    nombre: 'AAA',
  });
  f.categorias.push({ producto_id: 2, categoria_slug: 'mochilas', orden: 0 });
  f.variantes.push({
    id: 20, producto_id: 2, sku: 'CG84102-A', color: 'Azul', color_hex: null, activo: 1, orden: 0,
  });
  assert.deepEqual(
    construirProductos(f).map((p) => p.id),
    ['aaa-primero', 'cartera-de-fiesta-con-strass']
  );
});

test('serializar produce las claves en orden alfabetico', () => {
  const salida = serializar(construirProductos(base()));
  const claves = [...salida.matchAll(/^ {4}"([a-zA-Z]+)":/gm)].map((m) => m[1]);
  assert.deepEqual(claves, [...claves].sort(), `las claves deben ir ordenadas: ${claves}`);
});

test('serializar es byte-identico entre dos llamadas', () => {
  // Es exactamente el criterio de salida de la Fase 2.2: dos volcados seguidos
  // dan git diff --exit-code limpio.
  const a = serializar(construirProductos(base()));
  const b = serializar(construirProductos(base()));
  assert.equal(a, b);
});

test('serializar termina en un unico salto de linea', () => {
  // Sin el, git marca "\ No newline at end of file" en cada volcado.
  const s = serializar(construirProductos(base()));
  assert.ok(s.endsWith('\n'));
  assert.ok(!s.endsWith('\n\n'));
});

test('serializar usa indentacion de 2 espacios', () => {
  const s = serializar(construirProductos(base()));
  assert.ok(s.startsWith('[\n  {\n'), `arranque inesperado: ${JSON.stringify(s.slice(0, 12))}`);
});

// --------------------------------------------------------------------------
// Invariantes: fallar fuerte y temprano, donde la causa se ve
// --------------------------------------------------------------------------

test('un producto publicable sin slug es un bug: lanza', () => {
  // El slug se genera al aprobar (SPEC-etapa2 §5.2). Si falta a esta altura,
  // el estado y el slug quedaron desincronizados en la base.
  const f = base();
  f.productos[0].slug = null;
  assert.throws(() => construirProductos(f), /slug/i);
});

test('un producto sin categorias lanza en vez de romper el build del sitio', () => {
  // content.config.ts exige min(1) y reference() valida cada slug. Fallar aca da
  // el codigo del producto; fallar en astro build da un error de Zod sin contexto.
  const f = base();
  f.categorias = [];
  assert.throws(() => construirProductos(f), /CG85527/);
});

test('un producto sin variantes lanza', () => {
  // min(1) en el schema: sin variante no hay imagen ni SKU (SPEC §4.2).
  const f = base();
  f.variantes = [];
  f.imagenes = [];
  assert.throws(() => construirProductos(f), /CG85527/);
});

test('un producto sin nombre lanza', () => {
  // nombre es obligatorio para aprobar (SPEC-etapa2 §5.2). Llegar al volcado sin
  // nombre significa que la validacion del admin se saltó.
  const f = base();
  f.productos[0].nombre = null;
  assert.throws(() => construirProductos(f), /CG85527/);
});

test('un hash16 mal formado lanza en vez de generar una URL rota', () => {
  // Una base invalida no produce error: produce una imagen rota en produccion,
  // que es mucho mas caro de diagnosticar (mismo criterio que validarBaseR2).
  const f = base();
  f.imagenes = [{ variante_id: 10, hash16: 'NO-ES-HEX', anchos: '[300]', orden: 0 }];
  assert.throws(() => construirProductos(f), /hash16|NO-ES-HEX/);
});

test('un ancho fuera de {300,600} lanza', () => {
  // content.config.ts los declara como literales 300 | 600.
  const f = base();
  f.imagenes = [{ variante_id: 10, hash16: 'aaaaaaaaaaaaaaaa', anchos: '[900]', orden: 0 }];
  assert.throws(() => construirProductos(f), /900|ancho/i);
});

test('una variante huerfana, sin producto, lanza', () => {
  const f = base();
  f.variantes.push({
    id: 99, producto_id: 404, sku: 'X-9', color: 'Gris', color_hex: null, activo: 1, orden: 0,
  });
  assert.throws(() => construirProductos(f), /404/);
});

// --------------------------------------------------------------------------
// contarEnElCatalogo
// --------------------------------------------------------------------------

/**
 * El numero que la Action reporta al admin (§11.3).
 *
 * Existe porque `productos.json.length` NO es ese numero y se veia como un bug: el
 * panel decia «281 productos en el catalogo» mientras la tarjeta del tablero decia
 * 270. Los 11 de diferencia eran los eliminados, que van al JSON a proposito —con
 * `activo: false`, para que su direccion no quede rota— pero que estan justamente
 * FUERA del catalogo.
 */
test('contarEnElCatalogo no cuenta los eliminados', () => {
  assert.equal(
    contarEnElCatalogo([{ id: 'a' }, { id: 'b', activo: false }, { id: 'c' }]),
    2
  );
});

test('contarEnElCatalogo cuenta al que no declara `activo`', () => {
  // `construirProductos` solo ESCRIBE `activo` cuando vale false; el resto sale sin
  // el campo y Zod le pone `true` al leerlo. Contar por `=== true` daria siempre 0.
  assert.equal(contarEnElCatalogo([{ id: 'a' }, { id: 'b' }]), 2);
});

test('contarEnElCatalogo sobre la salida real de construirProductos', () => {
  // Contra el productor real y no contra literales: si `construir` cambiara la forma
  // en que apaga un producto, este test se entera y el de arriba no.
  const f = base();
  f.productos[0].estado = 'eliminado';
  assert.equal(contarEnElCatalogo(construirProductos(f)), 0);
});
