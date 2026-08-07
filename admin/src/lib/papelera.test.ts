import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { Ejecutar } from './grilla.ts';
import {
  contarPurga,
  eliminar,
  fechaDeCorte,
  listarPapelera,
  planearEliminacion,
  purgar,
  restaurar,
} from './papelera.ts';

const MIGRACIONES = [
  '0001_esquema_inicial.sql',
  '0002_codigo_insensible_a_mayusculas.sql',
  '0003_aviso_cambio_en_origen.sql',
  '0004_papelera.sql',
].map((n) => readFileSync(new URL(`../../../db/migrations/${n}`, import.meta.url), 'utf8'));

const AHORA = '2026-08-07T15:00:00Z';
const QUIEN = 'ana@ybe.com.py';

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

/**
 * Crea un producto con `variantes` colores, cada uno con las fotos que se le pasen.
 * Devuelve su id. Las fotos se dan por hash para poder compartirlas entre productos.
 */
function producto(
  db: DatabaseSync,
  {
    codigo,
    estado = 'importado',
    slug = null,
    fotos = [],
  }: { codigo: string; estado?: string; slug?: string | null; fotos?: string[] }
): number {
  const { id } = db
    .prepare(
      `INSERT INTO productos (codigo, proveedor, estado, slug, creado_en, actualizado_en)
       VALUES (?, 'chenson', ?, ?, ?, ?) RETURNING id`
    )
    .get(codigo, estado, slug, AHORA, AHORA) as { id: number };

  const { id: varianteId } = db
    .prepare(
      `INSERT INTO variantes (producto_id, sku, color, orden)
       VALUES (?, ?, 'Negro', 0) RETURNING id`
    )
    .get(id, `${codigo}-N`) as { id: number };

  for (const [orden, hash] of fotos.entries()) {
    let fila = db.prepare(`SELECT id FROM imagenes WHERE hash16 = ?`).get(hash) as
      | { id: number }
      | undefined;
    if (!fila) {
      fila = db
        .prepare(
          `INSERT INTO imagenes (hash16, anchos, ancho_origen, alto_origen, bytes_origen, creado_en)
           VALUES (?, '[300,600]', 600, 600, 1000, ?) RETURNING id`
        )
        .get(hash, AHORA) as { id: number };
    }
    db.prepare(
      `INSERT INTO variante_imagenes (variante_id, imagen_id, orden) VALUES (?, ?, ?)`
    ).run(varianteId, fila.id, orden);
  }

  return id;
}

const estadoDe = (db: DatabaseSync, id: number) =>
  (db.prepare(`SELECT estado FROM productos WHERE id = ?`).get(id) as { estado: string } | undefined)
    ?.estado ?? null;

const cuantos = (db: DatabaseSync, tabla: string) =>
  (db.prepare(`SELECT COUNT(*) n FROM ${tabla}`).get() as { n: number }).n;

// --------------------------------------------------------------------------
// El plan: qué va a pasar, ANTES de confirmar (§12.2)
// --------------------------------------------------------------------------

test('planearEliminacion: lo que nunca fue público se borra de verdad', async () => {
  const db = base();
  const i = producto(db, { codigo: 'CG1', estado: 'importado', fotos: ['a'.repeat(16)] });
  const a = producto(db, { codigo: 'CG2', estado: 'aprobado', slug: 'cg2', fotos: [] });

  const plan = await planearEliminacion(ejecutor(db), [i, a]);

  assert.deepEqual(
    plan.fisicos.map((p) => p.codigo),
    ['CG1', 'CG2']
  );
  assert.deepEqual(plan.logicos, []);
});

test('planearEliminacion: lo publicado se saca del catálogo, no se borra', async () => {
  // Hay URLs en la calle: en un negocio cuyo canal es WhatsApp los enlaces viven
  // para siempre en conversaciones, y un 404 ahi no lo reporta nadie (§12.1).
  const db = base();
  const p = producto(db, { codigo: 'CG3', estado: 'publicado', slug: 'cg3', fotos: ['b'.repeat(16)] });

  const plan = await planearEliminacion(ejecutor(db), [p]);

  assert.deepEqual(plan.fisicos, []);
  assert.deepEqual(
    plan.logicos.map((x) => x.codigo),
    ['CG3']
  );
});

test('planearEliminacion: cuenta las fotos que se van con el borrado físico', async () => {
  // El mensaje de confirmacion de §12.2 lo dice: «junto con sus 4 fotos».
  const db = base();
  const i = producto(db, {
    codigo: 'CG1',
    fotos: ['a'.repeat(16), 'b'.repeat(16), 'c'.repeat(16)],
  });

  const plan = await planearEliminacion(ejecutor(db), [i]);

  assert.equal(plan.fisicos[0].fotos, 3);
});

test('planearEliminacion: una foto compartida con otro producto NO se cuenta como perdida', async () => {
  /**
   * El dedupe de `SPEC.md` §6.8 hace que la misma foto pertenezca a variantes de
   * productos distintos. Prometer que se borran 3 fotos y borrar 1 miente en la
   * direccion peligrosa: quien confirma cree que esta perdiendo mas de lo que pierde.
   */
  const db = base();
  const compartida = 'a'.repeat(16);
  const i = producto(db, { codigo: 'CG1', fotos: [compartida, 'b'.repeat(16)] });
  producto(db, { codigo: 'CG2', estado: 'publicado', slug: 'cg2', fotos: [compartida] });

  const plan = await planearEliminacion(ejecutor(db), [i]);

  assert.equal(plan.fisicos[0].fotos, 1, 'sólo la que no comparte');
});

test('planearEliminacion: lo que ya está en la papelera se omite', async () => {
  const db = base();
  const e = producto(db, { codigo: 'CG4', estado: 'eliminado', slug: 'cg4' });

  const plan = await planearEliminacion(ejecutor(db), [e]);

  assert.deepEqual(plan.fisicos, []);
  assert.deepEqual(plan.logicos, []);
  assert.equal(plan.omitidos.length, 1);
  assert.match(plan.omitidos[0].motivo, /papelera/i);
});

test('planearEliminacion: un id que no existe se reporta, no se ignora', async () => {
  const plan = await planearEliminacion(ejecutor(base()), [99999]);
  assert.equal(plan.omitidos.length, 1);
  assert.match(plan.omitidos[0].motivo, /no existe/i);
});

// --------------------------------------------------------------------------
// Eliminar (§12.2)
// --------------------------------------------------------------------------

test('eliminar: el borrado físico se lleva el producto y sus variantes', async () => {
  const db = base();
  const i = producto(db, { codigo: 'CG1', fotos: ['a'.repeat(16)] });

  const r = await eliminar(ejecutor(db), [i], { ahora: AHORA, porQuien: QUIEN });

  assert.equal(estadoDe(db, i), null, 'la fila ya no está');
  assert.equal(cuantos(db, 'variantes'), 0, 'las variantes caen por cascade');
  assert.equal(cuantos(db, 'variante_imagenes'), 0);
  assert.equal(r.resultados.find((x) => x.id === i)?.desenlace, 'hecho');
});

test('eliminar: se lleva las filas de las imágenes huérfanas y las devuelve para R2', async () => {
  /**
   * §12.2 dice «físico, con sus imágenes huérfanas». La fila se borra acá; el objeto en
   * R2 lo borra quien llama, porque este módulo no conoce el balde. El orden importa: se
   * borra primero la base y después R2. Al revés, un fallo dejaría filas apuntando a
   * objetos que no están — o sea, fotos rotas. Así, el peor caso es un objeto que nadie
   * referencia: invisible, y el espacio no es el problema (§12.1).
   */
  const db = base();
  const i = producto(db, { codigo: 'CG1', fotos: ['a'.repeat(16), 'b'.repeat(16)] });

  const r = await eliminar(ejecutor(db), [i], { ahora: AHORA, porQuien: QUIEN });

  assert.deepEqual(r.huerfanas, ['a'.repeat(16), 'b'.repeat(16)]);
  assert.equal(cuantos(db, 'imagenes'), 0);
});

test('eliminar: una foto que otro producto sigue usando NO queda huérfana', async () => {
  const db = base();
  const compartida = 'a'.repeat(16);
  const i = producto(db, { codigo: 'CG1', fotos: [compartida, 'b'.repeat(16)] });
  producto(db, { codigo: 'CG2', estado: 'publicado', slug: 'cg2', fotos: [compartida] });

  const r = await eliminar(ejecutor(db), [i], { ahora: AHORA, porQuien: QUIEN });

  assert.deepEqual(r.huerfanas, ['b'.repeat(16)]);
  assert.equal(cuantos(db, 'imagenes'), 1, 'la compartida se queda');
});

test('eliminar: lo publicado pasa a eliminado y se sella quién y cuándo', async () => {
  const db = base();
  const p = producto(db, { codigo: 'CG3', estado: 'publicado', slug: 'cg3' });

  await eliminar(ejecutor(db), [p], { ahora: AHORA, porQuien: QUIEN });

  const fila = db
    .prepare(`SELECT estado, eliminado_en, eliminado_por, slug FROM productos WHERE id = ?`)
    .get(p) as { estado: string; eliminado_en: string; eliminado_por: string; slug: string };

  assert.equal(fila.estado, 'eliminado');
  assert.equal(fila.eliminado_en, AHORA);
  assert.equal(fila.eliminado_por, QUIEN);
  assert.equal(fila.slug, 'cg3', 'el slug NO se libera: la URL sigue siendo de este producto');
});

test('eliminar: el borrado lógico no toca ninguna foto', async () => {
  // El producto sigue en `productos.json` con `activo: false` (§5.2): sus fotos
  // todavia se referencian.
  const db = base();
  const p = producto(db, { codigo: 'CG3', estado: 'publicado', slug: 'cg3', fotos: ['b'.repeat(16)] });

  await eliminar(ejecutor(db), [p], { ahora: AHORA, porQuien: QUIEN });

  assert.equal(cuantos(db, 'imagenes'), 1);
  assert.equal(cuantos(db, 'variante_imagenes'), 1);
});

test('eliminar: un lote mixto hace las dos cosas en la misma pasada', async () => {
  const db = base();
  const i = producto(db, { codigo: 'CG1' });
  const p = producto(db, { codigo: 'CG3', estado: 'publicado', slug: 'cg3' });

  const r = await eliminar(ejecutor(db), [i, p], { ahora: AHORA, porQuien: QUIEN });

  assert.equal(estadoDe(db, i), null);
  assert.equal(estadoDe(db, p), 'eliminado');
  assert.equal(r.resultados.filter((x) => x.desenlace === 'hecho').length, 2);
});

test('eliminar: lo que ya está en la papelera se omite, no falla', async () => {
  const db = base();
  const e = producto(db, { codigo: 'CG4', estado: 'eliminado', slug: 'cg4' });

  const r = await eliminar(ejecutor(db), [e], { ahora: AHORA, porQuien: QUIEN });

  assert.equal(r.resultados[0].desenlace, 'omitido');
  assert.equal(estadoDe(db, e), 'eliminado');
});

test('eliminar: repetirlo es seguro', async () => {
  const db = base();
  const p = producto(db, { codigo: 'CG3', estado: 'publicado', slug: 'cg3' });

  await eliminar(ejecutor(db), [p], { ahora: AHORA, porQuien: QUIEN });
  const segunda = await eliminar(ejecutor(db), [p], { ahora: AHORA, porQuien: QUIEN });

  assert.equal(segunda.resultados[0].desenlace, 'omitido');
});

test('eliminar: sin ids no toca la base', async () => {
  const db = base();
  producto(db, { codigo: 'CG1' });
  assert.deepEqual(await eliminar(ejecutor(db), [], { ahora: AHORA, porQuien: QUIEN }), {
    resultados: [],
    huerfanas: [],
  });
  assert.equal(cuantos(db, 'productos'), 1);
});

// --------------------------------------------------------------------------
// Restaurar (§10.5)
// --------------------------------------------------------------------------

test('restaurar: vuelve a publicado y limpia el sello de eliminación', async () => {
  const db = base();
  const p = producto(db, { codigo: 'CG3', estado: 'publicado', slug: 'cg3' });
  await eliminar(ejecutor(db), [p], { ahora: AHORA, porQuien: QUIEN });

  const r = await restaurar(ejecutor(db), [p], { ahora: '2026-08-08T10:00:00Z' });

  const fila = db
    .prepare(`SELECT estado, eliminado_en, eliminado_por, slug FROM productos WHERE id = ?`)
    .get(p) as {
    estado: string;
    eliminado_en: string | null;
    eliminado_por: string | null;
    slug: string;
  };

  assert.equal(r[0].desenlace, 'hecho');
  assert.equal(fila.estado, 'publicado');
  assert.equal(fila.eliminado_en, null);
  assert.equal(fila.eliminado_por, null);
  assert.equal(fila.slug, 'cg3', 'la URL de siempre');
});

test('restaurar: sólo desde eliminado. Un publicado se omite', async () => {
  const db = base();
  const p = producto(db, { codigo: 'CG3', estado: 'publicado', slug: 'cg3' });

  const r = await restaurar(ejecutor(db), [p], { ahora: AHORA });

  assert.equal(r[0].desenlace, 'omitido');
  assert.equal(estadoDe(db, p), 'publicado');
});

test('restaurar: un id inexistente se omite con motivo', async () => {
  const r = await restaurar(ejecutor(base()), [99999], { ahora: AHORA });
  assert.equal(r[0].desenlace, 'omitido');
  assert.match(r[0].motivo!, /no existe/i);
});

// --------------------------------------------------------------------------
// El contenido de la papelera (§10.5)
// --------------------------------------------------------------------------

test('listarPapelera: sólo lo eliminado, con su fecha y quién lo hizo', async () => {
  const db = base();
  producto(db, { codigo: 'CG1', estado: 'publicado', slug: 'cg1' });
  const p = producto(db, { codigo: 'CG3', estado: 'publicado', slug: 'cg3', fotos: ['b'.repeat(16)] });
  await eliminar(ejecutor(db), [p], { ahora: AHORA, porQuien: QUIEN });

  const filas = await listarPapelera(ejecutor(db));

  assert.equal(filas.length, 1);
  assert.equal(filas[0].codigo, 'CG3');
  assert.equal(filas[0].eliminado_en, AHORA);
  assert.equal(filas[0].eliminado_por, QUIEN);
  assert.equal(filas[0].miniatura, 'b'.repeat(16), 'la foto que mostraba el sitio');
});

test('listarPapelera: lo más reciente primero', async () => {
  // Lo recien sacado es lo que mas chance tiene de haber sido un error, asi que es lo
  // que se va a querer restaurar.
  const db = base();
  const viejo = producto(db, { codigo: 'CG1', estado: 'publicado', slug: 'cg1' });
  const nuevo = producto(db, { codigo: 'CG2', estado: 'publicado', slug: 'cg2' });
  await eliminar(ejecutor(db), [viejo], { ahora: '2026-01-01T00:00:00Z', porQuien: QUIEN });
  await eliminar(ejecutor(db), [nuevo], { ahora: '2026-08-01T00:00:00Z', porQuien: QUIEN });

  const filas = await listarPapelera(ejecutor(db));

  assert.deepEqual(
    filas.map((f) => f.codigo),
    ['CG2', 'CG1']
  );
});

test('listarPapelera: lo que no tiene fecha va al final, no primero', async () => {
  /**
   * Las filas anteriores a la migracion 0004 tienen `eliminado_en` en NULL. En un
   * `ORDER BY ... DESC` pelado, NULL va primero en SQLite: lo mas viejo de todo
   * encabezaria la lista de «lo que acabas de sacar».
   */
  const db = base();
  producto(db, { codigo: 'CG0', estado: 'eliminado', slug: 'cg0' });
  const p = producto(db, { codigo: 'CG2', estado: 'publicado', slug: 'cg2' });
  await eliminar(ejecutor(db), [p], { ahora: AHORA, porQuien: QUIEN });

  const filas = await listarPapelera(ejecutor(db));

  assert.deepEqual(
    filas.map((f) => f.codigo),
    ['CG2', 'CG0']
  );
});

test('listarPapelera: una papelera vacía es una lista vacía, no un error', async () => {
  assert.deepEqual(await listarPapelera(ejecutor(base())), []);
});

// --------------------------------------------------------------------------
// La fecha de corte de la purga (§12.3) — pura
// --------------------------------------------------------------------------

test('fechaDeCorte: seis meses atrás por defecto', () => {
  assert.equal(fechaDeCorte('2026-08-07T15:00:00.000Z'), '2026-02-07T15:00:00.000Z');
});

test('fechaDeCorte: los meses son configurables', () => {
  assert.equal(fechaDeCorte('2026-08-07T15:00:00.000Z', 1), '2026-07-07T15:00:00.000Z');
});

test('fechaDeCorte: cruza el año sin romperse', () => {
  assert.equal(fechaDeCorte('2026-03-15T00:00:00.000Z', 6), '2025-09-15T00:00:00.000Z');
});

test('fechaDeCorte: el 31 no se desborda al mes siguiente', () => {
  /**
   * `setMonth` sobre un 31 en un mes de 30 rueda al mes que viene: 31 de agosto menos
   * 6 meses daria «31 de febrero» = 3 de marzo, y la purga barreria un mes de mas.
   */
  assert.equal(fechaDeCorte('2026-08-31T00:00:00.000Z', 6), '2026-02-28T00:00:00.000Z');
});

test('fechaDeCorte: una fecha que no parsea lanza en vez de barrer todo', () => {
  // Una fecha invalida daria `Invalid Date` y un corte que compara mal: el modo de
  // falla seria purgar de mas, que es irreversible.
  assert.throws(() => fechaDeCorte('no soy una fecha'), /fecha/i);
});

test('fechaDeCorte: meses no positivos se rechazan', () => {
  // Cero meses purgaria todo lo que se acaba de eliminar.
  assert.throws(() => fechaDeCorte('2026-08-07T15:00:00.000Z', 0), /meses/i);
  assert.throws(() => fechaDeCorte('2026-08-07T15:00:00.000Z', -3), /meses/i);
});

// --------------------------------------------------------------------------
// Vaciar papelera (§12.3)
// --------------------------------------------------------------------------

async function eliminadoHace(db: DatabaseSync, codigo: string, cuando: string): Promise<number> {
  const id = producto(db, { codigo, estado: 'publicado', slug: codigo.toLowerCase(), fotos: [codigo] });
  await eliminar(ejecutor(db), [id], { ahora: cuando, porQuien: QUIEN });
  return id;
}

test('contarPurga: informa qué se va ANTES de confirmar', async () => {
  // §12.3-3 es explicito: informa cuantos productos y cuantas imagenes se van antes
  // de confirmar. Sin eso, «vaciar papelera» es un boton a ciegas.
  const db = base();
  await eliminadoHace(db, 'AAAAAAAAAAAAAAAA', '2026-01-01T00:00:00Z');

  const cuenta = await contarPurga(ejecutor(db), { antesDe: '2026-02-07T15:00:00Z' });

  assert.equal(cuenta.productos, 1);
  assert.equal(cuenta.imagenes, 1);
  assert.deepEqual(cuenta.codigos, ['AAAAAAAAAAAAAAAA']);
});

test('contarPurga: lo eliminado hace poco no entra', async () => {
  const db = base();
  await eliminadoHace(db, 'BBBBBBBBBBBBBBBB', '2026-08-01T00:00:00Z');

  const cuenta = await contarPurga(ejecutor(db), { antesDe: '2026-02-07T15:00:00Z' });

  assert.equal(cuenta.productos, 0);
  assert.equal(cuenta.imagenes, 0);
});

test('contarPurga: no cuenta una imagen que otro producto vivo sigue usando', async () => {
  const db = base();
  const compartida = 'CCCCCCCCCCCCCCCC';
  const viejo = producto(db, { codigo: 'CG9', estado: 'publicado', slug: 'cg9', fotos: [compartida] });
  await eliminar(ejecutor(db), [viejo], { ahora: '2026-01-01T00:00:00Z', porQuien: QUIEN });
  producto(db, { codigo: 'CG10', estado: 'publicado', slug: 'cg10', fotos: [compartida] });

  const cuenta = await contarPurga(ejecutor(db), { antesDe: '2026-02-07T15:00:00Z' });

  assert.equal(cuenta.productos, 1);
  assert.equal(cuenta.imagenes, 0, 'la foto se queda: la usa un producto vivo');
});

test('purgar: borra los viejos y devuelve los hashes huérfanos para R2', async () => {
  const db = base();
  await eliminadoHace(db, 'AAAAAAAAAAAAAAAA', '2026-01-01T00:00:00Z');

  const r = await purgar(ejecutor(db), { antesDe: '2026-02-07T15:00:00Z' });

  assert.deepEqual(r.codigos, ['AAAAAAAAAAAAAAAA']);
  assert.deepEqual(r.huerfanas, ['AAAAAAAAAAAAAAAA']);
  assert.equal(cuantos(db, 'productos'), 0);
  assert.equal(cuantos(db, 'imagenes'), 0, 'la fila de la imagen también se va');
});

test('purgar: no toca lo eliminado hace poco', async () => {
  const db = base();
  await eliminadoHace(db, 'BBBBBBBBBBBBBBBB', '2026-08-01T00:00:00Z');

  const r = await purgar(ejecutor(db), { antesDe: '2026-02-07T15:00:00Z' });

  assert.deepEqual(r.codigos, []);
  assert.equal(cuantos(db, 'productos'), 1);
});

test('purgar: no toca un publicado, por viejo que sea', async () => {
  const db = base();
  producto(db, { codigo: 'CG3', estado: 'publicado', slug: 'cg3' });

  const r = await purgar(ejecutor(db), { antesDe: '2027-01-01T00:00:00Z' });

  assert.deepEqual(r.codigos, []);
  assert.equal(cuantos(db, 'productos'), 1);
});

test('purgar: un eliminado SIN fecha no se barre', async () => {
  /**
   * Las filas que ya estaban eliminadas antes de la migracion 0004 tienen
   * `eliminado_en` en NULL. Si el corte las tomara, «vaciar papelera» borraria en la
   * primera corrida todo lo historico, sin que su antiguedad se haya podido evaluar.
   */
  const db = base();
  const id = producto(db, { codigo: 'CG4', estado: 'eliminado', slug: 'cg4' });

  const r = await purgar(ejecutor(db), { antesDe: '2027-01-01T00:00:00Z' });

  assert.deepEqual(r.codigos, []);
  assert.equal(estadoDe(db, id), 'eliminado');
});

test('purgar: no deja huérfana una imagen que comparte con un producto vivo', async () => {
  const db = base();
  const compartida = 'CCCCCCCCCCCCCCCC';
  const viejo = producto(db, { codigo: 'CG9', estado: 'publicado', slug: 'cg9', fotos: [compartida] });
  await eliminar(ejecutor(db), [viejo], { ahora: '2026-01-01T00:00:00Z', porQuien: QUIEN });
  producto(db, { codigo: 'CG10', estado: 'publicado', slug: 'cg10', fotos: [compartida] });

  const r = await purgar(ejecutor(db), { antesDe: '2026-02-07T15:00:00Z' });

  assert.deepEqual(r.huerfanas, []);
  assert.equal(cuantos(db, 'imagenes'), 1, 'la fila queda: la referencia el producto vivo');
});
