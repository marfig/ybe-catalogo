import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

import { esWebp, guardarImagen, validarSubida } from './subida.ts';
import type { Ejecutar } from './grilla.ts';

/**
 * Tests de la subida de derivadas (SPEC-etapa2 §8.3, SPEC.md §5.1, §6.8).
 *
 * El riesgo que define el diseño: **el hash lo calcula el navegador** (§8.3) y la
 * clave en R2 es `catalogo/{hash16}/w{n}.webp`. Un hash equivocado — por un bug del
 * cliente, que es nuestro propio código — pisaría las fotos de OTRO producto.
 *
 * Por eso lo que más se prueba acá no es el camino feliz: es que no se sobreescriba
 * nada y que no entre basura a un bucket público.
 */

const MIGRACION = readFileSync(
  new URL('../../../db/migrations/0001_esquema_inicial.sql', import.meta.url),
  'utf8'
);
const AHORA = '2026-08-06T12:00:00Z';
const HASH = 'a1b2c3d4e5f60718';

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

/** Bytes con la firma real de un WebP: `RIFF` + tamaño + `WEBP`. */
function webp(relleno = 64): Uint8Array {
  const b = new Uint8Array(12 + relleno);
  b.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  b.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  return b;
}

/** Balde falso que registra lo que se guardo. */
function baldeFalso() {
  const puestos = new Map<string, { bytes: Uint8Array; opciones: unknown }>();
  return {
    puestos,
    async put(clave: string, bytes: Uint8Array, opciones: unknown) {
      puestos.set(clave, { bytes, opciones });
    },
  };
}

const datos = (extra: Record<string, unknown> = {}) => ({
  hash16: HASH,
  anchoOrigen: 4000,
  altoOrigen: 3000,
  bytesOrigen: 2_400_000,
  derivadas: new Map([
    [300, webp()],
    [600, webp()],
  ]),
  ...extra,
});

// --------------------------------------------------------------------------
// esWebp — no entra basura a un bucket publico
// --------------------------------------------------------------------------

test('esWebp reconoce la firma RIFF....WEBP', () => {
  assert.equal(esWebp(webp()), true);
});

test('esWebp rechaza cualquier otra cosa', () => {
  // Se sirven con Content-Type: image/webp desde una URL publica. Subir un HTML o
  // un PNG con esa cabecera es, como minimo, una imagen rota en el catalogo.
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]);
  const html = new TextEncoder().encode('<!doctype html><html></html>');
  assert.equal(esWebp(png), false);
  assert.equal(esWebp(html), false);
  assert.equal(esWebp(new Uint8Array(4)), false, 'demasiado corto');
  assert.equal(esWebp(new Uint8Array(0)), false);
});

test('esWebp rechaza un RIFF que NO es WEBP', () => {
  // Un WAV tambien empieza con RIFF. Mirar solo los primeros 4 bytes no alcanza.
  const wav = new Uint8Array(12);
  wav.set([0x52, 0x49, 0x46, 0x46], 0);
  wav.set([0x57, 0x41, 0x56, 0x45], 8); // WAVE
  assert.equal(esWebp(wav), false);
});

// --------------------------------------------------------------------------
// validarSubida
// --------------------------------------------------------------------------

test('una subida bien formada pasa', () => {
  assert.doesNotThrow(() => validarSubida(datos()));
});

test('RECHAZA un hash16 mal formado', () => {
  // La clave de R2 se arma con esto. Un hash con barras o puntos escribiria fuera
  // del prefijo `catalogo/`.
  for (const hash16 of ['', 'corto', 'A1B2C3D4E5F60718', 'a1b2c3d4e5f6071', '../../etc/passwd', 'a1b2c3d4e5f60718x']) {
    assert.throws(() => validarSubida(datos({ hash16 })), /hash/i, `deberia rechazar ${hash16}`);
  }
});

test('RECHAZA una derivada que no es WebP', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.throws(
    () => validarSubida(datos({ derivadas: new Map([[300, png]]) })),
    /webp/i
  );
});

test('RECHAZA un ancho que no es del contrato', () => {
  // content.config.ts solo acepta 300 y 600. Un w450 en R2 no lo pediria nadie.
  assert.throws(
    () => validarSubida(datos({ derivadas: new Map([[450, webp()]])})),
    /ancho/i
  );
});

test('RECHAZA una subida sin derivadas', () => {
  assert.throws(() => validarSubida(datos({ derivadas: new Map() })), /derivada/i);
});

test('RECHAZA una derivada absurdamente grande', () => {
  // Un w300.webp de 20 MB es un bug o un abuso, no una miniatura.
  const enorme = new Uint8Array(20 * 1024 * 1024);
  enorme.set([0x52, 0x49, 0x46, 0x46], 0);
  enorme.set([0x57, 0x45, 0x42, 0x50], 8);
  assert.throws(() => validarSubida(datos({ derivadas: new Map([[300, enorme]]) })), /tope/i);
});

test('RECHAZA dimensiones de origen invalidas', () => {
  for (const extra of [{ anchoOrigen: 0 }, { altoOrigen: -5 }, { anchoOrigen: 1.5 }]) {
    assert.throws(() => validarSubida(datos(extra)), /dimensi|origen/i);
  }
});

test('RECHAZA w600 si el origen no llega a 600', () => {
  // Es la regla de "nunca amplia" (SPEC.md §5.5) verificada del lado del servidor:
  // el cliente ya no deberia mandarla, pero el servidor no le cree.
  assert.throws(
    () =>
      validarSubida(
        datos({ anchoOrigen: 400, altoOrigen: 300, derivadas: new Map([[300, webp()], [600, webp()]]) })
      ),
    /600|amplia/i
  );
});

// --------------------------------------------------------------------------
// guardarImagen — el dedupe y la proteccion contra sobreescritura
// --------------------------------------------------------------------------

test('guarda las dos derivadas con la clave y el cache del contrato', async () => {
  const db = base();
  const balde = baldeFalso();

  const r = await guardarImagen({ ejecutar: ejecutor(db), balde }, datos(), { ahora: AHORA });

  assert.equal(r.reusada, false);
  assert.deepEqual([...balde.puestos.keys()].sort(), [
    `catalogo/${HASH}/w300.webp`,
    `catalogo/${HASH}/w600.webp`,
  ]);
  const opciones = balde.puestos.get(`catalogo/${HASH}/w300.webp`)!.opciones as {
    httpMetadata: { contentType: string; cacheControl: string };
  };
  assert.equal(opciones.httpMetadata.contentType, 'image/webp');
  assert.match(opciones.httpMetadata.cacheControl, /immutable/);
});

test('escribe la fila de imagenes con los anchos que subio', async () => {
  const db = base();
  await guardarImagen({ ejecutar: ejecutor(db), balde: baldeFalso() }, datos(), { ahora: AHORA });

  const fila = db.prepare(`SELECT * FROM imagenes WHERE hash16 = ?`).get(HASH) as Record<string, unknown>;
  assert.equal(fila.anchos, '[300,600]');
  assert.equal(fila.ancho_origen, 4000);
  assert.equal(fila.alto_origen, 3000);
  assert.equal(fila.bytes_origen, 2_400_000);
});

test('DEDUPE: un hash ya conocido no vuelve a subir nada', async () => {
  // SPEC §6.8: mismo contenido, misma clave, una sola subida.
  const db = base();
  const balde = baldeFalso();
  const deps = { ejecutar: ejecutor(db), balde };

  await guardarImagen(deps, datos(), { ahora: AHORA });
  balde.puestos.clear();

  const r = await guardarImagen(deps, datos(), { ahora: '2026-09-09T09:00:00Z' });

  assert.equal(r.reusada, true);
  assert.equal(balde.puestos.size, 0, 'no debe volver a escribir en R2');
});

test('NO SOBREESCRIBE: un hash conocido con OTRA foto conserva la original', async () => {
  // El caso peligroso. El hash lo calcula el navegador (§8.3): si manda uno
  // equivocado, sin esta guarda las fotos del producto dueño de ese hash se pisan y
  // no hay forma de recuperarlas. Se prefiere devolver la que ya estaba.
  const db = base();
  const balde = baldeFalso();
  const deps = { ejecutar: ejecutor(db), balde };

  await guardarImagen(deps, datos(), { ahora: AHORA });
  const original = balde.puestos.get(`catalogo/${HASH}/w300.webp`)!.bytes;

  const otra = webp(999);
  await guardarImagen(deps, datos({ derivadas: new Map([[300, otra]]) }), { ahora: AHORA });

  assert.equal(balde.puestos.get(`catalogo/${HASH}/w300.webp`)!.bytes, original);
});

test('el dedupe NO pisa los metadatos de origen de la fila existente', async () => {
  const db = base();
  const deps = { ejecutar: ejecutor(db), balde: baldeFalso() };

  await guardarImagen(deps, datos(), { ahora: AHORA });
  // Dimensiones distintas pero VALIDAS: si fueran menores a 600 la validacion las
  // rechazaria antes por las derivadas, y el test probaria otra cosa.
  await guardarImagen(deps, datos({ anchoOrigen: 800, altoOrigen: 600 }), { ahora: AHORA });

  const fila = db.prepare(`SELECT ancho_origen FROM imagenes WHERE hash16 = ?`).get(HASH) as {
    ancho_origen: number;
  };
  assert.equal(fila.ancho_origen, 4000, 'gana la primera, que es la que corresponde al hash');
});

test('una sola derivada tambien es valida: es el caso de 300-599 px', async () => {
  const db = base();
  const balde = baldeFalso();
  await guardarImagen(
    { ejecutar: ejecutor(db), balde },
    datos({ anchoOrigen: 400, altoOrigen: 400, derivadas: new Map([[300, webp()]]) }),
    { ahora: AHORA }
  );

  assert.deepEqual([...balde.puestos.keys()], [`catalogo/${HASH}/w300.webp`]);
  const fila = db.prepare(`SELECT anchos FROM imagenes WHERE hash16 = ?`).get(HASH) as {
    anchos: string;
  };
  assert.equal(fila.anchos, '[300]');
});

test('si R2 falla, NO queda la fila en la base', async () => {
  // Una fila sin sus objetos produce un <img> roto en el catalogo, que es
  // exactamente lo que SPEC.md §5.4 evita. Mejor no registrar nada.
  const db = base();
  const balde = {
    async put() {
      throw new Error('R2 caido');
    },
  };

  await assert.rejects(() =>
    guardarImagen({ ejecutar: ejecutor(db), balde }, datos(), { ahora: AHORA })
  );

  const cuantas = db.prepare(`SELECT COUNT(*) n FROM imagenes`).get() as { n: number };
  assert.equal(cuantas.n, 0);
});
