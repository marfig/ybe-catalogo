import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

import { aprobar, asignarCategorias } from './transiciones.ts';
import type { Ejecutar } from './grilla.ts';

/**
 * Tests de las transiciones en lote (SPEC-etapa2 §5.2, §10.3).
 *
 * Contra la migracion real: acá se ESCRIBE, y los invariantes que importan los
 * sostiene la base (UNIQUE de slug, CHECK de estado publicable, foreign keys). Un
 * doble los dejaria pasar a todos.
 *
 * El invariante mas caro del sistema esta aca: **el slug se genera una vez y no se
 * regenera nunca**. Vive en conversaciones de WhatsApp que nadie va a corregir.
 */

const MIGRACION = readFileSync(
  new URL('../../../db/migrations/0001_esquema_inicial.sql', import.meta.url),
  'utf8'
);
const AHORA = '2026-08-05T15:00:00Z';
const CATEGORIAS = new Set(['carteras', 'mochilas', 'fiesta', 'dama', 'escolar']);

function base() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(MIGRACION);
  return db;
}

const ejecutor =
  (db: DatabaseSync): Ejecutar =>
  async (sql, params = []) =>
    db.prepare(sql).all(...(params as never[])) as never;

interface Alta {
  codigo?: string;
  nombre?: string | null;
  estado?: string;
  slug?: string | null;
  categorias?: string[];
  fotos?: number;
}

function alta(db: DatabaseSync, a: Alta = {}): number {
  const codigo = a.codigo ?? 'CG1000';
  const estado = a.estado ?? 'importado';
  const fila = db
    .prepare(
      `INSERT INTO productos (codigo, proveedor, slug, nombre, precio, estado, creado_en, actualizado_en)
       VALUES (?, 'chenson', ?, ?, 100000, ?, ?, ?) RETURNING id`
    )
    .get(
      codigo,
      a.slug !== undefined ? a.slug : null,
      a.nombre !== undefined ? a.nombre : 'Cartera de fiesta',
      estado,
      AHORA,
      AHORA
    );
  const id = (fila as { id: number }).id;

  (a.categorias ?? ['carteras']).forEach((c, orden) => {
    db.prepare(
      `INSERT INTO producto_categorias (producto_id, categoria_slug, orden) VALUES (?, ?, ?)`
    ).run(id, c, orden);
  });

  const varianteId = (
    db
      .prepare(
        `INSERT INTO variantes (producto_id, sku, color, orden) VALUES (?, ?, 'Negro', 0) RETURNING id`
      )
      .get(id, `${codigo}-0`) as { id: number }
  ).id;

  for (let f = 0; f < (a.fotos ?? 1); f++) {
    const hash = `${codigo}${f}`.padEnd(16, '0').slice(0, 16).toLowerCase();
    const imagenId = (
      db
        .prepare(
          `INSERT INTO imagenes (hash16, anchos, ancho_origen, alto_origen, bytes_origen, creado_en)
           VALUES (?, '[300,600]', 600, 600, 1000, ?) RETURNING id`
        )
        .get(hash, AHORA) as { id: number }
    ).id;
    db.prepare(
      `INSERT INTO variante_imagenes (variante_id, imagen_id, orden) VALUES (?, ?, ?)`
    ).run(varianteId, imagenId, f);
  }

  return id;
}

const leer = (db: DatabaseSync, id: number) =>
  db.prepare(`SELECT estado, slug, actualizado_en, publicado_en FROM productos WHERE id = ?`).get(id) as {
    estado: string;
    slug: string | null;
    actualizado_en: string;
    publicado_en: string | null;
  };

const opciones = { categoriasValidas: CATEGORIAS, ahora: AHORA };

// --------------------------------------------------------------------------
// Aprobar: el camino feliz y el slug
// --------------------------------------------------------------------------

test('aprobar pasa a aprobado y genera el slug del nombre', async () => {
  const db = base();
  const id = alta(db, { nombre: 'Cartera de fiesta con strass' });

  const [r] = await aprobar(ejecutor(db), [id], opciones);
  assert.equal(r.ok, true);
  assert.equal(r.slug, 'cartera-de-fiesta-con-strass');

  const fila = leer(db, id);
  assert.equal(fila.estado, 'aprobado');
  assert.equal(fila.slug, 'cartera-de-fiesta-con-strass');
  assert.equal(fila.actualizado_en, AHORA);
  // `publicado_en` se sella en la PUBLICACION, no al aprobar (§5.2): un producto
  // aprobado todavia no salio en ningun build.
  assert.equal(fila.publicado_en, null);
});

test('el slug sale sin tildes ni eñes', async () => {
  const db = base();
  const id = alta(db, { nombre: 'Riñonera juvenil' });
  const [r] = await aprobar(ejecutor(db), [id], opciones);
  assert.equal(r.slug, 'rinonera-juvenil');
});

// --------------------------------------------------------------------------
// EL invariante: el slug NO se regenera
// --------------------------------------------------------------------------

test('un producto que YA tiene slug lo conserva, no se le genera otro', async () => {
  // Defensa del invariante mas caro: la URL es inmutable desde que existe.
  const db = base();
  const id = alta(db, { nombre: 'Nombre nuevo y distinto', slug: 'slug-viejo-que-esta-en-la-calle' });

  const [r] = await aprobar(ejecutor(db), [id], opciones);
  assert.equal(r.ok, true);
  assert.equal(leer(db, id).slug, 'slug-viejo-que-esta-en-la-calle');
});

test('aprobar dos veces no cambia el slug ni revienta', async () => {
  const db = base();
  const id = alta(db, { nombre: 'Cartera de fiesta' });
  const [primero] = await aprobar(ejecutor(db), [id], opciones);
  const [segundo] = await aprobar(ejecutor(db), [id], opciones);

  assert.equal(primero.ok, true);
  assert.equal(segundo.ok, false, 'la segunda vez no hay nada que aprobar');
  assert.match(segundo.motivo!, /aprobado/i);
  assert.equal(leer(db, id).slug, primero.slug);
});

// --------------------------------------------------------------------------
// Colisiones de slug
// --------------------------------------------------------------------------

test('una colision con un slug EXISTENTE sufija -2', async () => {
  const db = base();
  alta(db, { codigo: 'CG1', estado: 'publicado', slug: 'cartera-de-fiesta', nombre: 'Cartera de fiesta' });
  const id = alta(db, { codigo: 'CG2', nombre: 'Cartera de fiesta' });

  const [r] = await aprobar(ejecutor(db), [id], opciones);
  assert.equal(r.slug, 'cartera-de-fiesta-2');
});

test('dos productos del MISMO lote con el mismo nombre no colisionan', async () => {
  // El caso que un chequeo contra la base sola no cubre: los dos slugs se generan
  // antes de que ninguno este escrito. Sin acumular dentro del lote, el UNIQUE de
  // la base rechaza el segundo y la aprobacion en lote queda a medias.
  const db = base();
  const a = alta(db, { codigo: 'CG1', nombre: 'Cartera de fiesta' });
  const b = alta(db, { codigo: 'CG2', nombre: 'Cartera de fiesta' });
  const c = alta(db, { codigo: 'CG3', nombre: 'Cartera de fiesta' });

  const rs = await aprobar(ejecutor(db), [a, b, c], opciones);
  assert.ok(rs.every((r) => r.ok), rs.map((r) => r.motivo).join(' | '));
  assert.deepEqual(
    rs.map((r) => r.slug).sort(),
    ['cartera-de-fiesta', 'cartera-de-fiesta-2', 'cartera-de-fiesta-3']
  );
});

// --------------------------------------------------------------------------
// La validacion de §5.2 es la puerta
// --------------------------------------------------------------------------

test('no aprueba un producto sin nombre, y dice por que', async () => {
  const db = base();
  const id = alta(db, { nombre: null });
  const [r] = await aprobar(ejecutor(db), [id], opciones);
  assert.equal(r.ok, false);
  assert.match(r.motivo!, /nombre/i);
  assert.equal(leer(db, id).estado, 'importado', 'no debe haber cambiado de estado');
});

test('no aprueba un producto sin fotos salvo confirmacion explicita', async () => {
  const db = base();
  const id = alta(db, { fotos: 0 });
  const [sinPermiso] = await aprobar(ejecutor(db), [id], opciones);
  assert.equal(sinPermiso.ok, false);
  assert.match(sinPermiso.motivo!, /foto/i);

  const [conPermiso] = await aprobar(ejecutor(db), [id], { ...opciones, permitirSinFoto: true });
  assert.equal(conPermiso.ok, true);
});

test('no aprueba con una categoria que no existe en categorias.json', async () => {
  const db = base();
  const id = alta(db, { categorias: ['inventada'] });
  const [r] = await aprobar(ejecutor(db), [id], opciones);
  assert.equal(r.ok, false);
  assert.match(r.motivo!, /inventada/);
});

test('un lote mixto aprueba los validos y reporta los invalidos', async () => {
  // Lo que §10.3 pide: aprobacion en lote para los que pasan. Cortar todo el lote
  // por uno invalido obligaria a des-seleccionar de a uno.
  const db = base();
  const bueno = alta(db, { codigo: 'CG1', nombre: 'Cartera de fiesta' });
  const malo = alta(db, { codigo: 'CG2', nombre: null });

  const rs = await aprobar(ejecutor(db), [bueno, malo], opciones);
  assert.equal(rs.find((r) => r.id === bueno)!.ok, true);
  assert.equal(rs.find((r) => r.id === malo)!.ok, false);
  assert.equal(leer(db, bueno).estado, 'aprobado');
  assert.equal(leer(db, malo).estado, 'importado');
});

// --------------------------------------------------------------------------
// Solo `importado` -> `aprobado`
// --------------------------------------------------------------------------

test('un publicado no se "re-aprueba"', async () => {
  // La maquina de estados de §5.2 no tiene esa flecha: publicado -> aprobado
  // retrocederia un producto que ya esta en la calle.
  const db = base();
  const id = alta(db, { estado: 'publicado', slug: 'ya-publicado' });
  const [r] = await aprobar(ejecutor(db), [id], opciones);
  assert.equal(r.ok, false);
  assert.equal(leer(db, id).estado, 'publicado');
});

test('un eliminado no se aprueba: se restaura, que es otra transicion', async () => {
  const db = base();
  const id = alta(db, { estado: 'eliminado', slug: 'estaba-eliminado' });
  const [r] = await aprobar(ejecutor(db), [id], opciones);
  assert.equal(r.ok, false);
  assert.equal(leer(db, id).estado, 'eliminado');
});

test('un id que no existe se reporta, no revienta el lote', async () => {
  const db = base();
  const id = alta(db, { nombre: 'Cartera de fiesta' });
  const rs = await aprobar(ejecutor(db), [id, 99999], opciones);
  assert.equal(rs.length, 2);
  assert.equal(rs.find((r) => r.id === 99999)!.ok, false);
  assert.equal(rs.find((r) => r.id === id)!.ok, true);
});

test('una lista vacia no hace nada y no revienta', async () => {
  const db = base();
  assert.deepEqual(await aprobar(ejecutor(db), [], opciones), []);
});

// --------------------------------------------------------------------------
// Asignacion de categorias en lote
// --------------------------------------------------------------------------

test('asigna una categoria a varios productos de una vez', async () => {
  const db = base();
  const a = alta(db, { codigo: 'CG1', categorias: [] });
  const b = alta(db, { codigo: 'CG2', categorias: [] });

  const rs = await asignarCategorias(ejecutor(db), [a, b], ['mochilas'], opciones);
  assert.ok(rs.every((r) => r.ok));

  for (const id of [a, b]) {
    const cats = db
      .prepare(`SELECT categoria_slug FROM producto_categorias WHERE producto_id = ? ORDER BY orden`)
      .all(id)
      .map((f) => (f as { categoria_slug: string }).categoria_slug);
    assert.deepEqual(cats, ['mochilas']);
  }
});

test('AGREGA sin pisar las categorias que ya tenia, y no cambia el breadcrumb', async () => {
  // categorias[0] es el breadcrumb (§5.1). Reemplazar destruiria curaduria en
  // silencio, y agregar al final deja el breadcrumb donde estaba.
  const db = base();
  const id = alta(db, { categorias: ['carteras', 'fiesta'] });

  await asignarCategorias(ejecutor(db), [id], ['dama'], opciones);

  const cats = db
    .prepare(`SELECT categoria_slug FROM producto_categorias WHERE producto_id = ? ORDER BY orden`)
    .all(id)
    .map((f) => (f as { categoria_slug: string }).categoria_slug);
  assert.deepEqual(cats, ['carteras', 'fiesta', 'dama']);
});

test('asignar una categoria que ya tiene no la duplica', async () => {
  const db = base();
  const id = alta(db, { categorias: ['carteras'] });
  const [r] = await asignarCategorias(ejecutor(db), [id], ['carteras'], opciones);

  assert.equal(r.ok, true);
  const cuantas = db
    .prepare(`SELECT COUNT(*) n FROM producto_categorias WHERE producto_id = ?`)
    .get(id) as { n: number };
  assert.equal(cuantas.n, 1);
});

test('una categoria invalida CORTA la operacion completa, sin escribir nada', async () => {
  // Es una eleccion del usuario aplicada a muchos: un slug mal escrito no puede
  // quedar aplicado a medias. Se valida la entrada ANTES de tocar la base.
  const db = base();
  const id = alta(db, { categorias: [] });

  await assert.rejects(
    () => asignarCategorias(ejecutor(db), [id], ['mochilas', 'inventada'], opciones),
    /inventada/
  );

  const cuantas = db
    .prepare(`SELECT COUNT(*) n FROM producto_categorias WHERE producto_id = ?`)
    .get(id) as { n: number };
  assert.equal(cuantas.n, 0, 'no debe haber escrito la categoria valida tampoco');
});

test('asignar sin categorias corta: no es una operacion valida', async () => {
  const db = base();
  const id = alta(db);
  await assert.rejects(() => asignarCategorias(ejecutor(db), [id], [], opciones), /categor/i);
});

test('asignar varias categorias respeta el orden pedido', async () => {
  const db = base();
  const id = alta(db, { categorias: [] });
  await asignarCategorias(ejecutor(db), [id], ['mochilas', 'escolar', 'dama'], opciones);

  const cats = db
    .prepare(`SELECT categoria_slug FROM producto_categorias WHERE producto_id = ? ORDER BY orden`)
    .all(id)
    .map((f) => (f as { categoria_slug: string }).categoria_slug);
  assert.deepEqual(cats, ['mochilas', 'escolar', 'dama']);
});

test('asignar toca actualizado_en del producto', async () => {
  // Sin esto, un cambio de categorias no se reflejaria en el `actualizado` del
  // catalogo y el volcado emitiria una fecha vieja.
  const db = base();
  const id = alta(db, { categorias: [] });
  const otraFecha = '2026-09-09T09:00:00Z';
  await asignarCategorias(ejecutor(db), [id], ['mochilas'], {
    ...opciones,
    ahora: otraFecha,
  });
  assert.equal(leer(db, id).actualizado_en, otraFecha);
});

test('asignar a un id que no existe se reporta, no revienta', async () => {
  const db = base();
  const rs = await asignarCategorias(ejecutor(db), [99999], ['mochilas'], opciones);
  assert.equal(rs[0].ok, false);
});
