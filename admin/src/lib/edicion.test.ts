import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

import { actualizarProducto, cargarProducto } from './edicion.ts';
import type { Ejecutar } from './grilla.ts';

/**
 * Tests de la edición de un producto (SPEC-etapa2 §10.4).
 *
 * Es la pantalla que trae TODO lo cargado para no retipearlo. Lo que más se prueba es
 * lo que NO puede cambiar: el slug, que es la URL en la calle (§5.2), y el estado,
 * que sólo se mueve por las transiciones de la máquina de estados.
 */

/** La carpeta entera, en orden, que es lo que corre wrangler. Una lista a mano se
 *  queda vieja en silencio: esta llegaba hasta la 0002. */
const CARPETA = new URL('../../../db/migrations/', import.meta.url);
const MIGRACIONES = readdirSync(CARPETA)
  .filter((n) => n.endsWith('.sql'))
  .sort()
  .map((n) => readFileSync(new URL(n, CARPETA), 'utf8'));
const ANTES = '2026-08-01T10:00:00Z';
const AHORA = '2026-08-06T18:00:00Z';
const CATEGORIAS = new Set(['carteras', 'mochilas', 'fiesta', 'dama']);
const HASH_A = 'aaaaaaaaaaaaaaaa';
const HASH_B = 'bbbbbbbbbbbbbbbb';

function base() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const m of MIGRACIONES) db.exec(m);
  for (const h of [HASH_A, HASH_B]) {
    db.prepare(
      `INSERT INTO imagenes (hash16, anchos, ancho_origen, alto_origen, bytes_origen, creado_en)
       VALUES (?, '[300,600]', 600, 600, 1000, ?)`
    ).run(h, ANTES);
  }
  return db;
}

const ejecutor =
  (db: DatabaseSync): Ejecutar =>
  async (sql, params = []) =>
    db.prepare(sql).all(...(params as never[])) as never;

function alta(db: DatabaseSync, extra: Record<string, unknown> = {}) {
  const estado = (extra.estado as string) ?? 'publicado';
  const fila = db
    .prepare(
      `INSERT INTO productos
         (codigo, proveedor, slug, nombre, descripcion, precio, destacado, estado, creado_en, actualizado_en)
       VALUES ('CG85527', 'chenson', ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
    )
    .get(
      extra.slug !== undefined ? (extra.slug as string | null) : 'cartera-de-fiesta',
      (extra.nombre as string) ?? 'Cartera de fiesta',
      (extra.descripcion as string) ?? 'Una cartera',
      extra.precio !== undefined ? (extra.precio as number | null) : 195000,
      extra.destacado ? 1 : 0,
      estado,
      ANTES,
      ANTES
    ) as { id: number };

  for (const [orden, c] of ((extra.categorias as string[]) ?? ['carteras', 'fiesta']).entries()) {
    db.prepare(
      `INSERT INTO producto_categorias (producto_id, categoria_slug, orden) VALUES (?, ?, ?)`
    ).run(fila.id, c, orden);
  }

  const v = db
    .prepare(
      `INSERT INTO variantes (producto_id, sku, color, color_hex, orden)
       VALUES (?, 'CG85527-negro', 'Negro', '#1a1a1a', 0) RETURNING id`
    )
    .get(fila.id) as { id: number };
  db.prepare(
    `INSERT INTO variante_imagenes (variante_id, imagen_id, orden)
     SELECT ?, id, 0 FROM imagenes WHERE hash16 = ?`
  ).run(v.id, HASH_A);

  return { id: fila.id, varianteId: v.id };
}

const leer = (db: DatabaseSync) =>
  db.prepare(`SELECT * FROM productos WHERE codigo = 'CG85527'`).get() as Record<string, unknown>;

const opciones = { categoriasValidas: CATEGORIAS, ahora: AHORA };

// --------------------------------------------------------------------------
// cargarProducto — traer TODO para no retipear
// --------------------------------------------------------------------------

test('carga el producto con sus categorias, variantes y fotos', async () => {
  const db = base();
  alta(db);

  const p = (await cargarProducto(ejecutor(db), 'CG85527'))!;
  assert.equal(p.codigo, 'CG85527');
  assert.equal(p.nombre, 'Cartera de fiesta');
  assert.equal(p.descripcion, 'Una cartera');
  assert.equal(p.precio, 195000);
  assert.deepEqual(p.categorias, ['carteras', 'fiesta']);
  assert.equal(p.variantes.length, 1);
  assert.equal(p.variantes[0].color, 'Negro');
  assert.equal(p.variantes[0].colorHex, '#1a1a1a');
  assert.deepEqual(p.variantes[0].hashes, [HASH_A]);
});

test('lo encuentra con el codigo en minuscula', async () => {
  const db = base();
  alta(db);
  assert.ok(await cargarProducto(ejecutor(db), 'cg85527'));
});

test('devuelve null si no existe', async () => {
  assert.equal(await cargarProducto(ejecutor(base()), 'CG00000'), null);
});

test('las categorias vienen en su orden: la primera es el breadcrumb', async () => {
  const db = base();
  alta(db, { categorias: ['mochilas', 'dama', 'carteras'] });
  const p = (await cargarProducto(ejecutor(db), 'CG85527'))!;
  assert.deepEqual(p.categorias, ['mochilas', 'dama', 'carteras']);
});

// --------------------------------------------------------------------------
// Lo que NO puede cambiar
// --------------------------------------------------------------------------

test('el SLUG no cambia aunque cambie el nombre', async () => {
  // El invariante mas caro: la URL vive en conversaciones de WhatsApp (§5.2).
  const db = base();
  const { id, varianteId: v } = alta(db);

  await actualizarProducto(
    ejecutor(db),
    id,
    {
      nombre: 'Cartera renombrada por completo',
      descripcion: null,
      precio: 195000,
      categorias: ['carteras'],
      variantes: [{ id: v, color: 'Negro', hashes: [HASH_A] }],
    },
    opciones
  );

  const p = leer(db);
  assert.equal(p.nombre, 'Cartera renombrada por completo');
  assert.equal(p.slug, 'cartera-de-fiesta');
});

test('el ESTADO no cambia: solo se mueve por las transiciones', async () => {
  // Editar no aprueba ni publica. Si esta pantalla pudiera cambiar el estado, habria
  // dos caminos para lo mismo y uno se olvidaria de generar el slug.
  const db = base();
  const { id, varianteId: v } = alta(db, { estado: 'publicado' });

  await actualizarProducto(
    ejecutor(db),
    id,
    {
      nombre: 'Otro',
      descripcion: null,
      precio: null,
      categorias: ['carteras'],
      variantes: [{ id: v, color: 'Negro', hashes: [] }],
    },
    opciones
  );

  assert.equal(leer(db).estado, 'publicado');
});

test('el CODIGO no cambia: es la identidad', async () => {
  const db = base();
  const { id, varianteId: v } = alta(db);
  await actualizarProducto(
    ejecutor(db),
    id,
    {
      nombre: 'Otro',
      descripcion: null,
      precio: null,
      categorias: ['carteras'],
      variantes: [{ id: v, color: 'Negro', hashes: [] }],
    },
    opciones
  );
  assert.equal(leer(db).codigo, 'CG85527');
});

test('vaciar el nombre de un PUBLICADO se rechaza', async () => {
  // El volcado lanza ante un publicable sin nombre: dejarlo pasar haria fallar la
  // publicacion entera.
  const db = base();
  const { id, varianteId: v } = alta(db, { estado: 'publicado' });
  await assert.rejects(
    () =>
      actualizarProducto(
        ejecutor(db),
        id,
        {
          nombre: '  ',
          descripcion: null,
          precio: null,
          categorias: ['carteras'],
          variantes: [{ id: v, color: 'Negro', hashes: [] }],
        },
        opciones
      ),
    /nombre/i
  );
  assert.equal(leer(db).nombre, 'Cartera de fiesta');
});

test('vaciar el nombre de un IMPORTADO se permite', async () => {
  const db = base();
  const { id, varianteId: v } = alta(db, { estado: 'importado', slug: null });
  await actualizarProducto(
    ejecutor(db),
    id,
    {
      nombre: '',
      descripcion: null,
      precio: null,
      categorias: ['carteras'],
      variantes: [{ id: v, color: 'Negro', hashes: [] }],
    },
    opciones
  );
  assert.equal(leer(db).nombre, null);
});

// --------------------------------------------------------------------------
// Lo que sí cambia
// --------------------------------------------------------------------------

test('actualiza descripcion, precio y categorias', async () => {
  const db = base();
  const { id, varianteId: v } = alta(db);

  await actualizarProducto(
    ejecutor(db),
    id,
    {
      nombre: 'Cartera de fiesta',
      descripcion: 'Descripción nueva',
      precio: 250000,
      categorias: ['mochilas', 'dama'],
      variantes: [{ id: v, color: 'Negro', hashes: [HASH_A] }],
    },
    opciones
  );

  const p = leer(db);
  assert.equal(p.descripcion, 'Descripción nueva');
  assert.equal(p.precio, 250000);
  assert.equal(p.actualizado_en, AHORA);

  const cats = db
    .prepare(`SELECT categoria_slug FROM producto_categorias WHERE producto_id = ? ORDER BY orden`)
    .all(id)
    .map((f) => (f as { categoria_slug: string }).categoria_slug);
  assert.deepEqual(cats, ['mochilas', 'dama']);
});

test('agregar una variante nueva no toca el SKU de las que estaban', async () => {
  // SPEC.md §6.6: agregar un color no puede mover los SKU existentes, porque el sku
  // ya viajo en pedidos y mensajes.
  const db = base();
  const { id, varianteId: v } = alta(db);

  await actualizarProducto(
    ejecutor(db),
    id,
    {
      nombre: 'Cartera de fiesta',
      descripcion: null,
      precio: null,
      categorias: ['carteras'],
      variantes: [
        // La que ya existe viaja con su id; la nueva no.
        { id: v, color: 'Negro', hashes: [HASH_A] },
        { color: 'Rojo', hashes: [HASH_B] },
      ],
    },
    opciones
  );

  const vs = db
    .prepare(`SELECT sku, color FROM variantes WHERE producto_id = ? ORDER BY orden`)
    .all(id) as Array<{ sku: string; color: string }>;
  assert.deepEqual(
    vs.map((v) => v.sku),
    ['CG85527-negro', 'CG85527-rojo']
  );
});

test('agrega fotos a una variante existente sin perder las que tenia', async () => {
  const db = base();
  const { id, varianteId } = alta(db);
  const v = varianteId;

  await actualizarProducto(
    ejecutor(db),
    id,
    {
      nombre: 'Cartera de fiesta',
      descripcion: null,
      precio: null,
      categorias: ['carteras'],
      variantes: [{ id: v, color: 'Negro', hashes: [HASH_A, HASH_B] }],
    },
    opciones
  );

  const hashes = db
    .prepare(
      `SELECT i.hash16 FROM variante_imagenes vi JOIN imagenes i ON i.id = vi.imagen_id
        WHERE vi.variante_id = ? ORDER BY vi.orden`
    )
    .all(varianteId)
    .map((f) => (f as { hash16: string }).hash16);
  assert.deepEqual(hashes, [HASH_A, HASH_B]);
});

test('QUITAR una variante que ya existe se RECHAZA', async () => {
  // Su SKU ya viajo en pedidos y sus fotos quedarian huerfanas. Sacar de circulacion
  // es una accion destructiva con sus propias reglas (§12) y no puede pasar por
  // descuido al guardar un formulario.
  const db = base();
  const { id, varianteId: v } = alta(db);

  await assert.rejects(
    () =>
      actualizarProducto(
        ejecutor(db),
        id,
        {
          nombre: 'Cartera de fiesta',
          descripcion: null,
          precio: null,
          categorias: ['carteras'],
          variantes: [{ color: 'Rojo', hashes: [] }],
        },
        opciones
      ),
    /Negro|quitar|falta/i
  );

  const cuantas = db.prepare(`SELECT COUNT(*) n FROM variantes WHERE producto_id = ?`).get(id) as {
    n: number;
  };
  assert.equal(cuantas.n, 1, 'no se toco nada');
});

test('RECHAZA una categoria inexistente sin escribir nada', async () => {
  const db = base();
  const { id, varianteId: v } = alta(db);
  await assert.rejects(
    () =>
      actualizarProducto(
        ejecutor(db),
        id,
        {
          nombre: 'Otro nombre',
          descripcion: null,
          precio: null,
          categorias: ['inventada'],
          variantes: [{ id: v, color: 'Negro', hashes: [] }],
        },
        opciones
      ),
    /inventada/
  );
  assert.equal(leer(db).nombre, 'Cartera de fiesta', 'no se escribio nada');
});

test('un producto que no existe se reporta', async () => {
  await assert.rejects(
    () =>
      actualizarProducto(
        ejecutor(base()),
        99999,
        {
          nombre: 'x',
          descripcion: null,
          precio: null,
          categorias: ['carteras'],
          variantes: [{ color: 'Negro', hashes: [] }],
        },
        opciones
      ),
    /no existe/i
  );
});

// --------------------------------------------------------------------------
// Regresion: emparejar por SKU rompia la edicion de TODO producto del proveedor
// --------------------------------------------------------------------------

test('REGRESION: un sku del proveedor que no deriva del color se edita igual', async () => {
  // El sku de un producto scrapeado es {codigo}-{codigoColor} con el prefijo (X) del
  // origen: CG85527-E. `slug(color)` daria CG85527-champagne, que no coincide con
  // nada. Emparejando por sku, la edicion creia que la variante se habia borrado y
  // fallaba para TODOS los productos del proveedor. Se empareja por id.
  const db = base();
  const { id } = alta(db);
  db.prepare(`UPDATE variantes SET sku = 'CG85527-E', color = 'Champagne'`).run();
  const v = (db.prepare(`SELECT id FROM variantes`).get() as { id: number }).id;

  await actualizarProducto(
    ejecutor(db),
    id,
    {
      nombre: 'Cartera de fiesta',
      descripcion: null,
      precio: 195000,
      categorias: ['carteras'],
      variantes: [{ id: v, color: 'Champagne', hashes: [HASH_A] }],
    },
    opciones
  );

  const fila = db.prepare(`SELECT sku, color_hex FROM variantes WHERE id = ?`).get(v) as {
    sku: string;
    color_hex: string;
  };
  assert.equal(fila.sku, 'CG85527-E', 'el sku no se recalcula: ya circulo');
  /**
   * Y el `color_hex` cargado SOBREVIVE a la edicion.
   *
   * El admin ya no tiene con que escribirlo —el `<input type="color">` se saco porque no
   * tiene estado vacio y estampaba un color que nadie eligio (SPEC.md §6.6)— asi que
   * este assert es lo que impide que el UPDATE lo ponga en NULL en silencio.
   */
  assert.equal(fila.color_hex, '#1a1a1a', 'editar no borra el color cargado');
});

test('un id de variante ajeno se RECHAZA', async () => {
  // Un formulario manipulado no puede mover una variante de otro producto.
  const db = base();
  const { id } = alta(db);
  await assert.rejects(
    () =>
      actualizarProducto(
        ejecutor(db),
        id,
        {
          nombre: 'X',
          descripcion: null,
          precio: null,
          categorias: ['carteras'],
          variantes: [{ id: 99999, color: 'Negro', hashes: [] }],
        },
        opciones
      ),
    /no pertenecen/i
  );
});

// --------------------------------------------------------------------------
// El ORDEN de los colores, que es lo que decide qué se ve del producto.
// --------------------------------------------------------------------------

test('reordenar los colores reescribe `orden` y no toca nada mas', async () => {
  /**
   * ES LA PIEZA QUE SOSTIENE EL REORDENAMIENTO DESDE LA PANTALLA. Los botones de
   * `alta-cliente.ts` mueven el `<div>` del color y nada mas: el formulario manda los
   * colores en el orden del DOM y esta funcion deriva `variantes.orden` de la posicion de
   * cada uno en lo que llega. Si esta propiedad se rompe, los botones dejan de hacer algo
   * sin que ningun test se ponga rojo.
   *
   * Y el orden importa de verdad: el volcado ordena por `orden`, y la primera variante es
   * la que el sitio rinde por defecto en la ficha, la que da la miniatura de la tarjeta del
   * listado y la que va al indice del buscador.
   */
  const db = base();
  const { id, varianteId: negro } = alta(db);

  const rojo = (
    db
      .prepare(
        `INSERT INTO variantes (producto_id, sku, color, color_hex, orden)
         VALUES (?, 'CG85527-rojo', 'Rojo', '#c00000', 1) RETURNING id`
      )
      .get(id) as { id: number }
  ).id;
  db.prepare(
    `INSERT INTO variante_imagenes (variante_id, imagen_id, orden)
     SELECT ?, id, 0 FROM imagenes WHERE hash16 = ?`
  ).run(rojo, HASH_B);

  // Al reves: el rojo pasa a ser el principal.
  await actualizarProducto(
    ejecutor(db),
    id,
    {
      nombre: 'Cartera de fiesta',
      descripcion: 'Una cartera',
      precio: 195000,
      categorias: ['carteras'],
      variantes: [
        { id: rojo, color: 'Rojo', hashes: [HASH_B] },
        { id: negro, color: 'Negro', hashes: [HASH_A] },
      ],
    },
    opciones
  );

  const vs = db
    .prepare(
      `SELECT id, sku, color, color_hex, orden FROM variantes WHERE producto_id = ? ORDER BY orden`
    )
    .all(id) as Array<{ id: number; sku: string; color: string; color_hex: string; orden: number }>;

  assert.deepEqual(
    vs.map((v) => v.sku),
    ['CG85527-rojo', 'CG85527-negro']
  );
  assert.deepEqual(
    vs.map((v) => v.orden),
    [0, 1]
  );

  // NI UNA VARIANTE NUEVA: se emparejan por id, asi que mover no duplica. Si se
  // emparejaran por SKU recomputado, estas dos entrarian como colores nuevos y el producto
  // terminaria con cuatro.
  assert.equal(vs.length, 2);
  assert.deepEqual(
    vs.map((v) => v.id),
    [rojo, negro]
  );

  // El `color_hex` sobrevive: es el unico dato de la variante que el admin no puede
  // escribir, y no viaja en el formulario. Reordenar no puede borrarlo.
  assert.deepEqual(
    vs.map((v) => v.color_hex),
    ['#c00000', '#1a1a1a']
  );

  // Y cada color se queda con SU foto: el vinculo se reescribe en bloque, asi que un
  // desalineado aca le pondria al rojo la foto del negro.
  const fotosDe = (varianteId: number) =>
    (
      db
        .prepare(
          `SELECT i.hash16 FROM variante_imagenes vi
             JOIN imagenes i ON i.id = vi.imagen_id
            WHERE vi.variante_id = ? ORDER BY vi.orden`
        )
        .all(varianteId) as Array<{ hash16: string }>
    ).map((f) => f.hash16);

  assert.deepEqual(fotosDe(rojo), [HASH_B]);
  assert.deepEqual(fotosDe(negro), [HASH_A]);
});

test('reordenar dos veces vuelve al orden original', async () => {
  // La propiedad que hace que acomodar colores no pueda dejar el producto peor de como
  // estaba: es reversible desde la misma pantalla.
  const db = base();
  const { id, varianteId: negro } = alta(db);
  const rojo = (
    db
      .prepare(
        `INSERT INTO variantes (producto_id, sku, color, orden)
         VALUES (?, 'CG85527-rojo', 'Rojo', 1) RETURNING id`
      )
      .get(id) as { id: number }
  ).id;

  const guardar = (ids: number[]) =>
    actualizarProducto(
      ejecutor(db),
      id,
      {
        nombre: 'Cartera de fiesta',
        descripcion: null,
        precio: null,
        categorias: ['carteras'],
        variantes: ids.map((v) => ({ id: v, color: v === negro ? 'Negro' : 'Rojo', hashes: [] })),
      },
      opciones
    );

  await guardar([rojo, negro]);
  await guardar([negro, rojo]);

  const vs = db
    .prepare(`SELECT sku FROM variantes WHERE producto_id = ? ORDER BY orden`)
    .all(id) as Array<{ sku: string }>;
  assert.deepEqual(
    vs.map((v) => v.sku),
    ['CG85527-negro', 'CG85527-rojo']
  );
});

// --------------------------------------------------------------------------
// El video
// --------------------------------------------------------------------------

test('cargarProducto trae el video con sus medidas', async () => {
  // La ficha necesita ancho y alto para reservarle el lugar al <video>: sin eso el
  // formulario salta cuando carga la vista previa.
  const db = base();
  const ejecutar = ejecutor(db);
  const { id } = db
    .prepare(
      `INSERT INTO videos (hash16, ancho, alto, bytes, creado_en)
       VALUES ('cccccccccccccccc', 720, 1280, 2000000, ?) RETURNING id`
    )
    .get(ANTES) as { id: number };
  const { id: productoId } = alta(db);
  db.prepare(`UPDATE productos SET video_id = ? WHERE id = ?`).run(id, productoId);

  const cargado = await cargarProducto(ejecutar, 'CG85527');

  assert.deepEqual(cargado?.video, { hash16: 'cccccccccccccccc', ancho: 720, alto: 1280 });
});

test('cargarProducto devuelve video null cuando no tiene', async () => {
  // `null` y no `undefined`: la plantilla distingue «no tiene» de «no se consultó».
  const db = base();
  alta(db);
  const cargado = await cargarProducto(ejecutor(db), 'CG85527');
  assert.equal(cargado?.video, null);
});
