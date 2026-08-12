import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { Ejecutar } from '../grilla.ts';
import { aplicarCuraduria } from './aplicar.ts';

/**
 * Contra el ESQUEMA REAL con `node:sqlite`, que es el mismo motor que D1.
 *
 * ESTE ES EL ÚNICO ARCHIVO DE LA MIGRACIÓN QUE PUEDE DESTRUIR ALGO. Todo lo demás lee
 * páginas y escribe columnas de origen; esto escribe `nombre`, `precio` y `descripcion`,
 * que son curaduría — lo que `registrarFicha` se niega a tocar y es su razón de existir.
 * Un UPDATE mal guardado acá borra trabajo de una persona y no hay cómo recuperarlo.
 */
const MIGRACIONES = [
  '0001_esquema_inicial.sql',
  '0002_codigo_insensible_a_mayusculas.sql',
  '0003_aviso_cambio_en_origen.sql',
  '0004_papelera.sql',
  '0005_barrido_de_bajas.sql',
].map((n) => readFileSync(new URL(`../../../../db/migrations/${n}`, import.meta.url), 'utf8'));

const AHORA = '2026-08-12T15:00:00Z';

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

/** Un producto recién importado: sin nombre, sin precio, con las medidas sembradas. */
function importado(db: DatabaseSync, extra: Record<string, unknown> = {}): number {
  const campos = {
    codigo: 'CG85700',
    proveedor: 'chenson',
    estado: 'importado',
    descripcion: 'Medidas aprox. (alto x largo x ancho): 21 x 29 x 14 cm',
    creado_en: AHORA,
    actualizado_en: AHORA,
    ...extra,
  };
  const claves = Object.keys(campos);
  const fila = db
    .prepare(
      `INSERT INTO productos (${claves.join(', ')}) VALUES (${claves.map(() => '?').join(', ')}) RETURNING id`
    )
    .get(...(Object.values(campos) as never[])) as { id: number };
  return fila.id;
}

const leer = (db: DatabaseSync, id: number) =>
  db.prepare('SELECT nombre, precio, descripcion, estado FROM productos WHERE id = ?').get(id) as Record<
    string,
    unknown
  >;

const CURADURIA = {
  nombre: 'Neceser doble cierre mediano',
  precio: 115000,
  descripcion: 'De cuero ecológico\nMedidas: alto 13 x largo 22 x ancho 10 cm',
};

test('cura un producto recién importado', async () => {
  const db = base();
  const id = importado(db);

  assert.equal(await aplicarCuraduria(ejecutor(db), id, CURADURIA, { ahora: AHORA }), true);

  const p = leer(db, id);
  assert.equal(p.nombre, CURADURIA.nombre);
  assert.equal(p.precio, CURADURIA.precio);
  assert.equal(p.descripcion, CURADURIA.descripcion);
  // Sigue siendo «Por aprobar»: aprobar crea la URL definitiva y eso lo decide una
  // persona (§5.2). La migracion no aprueba nada.
  assert.equal(p.estado, 'importado');
});

test('NO pisa el nombre escrito a mano', async () => {
  /**
   * LA GUARDA CENTRAL. El proveedor no publica nombres, así que un nombre no nulo lo
   * escribió una persona: es la señal de que ese producto ya pasó por manos humanas.
   * Devuelve `false` para que quien llama lo pueda contar y reportar.
   */
  const db = base();
  const id = importado(db, { nombre: 'Lo que escribí yo' });

  assert.equal(await aplicarCuraduria(ejecutor(db), id, CURADURIA, { ahora: AHORA }), false);

  const p = leer(db, id);
  assert.equal(p.nombre, 'Lo que escribí yo');
  assert.equal(p.precio, null);
  // Y la descripcion tampoco: los tres campos viajan juntos o no viajan.
  assert.equal(p.descripcion, 'Medidas aprox. (alto x largo x ancho): 21 x 29 x 14 cm');
});

test('NO toca un producto que ya se aprobó o publicó', async () => {
  // Un aprobado tiene URL definitiva y estuvo mirado por alguien. Que `nombre` esté en
  // null ahi seria un producto roto, no una invitacion a completarlo.
  for (const estado of ['aprobado', 'publicado', 'eliminado']) {
    const db = base();
    const id = importado(db, { estado, slug: 'algun-slug' });
    assert.equal(
      await aplicarCuraduria(ejecutor(db), id, CURADURIA, { ahora: AHORA }),
      false,
      `estado ${estado}`
    );
    assert.equal(leer(db, id).nombre, null);
  }
});

test('sin descripción del viejo quedan las medidas del proveedor', async () => {
  /**
   * El caso de `cartuchera-doble-cierre-1734033`, cuya descripción entera era la lista
   * de colores: al podarla no queda nada. El `COALESCE` es lo que hace que la ficha del
   * proveedor sea el respaldo, en vez de dejar el producto sin descripción.
   */
  const db = base();
  const id = importado(db);

  await aplicarCuraduria(ejecutor(db), id, { ...CURADURIA, descripcion: null }, { ahora: AHORA });

  const p = leer(db, id);
  assert.equal(p.nombre, CURADURIA.nombre);
  assert.equal(p.descripcion, 'Medidas aprox. (alto x largo x ancho): 21 x 29 x 14 cm');
});

test('sin precio del viejo el producto entra igual, para que alguien lo ponga', async () => {
  // Un precio en null es «Consultar precio», que es un estado valido del modelo. Perder
  // el nombre y la descripcion por un precio que el origen no dio seria peor.
  const db = base();
  const id = importado(db);

  assert.equal(
    await aplicarCuraduria(ejecutor(db), id, { ...CURADURIA, precio: null }, { ahora: AHORA }),
    true
  );
  assert.equal(leer(db, id).precio, null);
  assert.equal(leer(db, id).nombre, CURADURIA.nombre);
});

test('correrlo dos veces no cambia nada la segunda', async () => {
  // Es lo que hace la migracion reanudable: si se corta en el producto 120, se aprieta
  // de nuevo y los 119 ya curados se saltean solos.
  const db = base();
  const id = importado(db);

  assert.equal(await aplicarCuraduria(ejecutor(db), id, CURADURIA, { ahora: AHORA }), true);
  assert.equal(await aplicarCuraduria(ejecutor(db), id, { ...CURADURIA, nombre: 'Otro' }, { ahora: AHORA }), false);
  assert.equal(leer(db, id).nombre, CURADURIA.nombre);
});

test('un id que no existe no revienta la corrida', async () => {
  // Entre que la pestana armo la lista y llega este pedido, alguien pudo eliminar el
  // producto desde otra pestana.
  const db = base();
  assert.equal(await aplicarCuraduria(ejecutor(db), 9999, CURADURIA, { ahora: AHORA }), false);
});

test('un nombre vacío del origen no se escribe', async () => {
  // Escribir '' dejaria el producto «con nombre» para la guarda de arriba, y ese
  // producto no se podria volver a curar nunca.
  const db = base();
  const id = importado(db);
  assert.equal(
    await aplicarCuraduria(ejecutor(db), id, { ...CURADURIA, nombre: '   ' }, { ahora: AHORA }),
    false
  );
  assert.equal(leer(db, id).nombre, null);
});
