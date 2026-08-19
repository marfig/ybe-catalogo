import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { Ejecutar } from '../grilla.ts';
import { COLOR_UNICO, PROVEEDOR_VIEJO, crearDesdeViejo } from './crear.ts';
import type { ProductoDelViejo } from './parse.ts';

/**
 * Contra el ESQUEMA REAL con `node:sqlite`, que es el mismo motor que D1.
 *
 * ESTA FUNCIÓN CREA PRODUCTOS CON NOMBRE Y PRECIO YA PUESTOS, que es algo que ninguna
 * otra pieza del scrape hace: `registrarFicha` se niega a escribir curaduría y eso es su
 * razón de existir. Acá se escribe, así que la guarda es el archivo entero.
 */
const MIGRACIONES = [
  '0001_esquema_inicial.sql',
  '0002_codigo_insensible_a_mayusculas.sql',
  '0003_aviso_cambio_en_origen.sql',
  '0004_papelera.sql',
  '0005_barrido_de_bajas.sql',
].map((n) => readFileSync(new URL(`../../../../db/migrations/${n}`, import.meta.url), 'utf8'));

const AHORA = '2026-08-19T12:00:00Z';

function base() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const m of MIGRACIONES) db.exec(m);
  return db;
}

const ejecutor =
  (db: DatabaseSync): Ejecutar =>
  async (sql, params = []) =>
    db.prepare(sql).all(...(params as never[])) as never;

/** Uno de los 177 reales: `8732209`, con dos fotos y su lista de colores. */
const PRODUCTO: ProductoDelViejo = {
  codigo: '8732209',
  nombre: 'Mochila porta notebook impermeable',
  precio: 165000,
  descripcion: 'Medidas: alto 48 x largo 31 x ancho 20 cm\nColores disponibles:\nNegro\nGris/negro',
  fotos: [
    'https://cdn.catalog-store.link/6e0753a92ae01f6c84cec0180bdf3f93_photo.webp',
    'https://cdn.catalog-store.link/ac3d7002f122338cdda7ef62259012d4_photo.webp',
  ],
  urlOrigen:
    'https://chensonasuncionybe.catalogst.com/product/mochila-porta-notebook-impermeable-8732209',
};

const leerProducto = (db: DatabaseSync, id: number) =>
  db
    .prepare(
      `SELECT codigo, proveedor, estado, slug, nombre, precio, descripcion, url_origen,
              categoria_origen, scrape_id, destacado, creado_en, actualizado_en
         FROM productos WHERE id = ?`
    )
    .get(id) as Record<string, unknown>;

const leerVariantes = (db: DatabaseSync, id: number) =>
  db
    .prepare(`SELECT sku, color, color_origen, color_hex, activo, orden FROM variantes WHERE producto_id = ? ORDER BY orden`)
    .all(id) as Array<Record<string, unknown>>;

/** Un scrape al que colgar la corrida: `productos.scrape_id` tiene FK. */
function corrida(db: DatabaseSync): number {
  const fila = db
    .prepare(
      `INSERT INTO scrapes (url, estado, iniciado_en) VALUES ('migracion de los faltantes', 'corriendo', ?) RETURNING id`
    )
    .get(AHORA) as { id: number };
  return fila.id;
}

test('crea el producto con su nombre, precio, descripción y una variante', async () => {
  const db = base();
  const scrapeId = corrida(db);

  const r = await crearDesdeViejo(ejecutor(db), PRODUCTO, { scrapeId, ahora: AHORA });

  assert.equal(r.creado, true);
  assert.equal(r.sku, '8732209');

  const p = leerProducto(db, r.productoId);
  assert.equal(p.codigo, '8732209');
  assert.equal(p.nombre, PRODUCTO.nombre);
  assert.equal(p.precio, 165000);
  assert.equal(p.descripcion, PRODUCTO.descripcion);
  assert.equal(p.url_origen, PRODUCTO.urlOrigen);
  assert.equal(p.scrape_id, scrapeId);

  /**
   * `importado` y `slug` en NULL: entra como «Por aprobar», igual que cualquier
   * importación. Aprobar crea la dirección web definitiva y eso lo decide una persona
   * (§5.2). Que la migración traiga el nombre y el precio ya puestos no la autoriza a
   * publicar nada.
   */
  assert.equal(p.estado, 'importado');
  assert.equal(p.slug, null);
  assert.equal(p.destacado, 0);
  // La categoría no se migra: la taxonomía vieja no mapea a la nueva y eso es curaduría.
  assert.equal(p.categoria_origen, null);
});

test('el proveedor es `catalogo-viejo`, y de eso depende el barrido', async () => {
  /**
   * LA DECISIÓN MÁS IMPORTANTE DEL ARCHIVO, y no es cosmética.
   *
   * Estos 177 productos son exactamente los que el proveedor YA NO PUBLICA. El barrido
   * diario le pregunta al buscador del proveedor por cada producto barrible: si entraran
   * como `chenson`, los 177 volverían `ausente` todos los días y quedarían marcados de
   * baja para siempre. 177 falsas alarmas permanentes enseñan a ignorar el lugar donde
   * después aparece el aviso de verdad.
   *
   * `manual` tampoco sirve, aunque el barrido ya lo excluya: mentiría sobre de dónde salió
   * el producto, y `url_origen` lo desmiente en la fila de al lado. La lista de `cola.ts`
   * es blanca —barre sólo `chenson`— justamente para que un origen nuevo no entre por
   * olvido.
   */
  const db = base();
  const r = await crearDesdeViejo(ejecutor(db), PRODUCTO, { scrapeId: null, ahora: AHORA });

  assert.equal(leerProducto(db, r.productoId).proveedor, PROVEEDOR_VIEJO);
  assert.equal(PROVEEDOR_VIEJO, 'catalogo-viejo');
});

test('UNA sola variante, porque no hay con qué armar más', async () => {
  /**
   * El catálogo viejo lista los colores como PROSA y sus fotos vienen en un array plano a
   * nivel producto: no hay nada que ate una foto a un color. Medido el 2026-08-19 sobre
   * los 366: `nombres_variantes` viene vacío en todos.
   *
   * Armar una variante por color y colgarle todas las fotos a la primera daría un selector
   * de color que no cambia la foto — una promesa que la ficha no cumple. Con una sola
   * variante, `SelectorVariante.tsx` esconde el selector (`variantes.length > 1`) y no
   * menciona el color en el mensaje de WhatsApp: la ficha queda limpia, y los colores se
   * leen en la descripción, que es donde el origen los escribió.
   */
  const db = base();
  const r = await crearDesdeViejo(ejecutor(db), PRODUCTO, { scrapeId: null, ahora: AHORA });

  const variantes = leerVariantes(db, r.productoId);
  assert.equal(variantes.length, 1);
  assert.equal(variantes[0].sku, '8732209');
  assert.equal(variantes[0].color, COLOR_UNICO);
  assert.equal(variantes[0].orden, 0);
  assert.equal(variantes[0].activo, 1);
  // `color_origen` y `color_hex` quedan en NULL: el origen no dio un color para ESTA
  // variante, y un color que nadie midió no se inventa (SPEC §6.6).
  assert.equal(variantes[0].color_origen, null);
  assert.equal(variantes[0].color_hex, null);
});

test('el SKU es el código pelado, y no choca con los del proveedor', async () => {
  /**
   * Los SKU del proveedor son `{codigo}-{codigoColor}` (`CG85527-E`), así que un código
   * pelado no puede chocar con ninguno. Y el SKU no se vuelve a derivar nunca: ya viaja en
   * pedidos por WhatsApp.
   */
  const db = base();
  const r = await crearDesdeViejo(ejecutor(db), PRODUCTO, { scrapeId: null, ahora: AHORA });
  assert.equal(leerVariantes(db, r.productoId)[0].sku, PRODUCTO.codigo);
});

test('correrlo dos veces no duplica ni pisa nada', async () => {
  /**
   * Es lo que hace la corrida REANUDABLE: se corta en el producto 120, se aprieta de nuevo
   * y los 119 que ya entraron se saltean solos. Sin esto, la única forma de terminar una
   * migración interrumpida sería acordarse de por dónde iba.
   */
  const db = base();
  const primera = await crearDesdeViejo(ejecutor(db), PRODUCTO, { scrapeId: null, ahora: AHORA });

  const segunda = await crearDesdeViejo(
    ejecutor(db),
    { ...PRODUCTO, nombre: 'Otro nombre', precio: 1 },
    { scrapeId: null, ahora: '2026-08-20T12:00:00Z' }
  );

  assert.equal(segunda.creado, false);
  assert.equal(segunda.productoId, primera.productoId);
  // `sku` en null: no hay variante nueva a la que colgarle fotos, así que quien llama no
  // vuelve a bajar las 248 imágenes.
  assert.equal(segunda.sku, null);

  const p = leerProducto(db, primera.productoId);
  assert.equal(p.nombre, PRODUCTO.nombre);
  assert.equal(p.precio, 165000);
  assert.equal(p.actualizado_en, AHORA);
  assert.equal(leerVariantes(db, primera.productoId).length, 1);
  assert.equal(
    (db.prepare('SELECT count(*) AS n FROM productos').get() as { n: number }).n,
    1
  );
});

test('un producto que ya está en el catálogo NO se toca, en ningún estado', async () => {
  /**
   * Incluye `eliminado` a propósito, igual que `codigosExistentes`: un producto en la
   * papelera sigue existiendo —su código está tomado y su URL vive—. Volver a crearlo
   * resucitaría algo que alguien sacó del catálogo a propósito.
   */
  for (const estado of ['importado', 'aprobado', 'publicado', 'eliminado']) {
    const db = base();
    const existente = db
      .prepare(
        `INSERT INTO productos (codigo, proveedor, estado, slug, nombre, precio, creado_en, actualizado_en)
         VALUES ('8732209', 'chenson', ?, 'algun-slug', 'Lo que escribí yo', 999, ?, ?) RETURNING id`
      )
      .get(estado, AHORA, AHORA) as { id: number };

    const r = await crearDesdeViejo(ejecutor(db), PRODUCTO, { scrapeId: null, ahora: AHORA });

    assert.equal(r.creado, false, estado);
    assert.equal(r.productoId, existente.id, estado);

    const p = leerProducto(db, existente.id);
    assert.equal(p.nombre, 'Lo que escribí yo', estado);
    assert.equal(p.precio, 999, estado);
    assert.equal(p.proveedor, 'chenson', estado);
    assert.equal(leerVariantes(db, existente.id).length, 0, estado);
  }
});

test('el código se compara sin distinguir mayúsculas', async () => {
  /**
   * La collation por defecto de SQLite es BINARY, así que un `WHERE codigo = ?` pelado
   * trataría `cyb2609` y `CYB2609` como códigos distintos: entrarían los dos, con dos
   * slugs y dos URLs para la misma cosa. Es la misma regla del índice de la migración 0002.
   */
  const db = base();
  db.prepare(
    `INSERT INTO productos (codigo, proveedor, estado, creado_en, actualizado_en)
     VALUES ('cyb2609', 'chenson', 'importado', ?, ?)`
  ).run(AHORA, AHORA);

  const r = await crearDesdeViejo(
    ejecutor(db),
    { ...PRODUCTO, codigo: 'CYB2609' },
    { scrapeId: null, ahora: AHORA }
  );

  assert.equal(r.creado, false);
  assert.equal((db.prepare('SELECT count(*) AS n FROM productos').get() as { n: number }).n, 1);
});

test('sin precio el producto entra igual, como «Consultar»', async () => {
  // Un precio en null es un estado válido del modelo. Perder el nombre, la descripción y
  // las fotos por un precio que el origen no dio sería peor.
  const db = base();
  const r = await crearDesdeViejo(
    ejecutor(db),
    { ...PRODUCTO, precio: null },
    { scrapeId: null, ahora: AHORA }
  );

  assert.equal(r.creado, true);
  assert.equal(leerProducto(db, r.productoId).precio, null);
});

test('sin descripción entra NULL y no cadena vacía', async () => {
  // Una cadena vacía le dibuja a la ficha pública un párrafo en blanco, porque el render
  // pregunta por la descripción y no por su largo.
  const db = base();
  const r = await crearDesdeViejo(
    ejecutor(db),
    { ...PRODUCTO, descripcion: null },
    { scrapeId: null, ahora: AHORA }
  );

  assert.equal(leerProducto(db, r.productoId).descripcion, null);
});

test('un nombre vacío no crea un producto sin nombre', async () => {
  /**
   * Un importado sin nombre no se puede aprobar, así que entraría sólo para que alguien lo
   * descubra después mirando la grilla. Lanza en vez de devolver `false`: quien llama ya
   * validó el nombre en `productoDeParse`, así que llegar acá sin nombre es un error de
   * programación y no un caso del origen.
   */
  const db = base();
  await assert.rejects(
    () => crearDesdeViejo(ejecutor(db), { ...PRODUCTO, nombre: '  ' }, { scrapeId: null, ahora: AHORA }),
    /nombre/i
  );
  assert.equal((db.prepare('SELECT count(*) AS n FROM productos').get() as { n: number }).n, 0);
});

test('un SKU ya tomado por otro producto da un mensaje en castellano', async () => {
  /**
   * El `UNIQUE` de `variantes.sku` produce un error crudo de SQLite, y §10 pide que ningún
   * mensaje del admin lo sea. No debería pasar —los SKU del proveedor llevan sufijo de
   * color— pero un producto cargado a mano puede tener cualquier SKU.
   *
   * SE PREGUNTA ANTES DE INSERTAR NADA, y no se atrapa el error después: `ejecutorD1` no
   * da transacciones, así que insertar el producto y fallar en la variante dejaría un
   * producto sin variante, o sea sin ningún lugar donde colgar sus fotos. Un producto
   * inservible es peor que un producto que no entró.
   */
  const db = base();
  const otro = db
    .prepare(
      `INSERT INTO productos (codigo, proveedor, estado, creado_en, actualizado_en)
       VALUES ('OTRO', 'manual', 'importado', ?, ?) RETURNING id`
    )
    .get(AHORA, AHORA) as { id: number };
  db.prepare(`INSERT INTO variantes (producto_id, sku, color, orden) VALUES (?, '8732209', 'Negro', 0)`).run(
    otro.id
  );

  await assert.rejects(
    () => crearDesdeViejo(ejecutor(db), PRODUCTO, { scrapeId: null, ahora: AHORA }),
    /8732209/
  );

  // No quedó un producto a medias: el de arriba es el único, y sigue siendo el manual.
  assert.equal((db.prepare('SELECT count(*) AS n FROM productos').get() as { n: number }).n, 1);
});
