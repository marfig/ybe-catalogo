import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CDN_VIEJO,
  esDelCdnViejo,
  productoDeParse,
  productosDeRespuesta,
  urlDeConsulta,
  urlDeFicha,
} from './parse.ts';
import { textoDeDescripcion } from './viejo.ts';

/**
 * Los casos salen de la RESPUESTA REAL de la API del catálogo viejo, bajada y medida el
 * 2026-08-19 sobre los 366 productos de la tienda. Los tres productos que aparecen acá
 * son reales y están entre los 177 que faltan migrar:
 *
 *   `CG34337`  — 9 fotos y la lista de colores titulada «Disponibles en color:»
 *   `8732209`  — 2 fotos y la lista titulada «Colores disponibles:»
 *   `2510407`  — una sola foto y ninguna lista
 */

/** Un producto tal como lo devuelve la API, con los campos que se usan. */
const CG34337 = {
  objectId: 'aBcDeFgHiJ',
  place: { __type: 'Pointer', className: 'Place', objectId: 'KygQqU2BGC' },
  codigo: 'CG34337',
  titulo: 'Mochila reforzada con ruedas grande ',
  precio: 398000,
  tipo: 'Catalogo',
  canonical_title: 'Mochila-reforzada-con-ruedas-grande',
  body:
    '<p>De tela impermeable, manija T de aluminio y ruedas siliconadas y con luces</p>' +
    '<p>Medidas: alto 42 x largo 32 x sncho 18 cm</p>' +
    '<p>Amplio para libros 📚 y carpetas 📂</p>' +
    '<p>Disponibles en color:</p><p><br></p>' +
    '<ol><li>Negro</li><li>Celeste</li><li>Lila</li></ol><p><br></p>',
  image: [
    { __type: 'File', name: 'a_photo.webp', url: `${CDN_VIEJO}/a_photo.webp` },
    { __type: 'File', name: 'b_photo.webp', url: `${CDN_VIEJO}/b_photo.webp` },
  ],
  imageThumb: { __type: 'File', name: 'z_image.jpg', url: `${CDN_VIEJO}/z_image.jpg` },
};

const SOLO_UNA = {
  objectId: 'kLmNoPqRsT',
  place: { __type: 'Pointer', className: 'Place', objectId: 'KygQqU2BGC' },
  codigo: '2510407',
  titulo: 'Billetera sin cierre de hombre',
  precio: 98000,
  canonical_title: 'Billetera-sin-cierre-de-hombre',
  body: '<p>De cuero ecológico </p><p>Disponible en color negro </p>',
  image: [{ __type: 'File', name: 'c_photo.webp', url: `${CDN_VIEJO}/c_photo.webp` }],
};

// --- La consulta: una URL armada, sin sorpresas ---

test('la consulta filtra por la tienda y pagina', () => {
  const url = new URL(urlDeConsulta({ skip: 100, limit: 100 }));

  assert.equal(url.origin + url.pathname, 'https://ecured.ecunegocio.com/parse/classes/Post');
  assert.equal(url.searchParams.get('limit'), '100');
  assert.equal(url.searchParams.get('skip'), '100');
  // El orden fija el paginado: sin `order`, dos páginas pueden repetir y omitir filas.
  assert.equal(url.searchParams.get('order'), 'createdAt');

  const donde = JSON.parse(url.searchParams.get('where')!);
  assert.deepEqual(donde.place, {
    __type: 'Pointer',
    className: 'Place',
    objectId: 'KygQqU2BGC',
  });
});

test('la consulta por código pide un solo producto de esa tienda', () => {
  /**
   * ES LA GUARDA DEL ENDPOINT DE ALTA: la pestaña manda un código, no un producto. Los
   * datos que se van a escribir salen siempre de la API, nunca del navegador, así que un
   * código inventado devuelve cero filas en vez de escribir lo que alguien mandó.
   */
  const url = new URL(urlDeConsulta({ codigo: 'CG34337' }));
  const donde = JSON.parse(url.searchParams.get('where')!);

  assert.equal(donde.codigo, 'CG34337');
  assert.equal(donde.place.objectId, 'KygQqU2BGC');
  assert.equal(url.searchParams.get('limit'), '1');
});

test('la cuenta viaja CON las filas, no en un pedido aparte', () => {
  /**
   * Es lo que le permite a la pestaña saber cuándo dejar de paginar sin gastar un pedido de
   * más — y con un paso de 1 por segundo, cada pedido de más es un segundo de más.
   * Verificado el 2026-08-19 contra la API: `count=1` con `limit=3` devuelve `count: 366` y
   * tres filas.
   */
  const url = new URL(urlDeConsulta({ skip: 0, limit: 100, contar: true }));

  assert.equal(url.searchParams.get('count'), '1');
  assert.equal(url.searchParams.get('limit'), '100');
  assert.equal(url.searchParams.get('skip'), '0');
});

test('sin pedirla, la cuenta no se pide', () => {
  assert.equal(new URL(urlDeConsulta({ skip: 0 })).searchParams.get('count'), null);
});

// --- El CDN: el puente de imágenes no puede ser un proxy abierto ---

test('sólo se aceptan imágenes del CDN del catálogo viejo', () => {
  /**
   * La pestaña le pasa al Worker la URL de cada foto. Sin esta guarda el endpoint sería
   * un proxy abierto: cualquiera que pase por Access podría hacerle pedir cualquier host
   * desde dentro de la red de Cloudflare. Misma regla que `esDelOrigen` con el proveedor
   * y que `esDelOrigenViejo` con las fichas.
   */
  assert.equal(esDelCdnViejo(`${CDN_VIEJO}/a_photo.webp`), true);
  assert.equal(esDelCdnViejo('https://cdn.catalog-store.link.malo.com/a.webp'), false);
  assert.equal(esDelCdnViejo('http://cdn.catalog-store.link/a.webp'), false);
  assert.equal(esDelCdnViejo('https://chenson.com.py/a.jpg'), false);
  assert.equal(esDelCdnViejo('no es una url'), false);
  assert.equal(esDelCdnViejo(''), false);
});

// --- El producto: de la respuesta de la API a lo que se guarda ---

test('de un producto salen nombre, precio, descripción y todas sus fotos', () => {
  const p = productoDeParse(CG34337)!;

  assert.equal(p.codigo, 'CG34337');
  // El origen deja espacios al final de 100 de los 177 títulos.
  assert.equal(p.nombre, 'Mochila reforzada con ruedas grande');
  assert.equal(p.precio, 398000);
  assert.deepEqual(p.fotos, [`${CDN_VIEJO}/a_photo.webp`, `${CDN_VIEJO}/b_photo.webp`]);
});

test('LA LISTA DE COLORES SE CONSERVA en la descripción', () => {
  /**
   * ES LA DIFERENCIA CENTRAL CON LA MIGRACIÓN DE LOS 189, y no un olvido.
   *
   * Ahí los colores se podaban porque cada uno entraba como una VARIANTE de verdad, con
   * su SKU y su foto, desde la ficha del proveedor: repetirlos como prosa los contaba dos
   * veces. Acá no hay ficha del proveedor —justamente por eso estos productos no
   * entraron— y la API del catálogo viejo trae `nombres_variantes` vacío en los 366. Las
   * fotos vienen en un array plano a nivel producto, sin nada que ate foto a color.
   *
   * Podar la lista acá sería borrar el ÚNICO lugar donde dice de qué colores hay, y quien
   * compra pide por WhatsApp: sin esa línea no sabe qué pedir.
   */
  const p = productoDeParse(CG34337)!;

  /**
   * El renglón en blanco entre el título y la lista es el `<p><br></p>` que escribió el
   * autor, y se conserva: los saltos son de quien redactó la descripción, y este módulo
   * sólo colapsa DOS o más en blanco seguidos, que son un hueco y no una separación.
   */
  assert.equal(
    p.descripcion,
    'De tela impermeable, manija T de aluminio y ruedas siliconadas y con luces\n' +
      'Medidas: alto 42 x largo 32 x sncho 18 cm\n' +
      'Amplio para libros 📚 y carpetas 📂\n' +
      'Disponibles en color:\n' +
      '\n' +
      'Negro\nCeleste\nLila'
  );
});

test('la lista de colores se sigue podando en el camino de los 189', () => {
  /**
   * La opción por defecto no cambió, y esto lo fija: la migración de los productos que el
   * proveedor SÍ publica sigue podando la lista, porque ahí cada color entra como variante
   * de verdad con su foto.
   */
  assert.equal(
    textoDeDescripcion('<p>Con asas largas</p><p>Colores disponibles:</p><ol><li>Lila</li></ol>'),
    'Con asas largas'
  );
});

test('los saltos de línea del autor se conservan', () => {
  // El sitio viejo rinde la descripción con `whitespace-pre-line`, igual que nuestra
  // ficha. Aplanar los saltos es perder información que alguien escribió.
  const p = productoDeParse(SOLO_UNA)!;
  assert.equal(p.descripcion, 'De cuero ecológico\nDisponible en color negro');
});

test('la URL de la ficha vieja se deriva del título canónico', () => {
  /**
   * Es `url_origen`, o sea auditoría: de dónde salió este producto. Verificado el
   * 2026-08-19 contra las 24 fichas que el listado del sitio publica: 24 de 24 exactas.
   * Y ningún `canonical_title` de los 366 pasa los 60 caracteres, así que el recorte de
   * `slugificar` nunca se activa.
   */
  assert.equal(
    productoDeParse(CG34337)!.urlOrigen,
    'https://chensonasuncionybe.catalogst.com/product/mochila-reforzada-con-ruedas-grande-CG34337'
  );
});

test('un producto sin código o sin título no se guarda a medias', () => {
  /**
   * NO SE ADIVINA. El código es la identidad del producto y el nombre es lo que hace
   * aprobable a un importado: sin uno de los dos, entrar es crear trabajo manual que
   * alguien tiene que descubrir después mirando la grilla.
   */
  assert.equal(productoDeParse({ ...CG34337, codigo: '' }), null);
  assert.equal(productoDeParse({ ...CG34337, codigo: 'CG 343 37' }), null);
  assert.equal(productoDeParse({ ...CG34337, titulo: '   ' }), null);
  assert.equal(productoDeParse({ ...CG34337, titulo: undefined }), null);
  assert.equal(productoDeParse(null), null);
  assert.equal(productoDeParse('no es un producto'), null);
});

test('un producto sin fotos no se guarda', () => {
  /**
   * Estos 177 productos NO tienen otra fuente de fotos: el proveedor ya no los publica,
   * que es la razón por la que no entraron en la primera migración. Un producto sin foto
   * es trabajo manual sin insumo. Medido: los 177 tienen entre 1 y 9 fotos, así que este
   * caso no debería aparecer nunca — y si aparece, es un cambio de forma del origen.
   */
  assert.equal(productoDeParse({ ...CG34337, image: [] }), null);
  assert.equal(productoDeParse({ ...CG34337, image: undefined }), null);
});

test('una foto fuera del CDN del catálogo viejo se descarta', () => {
  // El puente de imágenes la rechazaría igual. Descartarla acá hace que el problema se
  // vea como lo que es —una foto que no se pudo traer— y no como un error de red.
  const p = productoDeParse({
    ...CG34337,
    image: [
      { url: 'https://otro-host.com/a.webp' },
      { url: `${CDN_VIEJO}/b_photo.webp` },
      { url: '' },
      {},
    ],
  })!;
  assert.deepEqual(p.fotos, [`${CDN_VIEJO}/b_photo.webp`]);
});

test('el `imageThumb` NO entra como foto', () => {
  // Es la miniatura que el sitio viejo generó para su propio listado: pesa poco y viene
  // recortada. Nuestras derivadas salen del original, que es lo que trae `image`.
  const p = productoDeParse(CG34337)!;
  assert.equal(p.fotos.includes(`${CDN_VIEJO}/z_image.jpg`), false);
});

test('un precio que no es un entero positivo queda en null', () => {
  // `null` es «Consultar precio», que es un estado válido del modelo. Perder el nombre,
  // la descripción y las fotos por un precio raro sería peor. Medido: los 177 traen
  // precio entero, así que esto es una red y no un caso esperado.
  for (const precio of [0, -1, 1500.5, '38000', null, undefined, 'gratis']) {
    assert.equal(productoDeParse({ ...CG34337, precio })!.precio, null, String(precio));
  }
});

test('una descripción que queda vacía es null y no cadena vacía', () => {
  // Una cadena vacía le dibuja a la ficha pública un párrafo en blanco, porque el render
  // pregunta por la descripción y no por su largo.
  assert.equal(productoDeParse({ ...CG34337, body: '<p> </p><p><br></p>' })!.descripcion, null);
  assert.equal(productoDeParse({ ...CG34337, body: undefined })!.descripcion, null);
});

// --- La respuesta completa: lo que devuelve una página de la API ---

test('de la respuesta salen los productos y la cuenta', () => {
  const leido = productosDeRespuesta({ results: [CG34337, SOLO_UNA], count: 366 })!;

  assert.equal(leido.total, 366);
  assert.deepEqual(
    leido.productos.map((p) => p.codigo),
    ['CG34337', '2510407']
  );
});

test('los productos que no se pueden leer se descartan sin tumbar la página', () => {
  /**
   * Fallo TOLERANTE, la misma regla que el scrape del proveedor (§7.4): que una tanda de
   * 100 productos se pierda entera por una fila rara es peor que traer 99 y contar la que
   * faltó. Quien llama compara la cuenta con lo que recibió.
   */
  const leido = productosDeRespuesta({
    results: [CG34337, { codigo: '' }, null, SOLO_UNA],
    count: 366,
  })!;

  assert.equal(leido.productos.length, 2);
  assert.equal(leido.descartados, 2);
});

test('una respuesta sin `results` no es una tienda vacía', () => {
  // Es un cambio de forma del origen. Devolver una lista vacía haría que la pantalla
  // dijera «no falta nada por migrar», que es la conclusión opuesta a la verdadera.
  assert.equal(productosDeRespuesta({ error: 'unauthorized' }), null);
  assert.equal(productosDeRespuesta(null), null);
  assert.equal(productosDeRespuesta({ results: 'no es una lista' }), null);
});

// --- La ficha por objectId: la llave que no depende de la grafía del código ---

test('la ficha de un producto se pide por su objectId', () => {
  /**
   * POR QUÉ NO SE BUSCA MÁS POR CÓDIGO, y costó 3 productos de los 177.
   *
   * El inventario devolvía el código ya NORMALIZADO —`normalizarCodigo` lo pasa a
   * mayúsculas— y el alta lo usaba de llave en un `where` contra Parse, que compara con
   * distinción de mayúsculas. Tres productos tienen el código guardado en minúsculas
   * (`Fla`, `Bl`, `Gat`), así que la consulta devolvía cero filas y el endpoint reportaba
   * «El catálogo viejo ya no tiene este producto» sobre productos que estaban ahí.
   *
   * El `objectId` es la llave real: inmutable, exacta, y de paso inmune a que alguien edite
   * el código entre que la pestaña arma la lista y llega el pedido.
   */
  assert.equal(
    urlDeFicha('aBcDeFgHiJ'),
    'https://ecured.ecunegocio.com/parse/classes/Post/aBcDeFgHiJ'
  );
});

test('el objectId viaja en el producto leído', () => {
  assert.equal(productoDeParse(CG34337)!.objectId, 'aBcDeFgHiJ');
});

test('un producto sin objectId no se puede pedir después, así que no se lee', () => {
  assert.equal(productoDeParse({ ...CG34337, objectId: '' }), null);
  assert.equal(productoDeParse({ ...CG34337, objectId: undefined }), null);
});

test('UN PRODUCTO DE OTRA TIENDA NO SE LEE, aunque el objectId exista', () => {
  /**
   * ES LA GUARDA QUE REEMPLAZA A LA DEL `where`. Buscando por código, el filtro por `place`
   * viajaba en la misma consulta y era imposible traer un producto ajeno. Pidiendo por
   * `objectId` la pestaña manda un identificador suelto: sin esta verificación, cualquiera
   * que pase por Access podría hacer que el catálogo se llene con productos de otra tienda
   * del mismo Parse.
   */
  const ajeno = {
    ...CG34337,
    place: { __type: 'Pointer', className: 'Place', objectId: 'OtraTienda' },
  };
  assert.equal(productoDeParse(ajeno), null);

  // Y sin `place` tampoco: no se asume que sea nuestro.
  assert.equal(productoDeParse({ ...CG34337, place: undefined }), null);
  assert.equal(productoDeParse({ ...CG34337, place: 'KygQqU2BGC' }), null);
});

test('el producto de la tienda propia sí se lee', () => {
  assert.equal(productoDeParse(CG34337)?.codigo, 'CG34337');
});
