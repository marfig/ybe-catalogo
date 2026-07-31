import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import sharp from 'sharp';

import { hash16, procesarImagen, TAMANOS } from '../imagenes.mjs';

const MUESTRAS = 'samples';

async function muestras() {
  const rutas = [];
  for await (const r of glob(`${MUESTRAS}/*.jpg`)) rutas.push(r);
  return rutas.sort();
}

/** Imagen sintetica de color plano, para los casos que las muestras no cubren. */
function sintetica(ancho, alto, color = { r: 200, g: 60, b: 60 }) {
  return sharp({ create: { width: ancho, height: alto, channels: 3, background: color } })
    .jpeg()
    .toBuffer();
}

// --------------------------------------------------------------------------
// hash16 — clave de deduplicacion (SPEC §6.8)
// --------------------------------------------------------------------------

test('hash16: 16 hex y determinista', async () => {
  const buf = await readFile((await muestras())[0]);
  const h = hash16(buf);
  assert.match(h, /^[0-9a-f]{16}$/);
  assert.equal(h, hash16(buf), 'el mismo contenido debe dar el mismo hash');
});

test('hash16: contenido distinto da hash distinto', async () => {
  const [a, b] = await muestras();
  assert.notEqual(hash16(await readFile(a)), hash16(await readFile(b)));
});

test('hash16: NO depende del nombre de archivo', async () => {
  // Los nombres del origen son IDs opacos, no hashes de contenido (SPEC §2.2-7).
  // Copiar un archivo con otro nombre debe dar el mismo hash.
  const buf = await readFile((await muestras())[0]);
  const copia = Buffer.from(buf);
  assert.equal(hash16(buf), hash16(copia));
});

// --------------------------------------------------------------------------
// procesarImagen — las 7 muestras reales (SPEC §2.2)
// --------------------------------------------------------------------------

test('las 7 muestras producen w300 y w600 cuadrados exactos', async () => {
  const rutas = await muestras();
  assert.equal(rutas.length, 7, 'se esperan 7 muestras');

  for (const ruta of rutas) {
    const r = await procesarImagen(await readFile(ruta));
    assert.equal(r.suficiente, true, `${ruta} deberia alcanzar`);
    assert.deepEqual(Object.keys(r.derivadas).map(Number).sort((a, b) => a - b), [300, 600]);

    for (const lado of TAMANOS) {
      const m = await sharp(r.derivadas[lado]).metadata();
      assert.equal(m.width, lado, `${ruta} w${lado}: ancho`);
      assert.equal(m.height, lado, `${ruta} w${lado}: alto`);
      assert.equal(m.format, 'webp', `${ruta} w${lado}: formato`);
    }
  }
});

test('la muestra de 601x600 sale 600x600 sin recorte', async () => {
  const ruta = (await muestras()).find((r) => r.includes('11fe5e4a4c'));
  const original = await sharp(await readFile(ruta)).metadata();
  assert.equal(original.width, 601, 'fixture: debe ser la de 601 px');
  assert.equal(original.height, 600);

  const r = await procesarImagen(await readFile(ruta));
  const m = await sharp(r.derivadas[600]).metadata();
  assert.equal(m.width, 600);
  assert.equal(m.height, 600);
});

// --------------------------------------------------------------------------
// Nunca recortar: origen no cuadrado se rellena (SPEC §5.3, §6.10)
// --------------------------------------------------------------------------

test('origen 300x600 se rellena con blanco, no se recorta', async () => {
  const r = await procesarImagen(await sintetica(300, 600));
  const salida = sharp(r.derivadas[600]);
  const m = await salida.metadata();
  assert.equal(m.width, 600);
  assert.equal(m.height, 600);

  // El centro conserva el color original; los bordes laterales son el relleno.
  const { data, info } = await salida.raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => {
    const o = (y * info.width + x) * info.channels;
    return [data[o], data[o + 1], data[o + 2]];
  };
  const [cr, cg, cb] = px(300, 300);
  assert.ok(cr > 150 && cg < 110 && cb < 110, `centro deberia ser el color original, fue ${cr},${cg},${cb}`);

  const [br, bg, bb] = px(5, 300);
  assert.ok(br > 245 && bg > 245 && bb > 245, `relleno deberia ser blanco, fue ${br},${bg},${bb}`);
});

test('origen 600x200 muy ancho se rellena arriba y abajo', async () => {
  const r = await procesarImagen(await sintetica(600, 200));
  const m = await sharp(r.derivadas[600]).metadata();
  assert.equal(m.width, 600);
  assert.equal(m.height, 600);
});

// --------------------------------------------------------------------------
// Nunca ampliar (SPEC §5.5)
// --------------------------------------------------------------------------

test('origen 450x450 genera solo w300', async () => {
  const r = await procesarImagen(await sintetica(450, 450));
  assert.equal(r.suficiente, true);
  assert.deepEqual(Object.keys(r.derivadas).map(Number), [300]);
  assert.ok(
    r.avisos.some((a) => a.includes('600')),
    `deberia avisar que no se genero w600, avisos: ${JSON.stringify(r.avisos)}`
  );
});

test('origen menor a 300 px no genera nada y marca insuficiente', async () => {
  const r = await procesarImagen(await sintetica(220, 220));
  assert.equal(r.suficiente, false, 'debe marcarse insuficiente');
  assert.deepEqual(r.derivadas, {}, 'no debe generar ningun tamano');
  assert.ok(r.avisos.length > 0, 'debe avisar');
});

test('nunca amplia: w300 de un origen 320px sigue siendo 300 y no 320', async () => {
  const r = await procesarImagen(await sintetica(320, 320));
  const m = await sharp(r.derivadas[300]).metadata();
  assert.equal(m.width, 300);
  assert.equal(m.height, 300);
});

// --------------------------------------------------------------------------
// Determinismo — precondicion de la idempotencia (SPEC §6.7)
// --------------------------------------------------------------------------

test('procesar dos veces el mismo origen da bytes identicos', async () => {
  const buf = await readFile((await muestras())[0]);
  const a = await procesarImagen(buf);
  const b = await procesarImagen(buf);
  for (const lado of TAMANOS) {
    assert.ok(a.derivadas[lado].equals(b.derivadas[lado]), `w${lado} deberia ser byte-identico`);
  }
});

// --------------------------------------------------------------------------
// Metadatos reportados
// --------------------------------------------------------------------------

test('reporta las dimensiones del origen para el reporte', async () => {
  const ruta = (await muestras()).find((r) => r.includes('11fe5e4a4c'));
  const r = await procesarImagen(await readFile(ruta));
  assert.equal(r.origen.ancho, 601);
  assert.equal(r.origen.alto, 600);
});
