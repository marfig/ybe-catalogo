import assert from 'node:assert/strict';
import { test } from 'node:test';

import { codigoDeUrlVieja, curaduriaDeHtml, productosDelSitemap, textoDeDescripcion } from './viejo.ts';

/**
 * Los casos salen de HTML REAL de `chensonasuncionybe.catalogst.com`, bajado y medido
 * el 2026-08-12 sobre `lonchera-termica-de-barbie-5551115`,
 * `mochila-reforzada-con-ruedas-grande-8181421`, `mochila-con-ruedas-grande-8734090` y
 * `cartuchera-doble-cierre-1734033`.
 */

const HOST = 'https://chensonasuncionybe.catalogst.com';

// --- El sitemap: la lista de trabajo ---

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${HOST}/</loc></url>
  <url><loc>${HOST}/catalog</loc></url>
  <url><loc>${HOST}/category/escolar-varon-qsWDlkjb1v</loc></url>
  <url><loc>${HOST}/product/lonchera-termica-de-barbie-5551115</loc></url>
  <url><loc>${HOST}/product/mochila-con-ruedas-pequena-de-sonic-SC22Y80</loc></url>
</urlset>`;

test('del sitemap salen los productos y nada más', () => {
  /**
   * De 401 URLs reales, 368 son productos y el resto categorias y paginas fijas. El
   * sitemap ES la lista de trabajo: los listados del sitio cortan en 24 items con
   * scroll infinito, asi que recorrerlos daria un inventario incompleto.
   */
  assert.deepEqual(productosDelSitemap(SITEMAP), [
    { codigo: '5551115', url: `${HOST}/product/lonchera-termica-de-barbie-5551115` },
    { codigo: 'SC22Y80', url: `${HOST}/product/mochila-con-ruedas-pequena-de-sonic-SC22Y80` },
  ]);
});

test('el código es la cola del slug, en mayúsculas', () => {
  // Medido: `sku` del JSON-LD === cola del slug en 15 de 15 fichas. Por eso los 368
  // codigos se derivan del sitemap sin pedir una sola ficha.
  assert.equal(codigoDeUrlVieja(`${HOST}/product/lonchera-termica-de-barbie-5551115`), '5551115');
  assert.equal(codigoDeUrlVieja(`${HOST}/product/mochila-de-sonic-sc22y80`), 'SC22Y80');
});

test('una URL que no es de producto no da código', () => {
  assert.equal(codigoDeUrlVieja(`${HOST}/category/escolar-varon-qsWDlkjb1v`), null);
  assert.equal(codigoDeUrlVieja(`${HOST}/`), null);
});

// --- La descripción: párrafos, no una línea ---

test('cada párrafo del origen es una línea', () => {
  /**
   * EL JSON-LD NO SIRVE PARA ESTO. Ahi la descripcion viene aplanada con espacios:
   * «Medidas: alto 25 x largo 21 x ancho 13 cm Con asas largas». El cuerpo la guarda
   * como HTML con `<p>`, y el sitio viejo la rinde con `whitespace-pre-line` — la misma
   * solucion que nuestra ficha. Los saltos son del autor y hay que conservarlos.
   */
  assert.equal(
    textoDeDescripcion('<p>Medidas: alto 25 x largo 21 x ancho 13 cm</p><p>Con asas largas </p>'),
    'Medidas: alto 25 x largo 21 x ancho 13 cm\nCon asas largas'
  );
});

test('tres párrafos dan tres líneas', () => {
  assert.equal(
    textoDeDescripcion(
      '<p>Medidas: alto 47 x largo 31 x ancho 25 cm</p><p>Impermeable, de 4 cierres, porta notebook, manija de aluminio y ruedas reforzadas.</p><p>Disponible solo en color negro</p>'
    ),
    'Medidas: alto 47 x largo 31 x ancho 25 cm\n' +
      'Impermeable, de 4 cierres, porta notebook, manija de aluminio y ruedas reforzadas.\n' +
      'Disponible solo en color negro'
  );
});

test('la lista de colores se descarta: acá los colores son variantes', () => {
  /**
   * En el modelo nuevo un color es una VARIANTE con su SKU y su foto, que salen de la
   * ficha del proveedor. Repetirlos como prosa es contarlos dos veces, y peor: la lista
   * del catalogo viejo puede no coincidir con lo que el proveedor publica hoy.
   *
   * Se descartan por ESTRUCTURA —la lista y el renglon que la titula— y no cortando
   * hasta el final del texto. Si algun producto escribiera algo DESPUES de los colores,
   * cortar lo perderia; asi sobrevive.
   */
  assert.equal(
    textoDeDescripcion(
      '<p>Medidas: alto 44 x largo 31 x ancho 13 cm</p><p>Para libros 📚 y carpetas 📂 </p><p>Colores disponibles:</p><p><br></p><ol><li>Fucsia</li><li>Celeste</li><li>Lila</li></ol>'
    ),
    'Medidas: alto 44 x largo 31 x ancho 13 cm\nPara libros 📚 y carpetas 📂'
  );
});

test('un producto que SÓLO tenía colores queda sin descripción', () => {
  /**
   * Caso real: `cartuchera-doble-cierre-1734033`. Devuelve `null` y no cadena vacia, y
   * de eso depende el `COALESCE` del UPDATE: con `null` la descripcion NO se pisa y
   * quedan las medidas que sembro la ficha del proveedor.
   */
  assert.equal(
    textoDeDescripcion(
      '<p>Colores disponibles:</p><ol><li>Negro</li><li>Negro/gris </li><li>Rojo</li></ol>'
    ),
    null
  );
});

test('el párrafo vacío es una línea en blanco, no basura', () => {
  assert.equal(textoDeDescripcion('<p>Uno</p><p><br></p><p>Dos</p>'), 'Uno\n\nDos');
});

test('nunca más de una línea en blanco seguida', () => {
  // El origen mete `<p><br></p>` de a varios. Tres saltos seguidos en la ficha se ven
  // como un hueco, no como una separacion.
  assert.equal(textoDeDescripcion('<p>Uno</p><p><br></p><p><br></p><p><br></p><p>Dos</p>'), 'Uno\n\nDos');
});

test('las entidades HTML se decodifican', () => {
  // Sin esto la ficha publica muestra `&amp;` literal: el valor viaja como texto a un
  // `<textarea>` y despues a un nodo de texto, no como HTML.
  assert.equal(textoDeDescripcion('<p>Cuero &amp; tela</p><p>10&nbsp;cm</p>'), 'Cuero & tela\n10 cm');
});

test('sin descripción no se inventa una', () => {
  assert.equal(textoDeDescripcion(''), null);
  assert.equal(textoDeDescripcion('<p></p><p><br></p>'), null);
});

// --- La ficha completa ---

const FICHA = `<html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Lonchera térmica de barbie","sku":"5551115","image":["https://cdn.catalog-store.link/aaa_photo.webp"],"description":"Medidas: alto 25 x largo 21 x ancho 13 cm Con asas largas","offers":{"@type":"Offer","price":128000}}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[]}</script>
</head><body>
<div class="descripcion-html whitespace-pre-line text-sm"><p>Medidas: alto 25 x largo 21 x ancho 13 cm</p><p>Con asas largas </p></div>
</body></html>`;

test('de la ficha salen nombre, precio y descripción', () => {
  assert.deepEqual(curaduriaDeHtml(FICHA), {
    nombre: 'Lonchera térmica de barbie',
    precio: 128000,
    // Del CUERPO, con su salto: la del JSON-LD viene aplanada.
    descripcion: 'Medidas: alto 25 x largo 21 x ancho 13 cm\nCon asas largas',
  });
});

test('el precio es un entero: el guaraní no tiene decimales', () => {
  const con = (p: string) => curaduriaDeHtml(FICHA.replace('"price":128000', `"price":${p}`));
  assert.equal(con('128000.0')?.precio, 128000);
  // Un precio que no es un entero positivo no es un precio: mejor null y que lo
  // escriba una persona, que un 0 publicado como si fuera real.
  assert.equal(con('0')?.precio, null);
  assert.equal(con('-5')?.precio, null);
  assert.equal(con('"gratis"')?.precio, null);
  assert.equal(con('128000.5')?.precio, null);
});

test('una ficha sin el Product del JSON-LD no se adivina', () => {
  // Si el origen cambia de forma, mejor no curar nada que curar mal 189 productos.
  assert.equal(curaduriaDeHtml('<html><body>nada</body></html>'), null);
});

test('sin el bloque del cuerpo, la descripción queda en null y no se cae', () => {
  const sinCuerpo = FICHA.replace(/<div class="descripcion-html[\s\S]*?<\/div>/, '');
  const r = curaduriaDeHtml(sinCuerpo);
  assert.equal(r?.nombre, 'Lonchera térmica de barbie');
  assert.equal(r?.descripcion, null);
});
