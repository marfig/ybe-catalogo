import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

import { crearProducto } from './alta.ts';
import type { Ejecutar } from './grilla.ts';

/**
 * Tests del alta manual (SPEC-etapa2 §9).
 *
 * Produce exactamente la misma fila que el scrape, en estado `importado` y con
 * `proveedor: 'manual'`. Lo que más se prueba: que el código sea de verdad la
 * identidad (§5.3) y que un alta a medias no deje basura.
 */

const MIGRACIONES = ['0001_esquema_inicial.sql', '0002_codigo_insensible_a_mayusculas.sql'].map(
  (n) => readFileSync(new URL(`../../../db/migrations/${n}`, import.meta.url), 'utf8')
);
const AHORA = '2026-08-06T15:00:00Z';
const CATEGORIAS = new Set(['carteras', 'mochilas', 'fiesta', 'dama']);
const HASH_A = 'aaaaaaaaaaaaaaaa';
const HASH_B = 'bbbbbbbbbbbbbbbb';

function base() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const m of MIGRACIONES) db.exec(m);
  // Dos imagenes ya subidas por el endpoint: el alta solo las vincula.
  for (const h of [HASH_A, HASH_B]) {
    db.prepare(
      `INSERT INTO imagenes (hash16, anchos, ancho_origen, alto_origen, bytes_origen, creado_en)
       VALUES (?, '[300,600]', 600, 600, 1000, ?)`
    ).run(h, AHORA);
  }
  return db;
}

const ejecutor =
  (db: DatabaseSync): Ejecutar =>
  async (sql, params = []) =>
    db.prepare(sql).all(...(params as never[])) as never;

const opciones = { categoriasValidas: CATEGORIAS, ahora: AHORA };

const alta = (extra: Record<string, unknown> = {}) => ({
  codigo: 'CG90001',
  nombre: 'Cartera de prueba',
  descripcion: null,
  precio: 195000,
  categorias: ['carteras'],
  variantes: [{ color: 'Negro', hashes: [HASH_A] }],
  ...extra,
});

const leer = (db: DatabaseSync, codigo: string) =>
  db.prepare(`SELECT * FROM productos WHERE codigo = ?`).get(codigo) as Record<string, unknown>;

// --------------------------------------------------------------------------
// El alta completa
// --------------------------------------------------------------------------

test('crea el producto en importado y con proveedor manual', async () => {
  const db = base();
  const r = await crearProducto(ejecutor(db), alta(), opciones);

  assert.equal(r.creado, true);
  const p = leer(db, 'CG90001');
  assert.equal(p.estado, 'importado');
  assert.equal(p.proveedor, 'manual');
  // El slug se genera al APROBAR, no al importar (§5.2): recién ahí nace la URL.
  assert.equal(p.slug, null);
  assert.equal(p.nombre, 'Cartera de prueba');
  assert.equal(p.precio, 195000);
});

test('el codigo se guarda NORMALIZADO', async () => {
  // Si se guardara tal cual, "cg90001" y "CG90001" convivirian hasta que el indice
  // de la migracion 0002 los frene, y el mensaje seria un error crudo de SQLite.
  const db = base();
  await crearProducto(ejecutor(db), alta({ codigo: '  cg90001 ' }), opciones);
  assert.ok(leer(db, 'CG90001'));
});

test('arma el sku como codigo-slug(color), sin indice posicional', async () => {
  const db = base();
  await crearProducto(
    ejecutor(db),
    alta({
      variantes: [
        { color: 'Azul marino', hashes: [] },
        { color: 'Ñandutí', hashes: [] },
      ],
    }),
    opciones
  );
  const skus = db
    .prepare(`SELECT sku FROM variantes ORDER BY orden`)
    .all()
    .map((f) => (f as { sku: string }).sku);
  assert.deepEqual(skus, ['CG90001-azul-marino', 'CG90001-nanduti']);
});

test('el orden de las variantes es el que se cargo, que es curaduria', async () => {
  // Decide que color se ve al abrir la ficha. Es la misma regla que se aplico al
  // volcado: manda `orden`, no el alfabeto.
  const db = base();
  await crearProducto(
    ejecutor(db),
    alta({
      variantes: [
        { color: 'Zafiro', hashes: [] },
        { color: 'Ambar', hashes: [] },
      ],
    }),
    opciones
  );
  const colores = db
    .prepare(`SELECT color FROM variantes ORDER BY orden`)
    .all()
    .map((f) => (f as { color: string }).color);
  assert.deepEqual(colores, ['Zafiro', 'Ambar']);
});

test('vincula las imagenes ya subidas, en orden', async () => {
  const db = base();
  await crearProducto(
    ejecutor(db),
    alta({ variantes: [{ color: 'Negro', hashes: [HASH_B, HASH_A] }] }),
    opciones
  );
  const hashes = db
    .prepare(
      `SELECT i.hash16 FROM variante_imagenes vi
         JOIN imagenes i ON i.id = vi.imagen_id
        ORDER BY vi.orden`
    )
    .all()
    .map((f) => (f as { hash16: string }).hash16);
  assert.deepEqual(hashes, [HASH_B, HASH_A]);
});

test('cero fotos es valido: se publica con placeholder', async () => {
  // SPEC.md §5.4. El producto sigue visible y contactable.
  const db = base();
  const r = await crearProducto(
    ejecutor(db),
    alta({ variantes: [{ color: 'Negro', hashes: [] }] }),
    opciones
  );
  assert.equal(r.creado, true);
});

test('el alta NUNCA inventa un color de pantalla', async () => {
  // `SPEC.md` §6.6: `color_hex` es #rrggbb o NULL, y nunca se inventa. El alta no tiene
  // forma de escribirlo, asi que sale NULL y el sitio cae a boton con texto (§4.2).
  const db = base();
  await crearProducto(
    ejecutor(db),
    alta({ variantes: [{ color: 'Negro', hashes: [] }] }),
    opciones
  );
  const v = db.prepare(`SELECT color_hex FROM variantes`).get() as { color_hex: string | null };
  assert.equal(v.color_hex, null);
});

// --------------------------------------------------------------------------
// El codigo es la identidad: no falla, ofrece editar (§9)
// --------------------------------------------------------------------------

test('si el codigo ya existe NO falla: devuelve el producto para editarlo', async () => {
  const db = base();
  await crearProducto(ejecutor(db), alta(), opciones);

  const r = await crearProducto(ejecutor(db), alta({ nombre: 'Otro nombre' }), opciones);

  assert.equal(r.creado, false);
  assert.equal(r.existente!.codigo, 'CG90001');
  assert.equal(leer(db, 'CG90001').nombre, 'Cartera de prueba', 'no se piso el existente');
});

test('lo detecta aunque el codigo venga en minuscula', async () => {
  const db = base();
  await crearProducto(ejecutor(db), alta(), opciones);
  const r = await crearProducto(ejecutor(db), alta({ codigo: 'cg90001' }), opciones);
  assert.equal(r.creado, false);
});

// --------------------------------------------------------------------------
// Lo que se rechaza, y sin dejar basura
// --------------------------------------------------------------------------

test('RECHAZA sin variantes: sin variante no hay sku ni imagen', async () => {
  const db = base();
  await assert.rejects(
    () => crearProducto(ejecutor(db), alta({ variantes: [] }), opciones),
    /variante/i
  );
});

test('RECHAZA una categoria inexistente', async () => {
  const db = base();
  await assert.rejects(
    () => crearProducto(ejecutor(db), alta({ categorias: ['inventada'] }), opciones),
    /inventada/
  );
});

test('RECHAZA dos variantes del mismo color: darian el mismo sku', async () => {
  // Sin este chequeo el UNIQUE de sku frena la segunda a mitad del alta y el
  // producto queda creado con una sola variante.
  const db = base();
  await assert.rejects(
    () =>
      crearProducto(
        ejecutor(db),
        alta({
          variantes: [
            { color: 'Negro', hashes: [] },
            { color: 'negro', hashes: [] },
          ],
        }),
        opciones
      ),
    /color|sku/i
  );
});

test('RECHAZA un hash de imagen que no existe', async () => {
  // Vincular una imagen inexistente dejaria la variante sin foto y sin aviso.
  const db = base();
  await assert.rejects(
    () =>
      crearProducto(
        ejecutor(db),
        alta({ variantes: [{ color: 'Negro', hashes: ['cccccccccccccccc'] }] }),
        opciones
      ),
    /imagen/i
  );
});

test('un alta rechazada NO deja el producto a medias', async () => {
  // La validacion entera corre ANTES de escribir. Si no, un producto sin variantes
  // queda en la base y hay que borrarlo a mano desde la terminal.
  const db = base();
  await assert.rejects(() =>
    crearProducto(
      ejecutor(db),
      alta({ variantes: [{ color: 'Negro', hashes: ['cccccccccccccccc'] }] }),
      opciones
    )
  );
  const cuantos = db.prepare(`SELECT COUNT(*) n FROM productos`).get() as { n: number };
  assert.equal(cuantos.n, 0);
});

test('RECHAZA un codigo invalido con mensaje propio, no con error de SQLite', async () => {
  const db = base();
  await assert.rejects(
    () => crearProducto(ejecutor(db), alta({ codigo: 'CG 900 01' }), opciones),
    /espacio/i
  );
});
