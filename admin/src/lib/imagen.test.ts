import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ANCHOS, anchosParaLado, calcularEncuadre, recorteCentrado, skuDe } from './imagen.ts';

/**
 * Tests de las reglas de imagen (SPEC-etapa2 §8, SPEC.md §5.2, §5.5, §6.10).
 *
 * Son puras a propósito: deciden cuántas derivadas se generan y qué pedazo del
 * original entra en el cuadrado, y eso se puede probar sin canvas ni navegador. Lo
 * que corre en el navegador es el `drawImage` con estos números.
 *
 * La regla que sostiene todo: **nunca se amplía**. Ampliar inventa píxeles, y una
 * foto borrosa en el catálogo es peor que una foto chica (SPEC.md §5.5).
 */

// --------------------------------------------------------------------------
// Qué derivadas se generan
// --------------------------------------------------------------------------

test('600 o más genera las dos derivadas', () => {
  assert.deepEqual(anchosParaLado(600), [300, 600]);
  assert.deepEqual(anchosParaLado(4000), [300, 600]);
});

test('entre 300 y 599 genera solo w300', () => {
  // Generar w600 desde un origen de 599 seria ampliar 1 px: inventado igual.
  assert.deepEqual(anchosParaLado(599), [300]);
  assert.deepEqual(anchosParaLado(300), [300]);
});

test('menos de 300 no genera nada: va el placeholder', () => {
  // SPEC.md §5.4: el producto sigue visible y contactable, con el hueco rotulado.
  assert.deepEqual(anchosParaLado(299), []);
  assert.deepEqual(anchosParaLado(0), []);
});

test('ANCHOS es el contrato de content.config.ts, no una lista suelta', () => {
  assert.deepEqual([...ANCHOS], [300, 600]);
});

// --------------------------------------------------------------------------
// El encuadre sin recorte: el camino del scrape
// --------------------------------------------------------------------------

test('una imagen cuadrada mas grande se reduce y llena el cuadro', () => {
  const e = calcularEncuadre({ anchoOrigen: 1200, altoOrigen: 1200, lado: 600 });
  assert.deepEqual(e, { sx: 0, sy: 0, sw: 1200, sh: 1200, dx: 0, dy: 0, dw: 600, dh: 600 });
});

test('una apaisada se centra vertical y deja relleno arriba y abajo', () => {
  // 1200x600 -> escala 0.5 -> 600x300 centrado en un cuadro de 600.
  const e = calcularEncuadre({ anchoOrigen: 1200, altoOrigen: 600, lado: 600 });
  assert.equal(e.dw, 600);
  assert.equal(e.dh, 300);
  assert.equal(e.dx, 0);
  assert.equal(e.dy, 150, 'el relleno se reparte igual arriba y abajo');
});

test('una vertical se centra horizontal', () => {
  const e = calcularEncuadre({ anchoOrigen: 600, altoOrigen: 1200, lado: 600 });
  assert.equal(e.dw, 300);
  assert.equal(e.dh, 600);
  assert.equal(e.dx, 150);
  assert.equal(e.dy, 0);
});

test('NUNCA amplia: un origen mas chico que el cuadro va a tamaño real', () => {
  // El invariante de §5.5. Si esto se rompe, la grilla se llena de fotos borrosas.
  const e = calcularEncuadre({ anchoOrigen: 200, altoOrigen: 150, lado: 600 });
  assert.equal(e.dw, 200, 'no se estira');
  assert.equal(e.dh, 150);
  assert.equal(e.dx, 200, '(600-200)/2');
  assert.equal(e.dy, 225, '(600-150)/2');
});

test('el area dibujada nunca se sale del cuadro', () => {
  // Propiedad general sobre muchas formas: si esto falla, la derivada sale cortada.
  const formas: Array<[number, number]> = [
    [1, 1], [1, 4000], [4000, 1], [601, 599], [300, 301], [4000, 3000], [17, 4001],
  ];
  for (const lado of ANCHOS) {
    for (const [w, h] of formas) {
      const e = calcularEncuadre({ anchoOrigen: w, altoOrigen: h, lado });
      assert.ok(e.dx >= 0 && e.dy >= 0, `negativo en ${w}x${h}@${lado}`);
      assert.ok(e.dx + e.dw <= lado, `se pasa a lo ancho en ${w}x${h}@${lado}`);
      assert.ok(e.dy + e.dh <= lado, `se pasa a lo alto en ${w}x${h}@${lado}`);
    }
  }
});

test('conserva la proporcion del origen', () => {
  // Sin esto la foto sale estirada, que es peor que salir chica.
  const e = calcularEncuadre({ anchoOrigen: 4000, altoOrigen: 3000, lado: 600 });
  assert.ok(Math.abs(e.dw / e.dh - 4000 / 3000) < 0.01, `${e.dw}x${e.dh}`);
});

// --------------------------------------------------------------------------
// El encuadre CON recorte: el camino de la carga manual (§8.3)
// --------------------------------------------------------------------------

test('con recorte, se dibuja solo el pedazo elegido', () => {
  const e = calcularEncuadre({
    anchoOrigen: 4000,
    altoOrigen: 3000,
    lado: 600,
    recorte: { x: 1000, y: 500, lado: 2000 },
  });
  assert.deepEqual(
    { sx: e.sx, sy: e.sy, sw: e.sw, sh: e.sh },
    { sx: 1000, sy: 500, sw: 2000, sh: 2000 }
  );
  // El recorte es cuadrado, asi que llena el cuadro sin relleno.
  assert.deepEqual({ dx: e.dx, dy: e.dy, dw: e.dw, dh: e.dh }, { dx: 0, dy: 0, dw: 600, dh: 600 });
});

test('un recorte CHICO no se amplia tampoco', () => {
  const e = calcularEncuadre({
    anchoOrigen: 4000,
    altoOrigen: 3000,
    lado: 600,
    recorte: { x: 0, y: 0, lado: 250 },
  });
  assert.equal(e.dw, 250);
  assert.equal(e.dx, 175);
});

test('las derivadas se deciden por el RECORTE, no por el original', () => {
  // El caso que se escapa: una foto de 4000x3000 recortada a 250x250 no puede
  // generar w300 — serian 50 px inventados. Mirar el original diria que si.
  const efectivo = 250;
  assert.deepEqual(anchosParaLado(efectivo), []);
});

test('un recorte fuera de los limites se RECHAZA', () => {
  // Un recorte mal calculado produciria un canvas con bordes transparentes o
  // negros, segun el navegador. Cortar es mejor que subir una foto rota.
  for (const recorte of [
    { x: -1, y: 0, lado: 100 },
    { x: 0, y: -1, lado: 100 },
    { x: 3950, y: 0, lado: 100 },
    { x: 0, y: 2950, lado: 100 },
    { x: 0, y: 0, lado: 0 },
    { x: 0, y: 0, lado: 5000 },
  ]) {
    assert.throws(
      () => calcularEncuadre({ anchoOrigen: 4000, altoOrigen: 3000, lado: 600, recorte }),
      /recorte/i,
      `deberia rechazar ${JSON.stringify(recorte)}`
    );
  }
});

// --------------------------------------------------------------------------
// recorteCentrado — la propuesta inicial de la pantalla de §8.3
// --------------------------------------------------------------------------

test('recorteCentrado toma el cuadrado mas grande que entra, centrado', () => {
  assert.deepEqual(recorteCentrado(4000, 3000), { x: 500, y: 0, lado: 3000 });
  assert.deepEqual(recorteCentrado(3000, 4000), { x: 0, y: 500, lado: 3000 });
  assert.deepEqual(recorteCentrado(800, 800), { x: 0, y: 0, lado: 800 });
});

test('recorteCentrado siempre produce un recorte valido', () => {
  for (const [w, h] of [[4000, 3000], [1, 9999], [9999, 1], [601, 599]] as Array<[number, number]>) {
    const r = recorteCentrado(w, h);
    assert.doesNotThrow(() =>
      calcularEncuadre({ anchoOrigen: w, altoOrigen: h, lado: 600, recorte: r })
    );
  }
});

// --------------------------------------------------------------------------
// SKU (§9)
// --------------------------------------------------------------------------

test('el sku es codigo-slug(color), nunca un indice posicional', () => {
  // SPEC.md §6.6: agregar un color no puede mover los SKU existentes.
  assert.equal(skuDe('CG85527', 'Azul marino'), 'CG85527-azul-marino');
  assert.equal(skuDe('CG85527', 'Ñandutí'), 'CG85527-nanduti');
});

test('dos colores distintos dan skus distintos', () => {
  assert.notEqual(skuDe('CG1', 'Rojo'), skuDe('CG1', 'Rosa'));
});

test('un color sin nada slugificable revienta en vez de dar un sku ambiguo', () => {
  // "CG1-" seria un sku valido para cualquier color roto: dos variantes chocarian
  // contra el UNIQUE y el error apareceria lejos de la causa.
  assert.throws(() => skuDe('CG1', '???'), /color/i);
});
