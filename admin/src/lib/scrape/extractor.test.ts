import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AcumuladorFicha, fotosPorColor } from './extractor.ts';
import { skuDeOrigen } from './origen.ts';

/**
 * Los casos salen de HTML REAL, bajado y medido el 2026-08-06 sobre
 * `/producto/71163-cg85700` y `/producto/71803-cg86003`. No son fixtures inventados:
 * cada secuencia de eventos reproduce el orden en que `HTMLRewriter` los emitiría
 * sobre esas páginas.
 */

const HOST = 'https://www.chenson.com.py';
/** Los `src` del origen traen el puerto explícito. Se replica tal cual. */
const IMG = (hash: string) => `${HOST}:443/Prelude-images/product/${hash}.jpg`;

// --- CG85700: 3 colores, 1 foto. El caso completo. ---

/** Reproduce el orden real de eventos de `/producto/71163-cg85700`. */
function cg85700(): AcumuladorFicha {
  const a = new AcumuladorFicha(`${HOST}/producto/71163-cg85700`);

  a.verMeta('og:title', 'Producto: CG85700 (3) NEGRO');

  // Galeria: la MISMA foto dos veces, normal y con class="magniflier".
  a.verImagen({ src: IMG('aaa1'), alt: 'product-thumb' });
  a.verImagen({ src: IMG('aaa1'), alt: 'product-thumb' });

  // Hermano 1: dos <a> al mismo href, uno con la miniatura y otro con el texto.
  a.abrirEnlace('/producto/71301-cg85700');
  a.verImagen({ src: IMG('bbb2'), title: '(T) MARRON CLARO' });
  a.cerrarEnlace();
  a.abrirEnlace('/producto/71301-cg85700');
  a.verTexto('(T) MARRON CLARO');
  a.cerrarEnlace();

  // Hermano 2.
  a.abrirEnlace('/producto/71350-cg85700');
  a.verImagen({ src: IMG('ccc3'), title: '(B) MARRON' });
  a.cerrarEnlace();
  a.abrirEnlace('/producto/71350-cg85700');
  a.verTexto('(B) MARRON');
  a.cerrarEnlace();

  return a;
}

test('el color de la ficha abierta sale del og:title', () => {
  // Es el unico lugar donde esta. Sin esto, de un modelo de 3 colores entrarian 2 y
  // el que falta seria SIEMPRE el que estabas mirando, sin ningun error.
  assert.equal(cg85700().resultado().colorOrigen, '(3) NEGRO');
});

test('los dos colores hermanos entran una sola vez cada uno, con su foto', () => {
  /**
   * LA FOTO DEL HERMANO ESTÁ ACÁ Y NO HAY QUE IR A BUSCARLA. Medido el 2026-08-07
   * sobre `/producto/71163-cg85700`: la imagen del bloque de colores es el MISMO
   * archivo de 600×600 que sirve la ficha propia del hermano — mismo hash, mismo peso.
   *
   * Sin esto, los colores hermanos entran como variantes y se quedan SIN FOTO, porque
   * su ficha nunca se visita (la saltea el corte por código de la cortesía §7.4).
   */
  const { hermanos } = cg85700().resultado();
  assert.deepEqual(hermanos, [
    {
      url: `${HOST}/producto/71301-cg85700`,
      colorOrigen: '(T) MARRON CLARO',
      foto: `${HOST}/Prelude-images/product/bbb2.jpg`,
    },
    {
      url: `${HOST}/producto/71350-cg85700`,
      colorOrigen: '(B) MARRON',
      foto: `${HOST}/Prelude-images/product/ccc3.jpg`,
    },
  ]);
});

test('la foto del hermano no se cuela entre las fotos de esta ficha', () => {
  // Es la otra mitad de la regla: la foto del hermano es DEL HERMANO. Colgarla acá le
  // pondria a esta variante la foto del color equivocado.
  const r = cg85700().resultado();
  assert.deepEqual(r.fotos, [`${HOST}/Prelude-images/product/aaa1.jpg`]);
  assert.ok(r.hermanos.every((h) => !r.fotos.includes(h.foto!)));
});

test('la foto del hermano se normaliza igual que las propias', () => {
  // Sin normalizar el `:443`, la misma imagen entraria dos veces a R2.
  for (const h of cg85700().resultado().hermanos) {
    assert.ok(h.foto && !h.foto.includes(':443'), `${h.url} deberia venir sin puerto`);
  }
});

test('gana la primera imagen del hermano, no la última', () => {
  /**
   * El proveedor emite dos `<a>` por hermano. Si algún día el segundo llevara un icono
   * de la ruta de imágenes, pisaría la foto de verdad — y el síntoma seria la foto
   * equivocada, no un error.
   */
  const a = new AcumuladorFicha(`${HOST}/producto/71163-cg85700`);
  a.abrirEnlace('/producto/71301-cg85700');
  a.verImagen({ src: IMG('buena'), title: '(T) MARRON CLARO' });
  a.verImagen({ src: IMG('despues'), title: '(T) MARRON CLARO' });
  a.cerrarEnlace();
  assert.equal(a.resultado().hermanos[0].foto, `${HOST}/Prelude-images/product/buena.jpg`);
});

test('la foto repetida por el zoom no se duplica', () => {
  // La galeria emite la misma imagen dos veces: normal y class="magniflier".
  assert.deepEqual(cg85700().resultado().fotos, [`${HOST}/Prelude-images/product/aaa1.jpg`]);
});

test('el puerto 443 explícito se normaliza', () => {
  // Comparar los strings crudos duplicaria cada imagen contra la ya guardada.
  assert.ok(!cg85700().resultado().fotos[0].includes(':443'));
});

test('las miniaturas de color NO son fotos del producto', () => {
  // Colgarselas a esta variante le pondria la foto del color equivocado, y eso llega
  // hasta el cliente que pide por WhatsApp.
  const { fotos } = cg85700().resultado();
  assert.equal(fotos.length, 1);
  assert.ok(!fotos.some((f) => /bbb2|ccc3/.test(f)));
});

// --- CG86003: sin hermanos, con carrusel de recomendados ---

test('los recomendados del carrusel se descartan', () => {
  /**
   * EL HALLAZGO MAS IMPORTANTE DEL SPIKE. El carrusel ROTA EN CADA REQUEST: medido
   * sobre 3 corridas, 1 imagen estable y 4 distintas cada vez. Barrerlas rompe la
   * idempotencia de §7.5 sin producir ningun error.
   *
   * Se distinguen por el `alt`, que trae el codigo del OTRO producto. La hipotesis
   * estructural —"un recomendado cuelga de un <a> a otro producto"— SE MIDIO FALSA.
   */
  const a = new AcumuladorFicha(`${HOST}/producto/71803-cg86003`);
  a.verMeta('og:title', 'Producto: CG86003 (9) AZUL');
  a.verImagen({ src: IMG('estable'), alt: 'product-thumb' });
  for (const otro of ['CG85524', 'CG85225', 'CG85568', 'CG85369']) {
    a.verImagen({ src: IMG(`rota-${otro}`), alt: otro });
  }

  const r = a.resultado();
  assert.deepEqual(r.fotos, [`${HOST}/Prelude-images/product/estable.jpg`]);
  assert.deepEqual(r.hermanos, []);
  assert.equal(r.colorOrigen, '(9) AZUL');
});

test('un enlace a otro producto no es un color hermano', () => {
  const a = new AcumuladorFicha(`${HOST}/producto/71803-cg86003`);
  a.abrirEnlace('/producto/70871-cg85524');
  a.verImagen({ src: IMG('ajena'), alt: 'product-thumb' });
  a.cerrarEnlace();

  const r = a.resultado();
  assert.deepEqual(r.hermanos, []);
  // Y su imagen tampoco entra como foto, aunque venga con el alt de galeria:
  // esta dentro de un <a> a otro producto.
  assert.deepEqual(r.fotos, []);
});

// --- Reglas transversales ---

test('la ficha no se toma a sí misma como hermana', () => {
  const a = new AcumuladorFicha(`${HOST}/producto/71163-cg85700`);
  a.abrirEnlace('/producto/71163-cg85700');
  a.cerrarEnlace();
  assert.deepEqual(a.resultado().hermanos, []);
});

test('el título de otro código no aporta color', () => {
  const a = new AcumuladorFicha(`${HOST}/producto/71163-cg85700`);
  a.verMeta('og:title', 'Producto: CG99999 (3) NEGRO');
  assert.equal(a.resultado().colorOrigen, null);
});

test('el <title> sirve de respaldo si no hay og:title', () => {
  const a = new AcumuladorFicha(`${HOST}/producto/71163-cg85700`);
  a.verTitulo('Producto: CG85700 (3) NEGRO');
  assert.equal(a.resultado().colorOrigen, '(3) NEGRO');
});

test('las imágenes fuera de la ruta del proveedor se ignoran', () => {
  const a = new AcumuladorFicha(`${HOST}/producto/71803-cg86003`);
  a.verImagen({ src: `${HOST}/static/logo.png`, alt: 'product-thumb' });
  a.verImagen({ src: null, alt: 'product-thumb' });
  assert.deepEqual(a.resultado().fotos, []);
});

test('un hermano sin nombre de color entra igual, con color nulo', () => {
  // Es preferible una variante que alguien tiene que nombrar a mano, a perder el
  // color entero en silencio.
  const a = new AcumuladorFicha(`${HOST}/producto/71163-cg85700`);
  a.abrirEnlace('/producto/71301-cg85700');
  a.cerrarEnlace();
  assert.deepEqual(a.resultado().hermanos, [
    { url: `${HOST}/producto/71301-cg85700`, colorOrigen: null, foto: null },
  ]);
});

test('un hermano cuyo enlace no lleva imagen queda con foto nula, no rota', () => {
  // El bloque de colores emite un `<a>` con la miniatura y otro con el texto: el
  // segundo no tiene imagen y no puede dejar la foto en `undefined`.
  const a = new AcumuladorFicha(`${HOST}/producto/71163-cg85700`);
  a.abrirEnlace('/producto/71301-cg85700');
  a.verTexto('(T) MARRON CLARO');
  a.cerrarEnlace();
  assert.equal(a.resultado().hermanos[0].foto, null);
});

// --- A qué variante va cada foto ---

test('fotosPorColor reparte la galería propia y la foto de cada hermano', () => {
  /**
   * EL BUG QUE ESTA FUNCIÓN CIERRA: sólo el color de la ficha visitada recibía fotos.
   * Los hermanos entraban como variantes y se quedaban vacíos, porque su ficha nunca se
   * visita — la saltea el corte por código de §7.4. Se veían los colores, sin imagen.
   */
  assert.deepEqual(fotosPorColor(cg85700().resultado()), [
    { sku: 'CG85700-3', fotos: [`${HOST}/Prelude-images/product/aaa1.jpg`] },
    { sku: 'CG85700-T', fotos: [`${HOST}/Prelude-images/product/bbb2.jpg`] },
    { sku: 'CG85700-B', fotos: [`${HOST}/Prelude-images/product/ccc3.jpg`] },
  ]);
});

test('fotosPorColor usa el MISMO SKU que registra la variante', () => {
  // Si no coincidiera, la foto se vincularia a un SKU que no existe y el error
  // aparecería lejos de la causa.
  const ficha = cg85700().resultado();
  const propio = fotosPorColor(ficha)[0];
  assert.equal(propio.sku, skuDeOrigen(ficha.codigo, ficha.colorOrigen!));
});

test('fotosPorColor saltea un color sin nombre: no hay SKU donde colgar la foto', () => {
  const a = new AcumuladorFicha(`${HOST}/producto/71163-cg85700`);
  a.abrirEnlace('/producto/71301-cg85700');
  a.verImagen({ src: IMG('huerfana') });
  a.cerrarEnlace();
  assert.deepEqual(fotosPorColor(a.resultado()), []);
});

test('fotosPorColor saltea un color cuyo nombre no da SKU, sin lanzar', () => {
  // `skuDeOrigen` lanza si del color no queda nada slugificable. Un color roto no puede
  // tumbar la ficha entera: el producto ya se registró.
  const a = new AcumuladorFicha(`${HOST}/producto/71163-cg85700`);
  a.abrirEnlace('/producto/71301-cg85700');
  a.verImagen({ src: IMG('bbb2'), title: '...' });
  a.cerrarEnlace();
  assert.doesNotThrow(() => fotosPorColor(a.resultado()));
  assert.deepEqual(fotosPorColor(a.resultado()), []);
});

test('fotosPorColor no inventa una entrada para un color sin fotos', () => {
  const a = new AcumuladorFicha(`${HOST}/producto/71163-cg85700`);
  a.verMeta('og:title', 'Producto: CG85700 (3) NEGRO');
  a.abrirEnlace('/producto/71301-cg85700');
  a.verTexto('(T) MARRON CLARO');
  a.cerrarEnlace();
  // El propio tampoco tiene galeria en este HTML: la lista queda vacia.
  assert.deepEqual(fotosPorColor(a.resultado()), []);
});

test('correr la misma ficha dos veces da exactamente lo mismo', () => {
  // Es la precondicion de §7.5: sin salida determinista, el `git diff --exit-code`
  // que verifica la idempotencia no puede funcionar.
  assert.deepEqual(cg85700().resultado(), cg85700().resultado());
});

test('una URL que no es ficha se rechaza al construir', () => {
  assert.throws(() => new AcumuladorFicha(`${HOST}/lanzamientos/?lz=2026-07-16`), /ficha/i);
});

// --- Las medidas ---

/**
 * Los casos salen de HTML REAL, bajado y medido el 2026-08-12 sobre ocho fichas del
 * proveedor. La estructura es siempre la misma tabla de dos celdas:
 *
 *   <td><span>Medidas: ( alto x largo x ancho ):</span></td>
 *   <td>21 x 29 x 14cm</td>
 *
 * LAS OCHO TRAEN MEDIDAS, y la extracción se verificó contra esos ocho HTML: las nueve
 * páginas guardadas dan el valor correcto. Que el campo sea nullable es una falla
 * segura, no un caso observado: si mañana una ficha no las trae, entra sin descripción
 * en vez de tumbar la importación de la tanda.
 *
 * El texto de la etiqueta NO se toma del proveedor. Él escribe `Medidas:`, con
 * espacios sueltos dentro del paréntesis y sin espacio antes de `cm`. Lo que se
 * guarda es la redacción del catálogo, que es la que ve el cliente.
 */
function conMedidas(valor: string): AcumuladorFicha {
  const a = new AcumuladorFicha(`${HOST}/producto/70415-cg85398`);
  a.verMeta('og:title', 'Producto: CG85398 (3) NEGRO');

  // El texto de la etiqueta viene dentro de un <span>, no pegado al <td>.
  a.abrirCelda();
  a.verTextoCelda('\n     Medidas: ( alto x largo x ancho ):\n    ');
  a.cerrarCelda();

  a.abrirCelda();
  a.verTextoCelda(`\n     ${valor}                    `);
  a.cerrarCelda();

  return a;
}

test('las medidas salen de la celda que sigue a la etiqueta', () => {
  assert.equal(
    conMedidas('21 x 29 x 14cm').resultado().medidas,
    'Medidas aprox. (alto x largo x ancho): 21 x 29 x 14 cm'
  );
});

test('la unidad se separa del número y el separador se normaliza', () => {
  // El proveedor escribe `14cm` pegado. Sin esto, la ficha publica muestra el
  // literal del origen y no el castellano del catalogo.
  assert.equal(
    conMedidas('18 X 27 X 8cm').resultado().medidas,
    'Medidas aprox. (alto x largo x ancho): 18 x 27 x 8 cm'
  );
});

test('una ficha sin la tabla de medidas no las inventa', () => {
  // `null`, no una cadena vacia: la ficha publica pregunta por la descripcion para
  // decidir si dibuja el parrafo, asi que un '' le dejaria un bloque en blanco.
  assert.equal(cg85700().resultado().medidas, null);
});

test('una celda con valor pero sin etiqueta antes no es una medida', () => {
  /**
   * La pagina tiene TRES tablas. `#other-colors-tbl` lista los colores hermanos, y
   * sus celdas pasan por el mismo handler. Sin la etiqueta como llave, el nombre de
   * un color terminaria en la descripcion del producto.
   */
  const a = new AcumuladorFicha(`${HOST}/producto/70415-cg85398`);
  a.abrirCelda();
  a.verTextoCelda('(3) NEGRO');
  a.cerrarCelda();
  assert.equal(a.resultado().medidas, null);
});

test('la etiqueta sin un valor con números detrás no deja medidas a medias', () => {
  // Si el proveedor deja la celda vacia, la etiqueta sola no dice nada: mejor sin
  // descripcion que con «Medidas aprox. (alto x largo x ancho):» y nada despues.
  const a = conMedidas('   ');
  assert.equal(a.resultado().medidas, null);
});

test('la primera tabla de medidas gana', () => {
  // Misma regla que el titulo y que la foto del hermano: si apareciera una segunda,
  // pisar la primera daria un dato equivocado en vez de un error.
  const a = conMedidas('21 x 29 x 14cm');
  a.abrirCelda();
  a.verTextoCelda('Medidas: ( alto x largo x ancho ):');
  a.cerrarCelda();
  a.abrirCelda();
  a.verTextoCelda('99 x 99 x 99cm');
  a.cerrarCelda();
  assert.equal(a.resultado().medidas, 'Medidas aprox. (alto x largo x ancho): 21 x 29 x 14 cm');
});

test('las medidas no rompen el determinismo de la ficha', () => {
  // Misma precondicion de §7.5 que el test de arriba, ahora con el campo nuevo.
  assert.deepEqual(conMedidas('21 x 29 x 14cm').resultado(), conMedidas('21 x 29 x 14cm').resultado());
});
