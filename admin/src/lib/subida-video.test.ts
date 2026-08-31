import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { Ejecutar } from './grilla.ts';
import {
  MAXIMO_BYTES,
  asignarVideo,
  datosDesdeFormularioVideo,
  esMp4,
  guardarVideo,
  quitarVideo,
  validarVideo,
} from './subida-video.ts';

/**
 * Tests de la subida de video.
 *
 * Hereda el riesgo que define a `subida.ts` —el hash lo calcula el NAVEGADOR y con él
 * se arma la clave de R2— así que hereda sus dos defensas: se valida el formato del
 * hash y NUNCA se sobreescribe una clave existente.
 *
 * Y suma una propia: acá no hay derivadas que generar, así que el archivo entra tal
 * cual lo eligió la persona. Es el único punto del sistema donde bytes que nadie
 * procesó terminan en un bucket público.
 */

const CARPETA = new URL('../../../db/migrations/', import.meta.url);
const MIGRACIONES = readdirSync(CARPETA)
  .filter((n) => n.endsWith('.sql'))
  .sort()
  .map((n) => readFileSync(new URL(n, CARPETA), 'utf8'));

const AHORA = '2026-08-31T12:00:00Z';
const HASH = 'a1b2c3d4e5f60718';

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

/** Bytes con la firma real de un MP4: `ftyp` en el byte 4, precedido del tamaño de caja. */
function mp4(relleno = 64): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(new ArrayBuffer(12 + relleno));
  b.set([0x00, 0x00, 0x00, 0x20], 0); // tamaño de la caja
  b.set([0x66, 0x74, 0x79, 0x70], 4); // ftyp
  b.set([0x69, 0x73, 0x6f, 0x6d], 8); // isom
  return b;
}

/** Bytes con la firma de un WebP, que es lo que tiene que ser el poster. */
function webp(relleno = 32): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(new ArrayBuffer(12 + relleno));
  b.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  b.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  return b;
}

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
  ancho: 720,
  alto: 1280,
  video: mp4(),
  poster: webp(),
  ...extra,
});

function producto(db: DatabaseSync, codigo = 'CG85527'): number {
  return (
    db
      .prepare(
        `INSERT INTO productos (codigo, proveedor, slug, nombre, estado, creado_en, actualizado_en)
         VALUES (?, 'chenson', ?, 'Cartera', 'publicado', ?, ?) RETURNING id`
      )
      .get(codigo, codigo.toLowerCase(), AHORA, AHORA) as { id: number }
  ).id;
}

// --------------------------------------------------------------------------
// Los magic bytes
// --------------------------------------------------------------------------

test('esMp4 reconoce ftyp en el byte 4, no en el 0', () => {
  // Un MP4 no empieza con su firma: los primeros cuatro bytes son el TAMAÑO de la
  // primera caja. Mirar el byte 0 rechazaría todos los MP4 del mundo.
  assert.equal(esMp4(mp4()), true);
});

test('esMp4 rechaza lo que no es MP4', () => {
  // Un WebP renombrado a .mp4 es el caso realista: la extensión no prueba nada.
  assert.equal(esMp4(webp()), false);
  assert.equal(esMp4(new Uint8Array(new ArrayBuffer(4))), false, 'demasiado corto');
  assert.equal(esMp4(new Uint8Array(new ArrayBuffer(0))), false, 'vacío');
});

// --------------------------------------------------------------------------
// La validación
// --------------------------------------------------------------------------

test('validarVideo acepta lo que corresponde', () => {
  assert.doesNotThrow(() => validarVideo(datos()));
});

test('validarVideo rechaza un hash que no es 16 hex en minúscula', () => {
  // Con este valor se arma la clave de R2. Un hash con barras escribiría fuera del
  // prefijo `videos/`, que es el mismo riesgo que defiende `subida.ts`.
  for (const malo of ['../otro', HASH.toUpperCase(), 'abc', `${HASH}/x`, '']) {
    assert.throws(() => validarVideo(datos({ hash16: malo })), /hash16 inválido/i, malo);
  }
});

test('validarVideo rechaza un video que pasa el tope de 10 MB', () => {
  // El tope no es una limitación: es el que obliga a pasar el archivo por WhatsApp,
  // que es el compresor que la persona ya usa todos los días.
  const enorme = new Uint8Array(new ArrayBuffer(MAXIMO_BYTES + 1));
  enorme.set([0x00, 0x00, 0x00, 0x20], 0);
  enorme.set([0x66, 0x74, 0x79, 0x70], 4);
  assert.throws(() => validarVideo(datos({ video: enorme })), /10 MB|WhatsApp/i);
});

test('el mensaje del tope enseña el camino, no sólo niega', () => {
  // Un «archivo demasiado grande» deja a la persona sin saber qué hacer. El compresor
  // que necesita ya lo tiene en el teléfono.
  const enorme = new Uint8Array(new ArrayBuffer(MAXIMO_BYTES + 1));
  enorme.set([0x66, 0x74, 0x79, 0x70], 4);
  assert.throws(() => validarVideo(datos({ video: enorme })), /WhatsApp/i);
});

test('validarVideo rechaza un video vacío', () => {
  assert.throws(() => validarVideo(datos({ video: new Uint8Array(new ArrayBuffer(0)) })), /vacío|MP4/i);
});

test('validarVideo rechaza lo que no es un MP4', () => {
  assert.throws(() => validarVideo(datos({ video: webp(9000) })), /MP4/i);
});

test('validarVideo rechaza un poster que no es WebP', () => {
  // Se sirve con `Content-Type: image/webp` desde una URL pública.
  assert.throws(() => validarVideo(datos({ poster: mp4() })), /poster.*WebP/i);
});

test('validarVideo rechaza dimensiones que no son enteros positivos', () => {
  for (const campo of ['ancho', 'alto']) {
    for (const malo of [0, -1, 1.5, Number.NaN]) {
      assert.throws(
        () => validarVideo(datos({ [campo]: malo })),
        /dimensiones/i,
        `${campo}=${malo}`
      );
    }
  }
});

// --------------------------------------------------------------------------
// Guardar: R2 y la fila
// --------------------------------------------------------------------------

test('guardarVideo sube el video y su poster bajo el prefijo videos/', async () => {
  const db = base();
  const balde = baldeFalso();

  const r = await guardarVideo({ ejecutar: ejecutor(db), balde }, datos(), { ahora: AHORA });

  assert.equal(r.reusado, false);
  assert.deepEqual(
    [...balde.puestos.keys()].sort(),
    [`videos/${HASH}/poster.webp`, `videos/${HASH}/video.mp4`]
  );
});

test('guardarVideo sirve cada objeto con su propio content-type', async () => {
  const db = base();
  const balde = baldeFalso();

  await guardarVideo({ ejecutar: ejecutor(db), balde }, datos(), { ahora: AHORA });

  const tipo = (clave: string) =>
    (balde.puestos.get(clave)!.opciones as { httpMetadata: { contentType: string } }).httpMetadata
      .contentType;
  assert.equal(tipo(`videos/${HASH}/video.mp4`), 'video/mp4');
  assert.equal(tipo(`videos/${HASH}/poster.webp`), 'image/webp');
});

test('guardarVideo registra la fila con sus dimensiones y su peso', async () => {
  const db = base();
  const bytes = mp4(500);

  await guardarVideo({ ejecutar: ejecutor(db), balde: baldeFalso() }, datos({ video: bytes }), {
    ahora: AHORA,
  });

  const fila = db.prepare(`SELECT * FROM videos WHERE hash16 = ?`).get(HASH) as Record<
    string,
    unknown
  >;
  assert.equal(fila.ancho, 720);
  assert.equal(fila.alto, 1280);
  assert.equal(fila.bytes, bytes.length, 'el peso es el del archivo, no el declarado');
  assert.equal(fila.creado_en, AHORA);
});

test('guardarVideo NO pisa un hash que ya existe', async () => {
  /**
   * La defensa central, heredada de `subida.ts`: el hash lo calcula el navegador. Un
   * bug del cliente que devuelva un hash ajeno tiene que devolver el video que ya
   * estaba, no destruirlo. El peor caso pasa de «perdiste un archivo» a «te devolvió
   * otro», que es recuperable.
   */
  const db = base();
  const balde = baldeFalso();
  await guardarVideo({ ejecutar: ejecutor(db), balde }, datos(), { ahora: AHORA });
  balde.puestos.clear();

  const r = await guardarVideo({ ejecutar: ejecutor(db), balde }, datos({ ancho: 99 }), {
    ahora: '2027-01-01T00:00:00Z',
  });

  assert.equal(r.reusado, true);
  assert.equal(balde.puestos.size, 0, 'no se escribió nada en R2');
  const fila = db.prepare(`SELECT ancho FROM videos WHERE hash16 = ?`).get(HASH) as {
    ancho: number;
  };
  assert.equal(fila.ancho, 720, 'gana la primera fila');
  assert.equal(
    (db.prepare(`SELECT COUNT(*) c FROM videos`).get() as { c: number }).c,
    1
  );
});

test('guardarVideo valida ANTES de tocar R2 o la base', async () => {
  const db = base();
  const balde = baldeFalso();

  await assert.rejects(
    () => guardarVideo({ ejecutar: ejecutor(db), balde }, datos({ hash16: '../x' }), { ahora: AHORA }),
    /hash16 inválido/i
  );

  assert.equal(balde.puestos.size, 0);
  assert.equal((db.prepare(`SELECT COUNT(*) c FROM videos`).get() as { c: number }).c, 0);
});

test('guardarVideo escribe R2 antes que la fila', async () => {
  /**
   * Mismo orden que las imágenes y por el mismo motivo: una fila sin su objeto es un
   * <video> roto en el catálogo. Al revés, un objeto sin fila es basura invisible que
   * la recolección de huérfanas se lleva. De los dos desórdenes, se elige el que no
   * se ve.
   */
  const db = base();
  const balde = {
    async put() {
      throw new Error('R2 caído');
    },
  };

  await assert.rejects(
    () => guardarVideo({ ejecutar: ejecutor(db), balde }, datos(), { ahora: AHORA }),
    /R2 caído/
  );
  assert.equal(
    (db.prepare(`SELECT COUNT(*) c FROM videos`).get() as { c: number }).c,
    0,
    'sin objeto no hay fila'
  );
});

// --------------------------------------------------------------------------
// Colgar el video del producto, y descolgarlo
// --------------------------------------------------------------------------

test('asignarVideo cuelga el video del producto', async () => {
  const db = base();
  const ejecutar = ejecutor(db);
  const id = producto(db);
  await guardarVideo({ ejecutar, balde: baldeFalso() }, datos(), { ahora: AHORA });

  await asignarVideo(ejecutar, { productoId: id, hash16: HASH, ahora: AHORA });

  const fila = db.prepare(`SELECT video_id FROM productos WHERE id = ?`).get(id) as {
    video_id: number | null;
  };
  assert.notEqual(fila.video_id, null);
});

test('asignarVideo con un hash que no existe falla y no toca el producto', async () => {
  const db = base();
  const ejecutar = ejecutor(db);
  const id = producto(db);

  await assert.rejects(
    () => asignarVideo(ejecutar, { productoId: id, hash16: HASH, ahora: AHORA }),
    /no existe/i
  );

  const fila = db.prepare(`SELECT video_id FROM productos WHERE id = ?`).get(id) as {
    video_id: number | null;
  };
  assert.equal(fila.video_id, null);
});

test('asignarVideo reemplaza el video anterior', async () => {
  // Cambiar el video es un UPDATE. El anterior queda huérfano y se lo lleva la
  // recolección, que es exactamente para lo que existe.
  const db = base();
  const ejecutar = ejecutor(db);
  const id = producto(db);
  const otro = 'ffffffffffffffff';
  await guardarVideo({ ejecutar, balde: baldeFalso() }, datos(), { ahora: AHORA });
  await guardarVideo({ ejecutar, balde: baldeFalso() }, datos({ hash16: otro }), { ahora: AHORA });

  await asignarVideo(ejecutar, { productoId: id, hash16: HASH, ahora: AHORA });
  await asignarVideo(ejecutar, { productoId: id, hash16: otro, ahora: AHORA });

  const fila = db
    .prepare(`SELECT v.hash16 FROM productos p JOIN videos v ON v.id = p.video_id WHERE p.id = ?`)
    .get(id) as { hash16: string };
  assert.equal(fila.hash16, otro);
});

test('asignarVideo mueve la fecha de actualización', async () => {
  // El volcado y la grilla ordenan por ella: un cambio que no la mueve es un cambio
  // que el resto del sistema no ve.
  const db = base();
  const ejecutar = ejecutor(db);
  const id = producto(db);
  await guardarVideo({ ejecutar, balde: baldeFalso() }, datos(), { ahora: AHORA });

  const despues = '2026-09-01T10:00:00Z';
  await asignarVideo(ejecutar, { productoId: id, hash16: HASH, ahora: despues });

  const fila = db.prepare(`SELECT actualizado_en FROM productos WHERE id = ?`).get(id) as {
    actualizado_en: string;
  };
  assert.equal(fila.actualizado_en, despues);
});

test('quitarVideo descuelga sin borrar la fila ni el objeto', async () => {
  /**
   * Deja el video huérfano A PROPÓSITO. Borrarlo acá sería destruir el archivo en el
   * mismo clic con el que alguien lo saca de la ficha, sin confirmación y sin vuelta
   * atrás. La papelera es la que decide cuándo se borra de verdad.
   */
  const db = base();
  const ejecutar = ejecutor(db);
  const id = producto(db);
  await guardarVideo({ ejecutar, balde: baldeFalso() }, datos(), { ahora: AHORA });
  await asignarVideo(ejecutar, { productoId: id, hash16: HASH, ahora: AHORA });

  await quitarVideo(ejecutar, { productoId: id, ahora: AHORA });

  const fila = db.prepare(`SELECT video_id FROM productos WHERE id = ?`).get(id) as {
    video_id: number | null;
  };
  assert.equal(fila.video_id, null);
  assert.equal((db.prepare(`SELECT COUNT(*) c FROM videos`).get() as { c: number }).c, 1);
});

// --------------------------------------------------------------------------
// El borde: lo que llega del navegador
// --------------------------------------------------------------------------

function formulario(campos: Record<string, unknown> = {}): FormData {
  const form = new FormData();
  const base: Record<string, unknown> = {
    codigo: 'CG85527',
    hash16: HASH,
    ancho: '720',
    alto: '1280',
    video: new Blob([mp4()], { type: 'video/mp4' }),
    poster: new Blob([webp()], { type: 'image/webp' }),
    ...campos,
  };
  for (const [clave, valor] of Object.entries(base)) {
    if (valor === undefined) continue;
    form.set(clave, valor as string | Blob);
  }
  return form;
}

test('datosDesdeFormulario arma los datos y conserva el codigo', async () => {
  const d = await datosDesdeFormularioVideo(formulario());
  assert.equal(d.codigo, 'CG85527');
  assert.equal(d.hash16, HASH);
  assert.equal(d.ancho, 720);
  assert.equal(d.alto, 1280);
  assert.equal(esMp4(d.video), true);
});

test('datosDesdeFormulario corta un campo que falta', async () => {
  for (const clave of ['codigo', 'hash16', 'ancho', 'alto']) {
    await assert.rejects(
      () => datosDesdeFormularioVideo(formulario({ [clave]: undefined })),
      new RegExp(`Falta el campo ${clave}`),
      clave
    );
  }
});

test('datosDesdeFormulario corta un numero que no es numero', async () => {
  // `Number('')` es 0 y `Number('x')` es NaN: los dos tienen que cortar acá y no
  // llegar como 0 a la base.
  for (const malo of ['x', '']) {
    await assert.rejects(
      () => datosDesdeFormularioVideo(formulario({ ancho: malo })),
      /Falta el campo ancho|no es un número/,
      JSON.stringify(malo)
    );
  }
});

test('datosDesdeFormulario corta si el video o el poster no son archivos', async () => {
  await assert.rejects(
    () => datosDesdeFormularioVideo(formulario({ video: 'no soy un archivo' })),
    /video no es un archivo/i
  );
  await assert.rejects(
    () => datosDesdeFormularioVideo(formulario({ poster: 'no soy un archivo' })),
    /poster no es un archivo/i
  );
});
