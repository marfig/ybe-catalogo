import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

import {
  actualizarPedidoEspecial,
  alternarActivo,
  crearPedidoEspecial,
  eliminarPedidoEspecial,
  hayErrores,
  listarPedidosEspeciales,
  validar,
  type DatosPedidoEspecial,
} from './pedidos-especiales.ts';
import type { Ejecutar } from './grilla.ts';

/**
 * ABM de pedidos especiales (SPEC.md §4.5).
 *
 * Contra la MIGRACION REAL en `node:sqlite`, mismo patrón que el resto del admin: D1
 * es SQLite, así que el SQL que pasa acá es el que corre en producción.
 */
const MIGRACIONES = [
  '0001_esquema_inicial.sql',
  '0002_codigo_insensible_a_mayusculas.sql',
  '0003_aviso_cambio_en_origen.sql',
  '0004_papelera.sql',
  '0005_barrido_de_bajas.sql',
  '0006_pedidos_especiales.sql',
].map((n) => readFileSync(new URL(`../../../db/migrations/${n}`, import.meta.url), 'utf8'));

const AHORA = '2026-08-30T12:00:00Z';
const ANTES = '2026-08-01T09:00:00Z';
const HASH_A = 'e5469209224bdfb3';
const HASH_B = '0589a199d184ad9d';

function base(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const m of MIGRACIONES) db.exec(m);
  // Las dos imágenes que el formulario va a referenciar: `/api/imagenes` ya las
  // registró antes de que se guarde la ficha.
  for (const h of [HASH_A, HASH_B]) {
    db.prepare(
      `INSERT INTO imagenes (hash16, anchos, ancho_origen, alto_origen, bytes_origen, creado_en)
       VALUES (?, '[300,600]', 1200, 1200, 90000, ?)`
    ).run(h, ANTES);
  }
  return db;
}

const ejecutor =
  (db: DatabaseSync): Ejecutar =>
  async (sql, params = []) =>
    db.prepare(sql).all(...(params as never[])) as never;

const datos = (extra: Partial<DatosPedidoEspecial> = {}): DatosPedidoEspecial => ({
  nombre: 'Mochilas escolares por cantidad',
  descripcion: 'Cantidad mínima: 12 unidades.',
  hash16: HASH_A,
  orden: 10,
  activo: true,
  ...extra,
});

const leer = (db: DatabaseSync, id: number) =>
  db.prepare(`SELECT * FROM pedidos_especiales WHERE id = ?`).get(id) as Record<string, unknown>;

// --------------------------------------------------------------------------
// Validación
// --------------------------------------------------------------------------

test('la descripcion es obligatoria: es la diferencia con un producto', () => {
  // Un producto se publica sin descripción porque su ficha se sostiene con precio,
  // código, colores y marca. Acá no hay nada de eso: la descripción ES la ficha.
  const errores = validar(datos({ descripcion: '   ' }));
  assert.ok(errores.descripcion);
  assert.ok(hayErrores(errores));
});

test('devuelve TODOS los errores de una vez, no el primero', () => {
  // Un formulario que revela un problema por intento se abandona en el tercero.
  const errores = validar({ nombre: '', descripcion: '', hash16: 'x', orden: -1, activo: true });
  assert.deepEqual(Object.keys(errores).sort(), ['descripcion', 'hash16', 'nombre', 'orden']);
});

test('sin foto no pasa: esta grilla no tiene placeholder', () => {
  assert.ok(validar(datos({ hash16: '' })).hash16);
  assert.ok(validar(datos({ hash16: 'NOESUNHASH' })).hash16);
});

test('unos datos completos no dan errores', () => {
  assert.equal(hayErrores(validar(datos())), false);
});

// --------------------------------------------------------------------------
// Alta
// --------------------------------------------------------------------------

test('crear deriva el slug del nombre y guarda la ficha', async () => {
  const db = base();
  const { id, slug } = await crearPedidoEspecial(ejecutor(db), datos(), { ahora: AHORA });

  assert.equal(slug, 'mochilas-escolares-por-cantidad');
  const fila = leer(db, id);
  assert.equal(fila.nombre, 'Mochilas escolares por cantidad');
  assert.equal(fila.descripcion, 'Cantidad mínima: 12 unidades.');
  assert.equal(fila.activo, 1);
  assert.equal(fila.actualizado_en, AHORA);
});

test('dos nombres iguales no chocan: el segundo slug se sufija', async () => {
  // El UNIQUE de la columna rechazaría el INSERT, y la pantalla mostraría un error de
  // base de datos por algo que el usuario no puede ver ni resolver.
  const db = base();
  const primero = await crearPedidoEspecial(ejecutor(db), datos(), { ahora: AHORA });
  const segundo = await crearPedidoEspecial(ejecutor(db), datos(), { ahora: AHORA });

  assert.equal(primero.slug, 'mochilas-escolares-por-cantidad');
  assert.equal(segundo.slug, 'mochilas-escolares-por-cantidad-2');
});

test('crear con una imagen que no se subió corta con un mensaje que se entiende', async () => {
  const db = base();
  await assert.rejects(
    () => crearPedidoEspecial(ejecutor(db), datos({ hash16: 'ffffffffffffffff' }), { ahora: AHORA }),
    /no está registrada/
  );
});

test('crear con datos inválidos no escribe nada', async () => {
  const db = base();
  await assert.rejects(() =>
    crearPedidoEspecial(ejecutor(db), datos({ descripcion: '' }), { ahora: AHORA })
  );
  assert.equal(
    (db.prepare('SELECT count(*) c FROM pedidos_especiales').get() as { c: number }).c,
    0
  );
});

// --------------------------------------------------------------------------
// Edición — el slug es inmutable
// --------------------------------------------------------------------------

test('renombrar cambia el nombre y NUNCA el slug', async () => {
  /**
   * El test que justifica la regla. Estas fichas se comparten por WhatsApp, que es el
   * único canal de venta del negocio: un slug que sigue al nombre rompe cada enlace
   * que un cliente tenga guardado, y nadie se entera hasta que alguien no puede abrir
   * lo que le mandaron.
   */
  const db = base();
  const { id, slug } = await crearPedidoEspecial(ejecutor(db), datos(), { ahora: ANTES });

  await actualizarPedidoEspecial(
    ejecutor(db),
    id,
    datos({ nombre: 'Otro nombre completamente distinto' }),
    { ahora: AHORA }
  );

  const fila = leer(db, id);
  assert.equal(fila.nombre, 'Otro nombre completamente distinto');
  assert.equal(fila.slug, slug, 'la URL no se movió');
});

test('actualizar cambia la foto, el orden y la descripcion', async () => {
  const db = base();
  const { id } = await crearPedidoEspecial(ejecutor(db), datos(), { ahora: ANTES });

  await actualizarPedidoEspecial(
    ejecutor(db),
    id,
    datos({ hash16: HASH_B, orden: 99, descripcion: 'Cantidad mínima: 24 unidades.' }),
    { ahora: AHORA }
  );

  const [fila] = await listarPedidosEspeciales(ejecutor(db));
  assert.equal(fila!.hash16, HASH_B);
  assert.equal(fila!.orden, 99);
  assert.equal(fila!.descripcion, 'Cantidad mínima: 24 unidades.');
});

// --------------------------------------------------------------------------
// Listado, apagado y borrado
// --------------------------------------------------------------------------

test('el listado ordena por `orden` con el slug de desempate', async () => {
  const db = base();
  await crearPedidoEspecial(ejecutor(db), datos({ nombre: 'Zeta', orden: 30 }), { ahora: AHORA });
  await crearPedidoEspecial(ejecutor(db), datos({ nombre: 'Alfa', orden: 10 }), { ahora: AHORA });
  await crearPedidoEspecial(ejecutor(db), datos({ nombre: 'Beta', orden: 10 }), { ahora: AHORA });

  assert.deepEqual(
    (await listarPedidosEspeciales(ejecutor(db))).map((p) => p.nombre),
    ['Alfa', 'Beta', 'Zeta']
  );
});

test('el listado trae `activo` como BOOLEANO, no como el 0/1 de la columna', async () => {
  // En JSX un 0 crudo es un valor presente: `checked={0}` sale tildado.
  const db = base();
  await crearPedidoEspecial(ejecutor(db), datos({ activo: false }), { ahora: AHORA });

  const [fila] = await listarPedidosEspeciales(ejecutor(db));
  assert.equal(fila!.activo, false);
});

test('apagar y volver a prender conserva la MISMA url', async () => {
  const db = base();
  const { id, slug } = await crearPedidoEspecial(ejecutor(db), datos(), { ahora: ANTES });

  await alternarActivo(ejecutor(db), id, false, { ahora: AHORA });
  assert.equal(leer(db, id).activo, 0);

  await alternarActivo(ejecutor(db), id, true, { ahora: AHORA });
  assert.equal(leer(db, id).activo, 1);
  assert.equal(leer(db, id).slug, slug);
});

test('borrar la ficha NO borra su imagen', async () => {
  /**
   * La imagen puede estar compartida con un producto —el dedupe de `guardarImagen` es
   * por contenido—, así que borrarla acá dejaría un `<img>` roto en el catálogo. Quien
   * decide si un objeto ya no lo referencia nadie es la recolección de huérfanas.
   */
  const db = base();
  const { id } = await crearPedidoEspecial(ejecutor(db), datos(), { ahora: AHORA });

  await eliminarPedidoEspecial(ejecutor(db), id);

  assert.equal(leer(db, id), undefined);
  assert.equal(
    (db.prepare('SELECT count(*) c FROM imagenes WHERE hash16 = ?').get(HASH_A) as { c: number }).c,
    1
  );
});
