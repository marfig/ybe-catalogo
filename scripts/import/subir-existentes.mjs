/**
 * Fase 2.1 — sube a R2 las imagenes que el sitio ya tiene hoy.
 *
 * Es un relleno de una sola vez: cierra el pendiente de que las derivadas vivan
 * en `public/img-dev/`. El importador de la fase 2.5 va a hacer esto mismo como
 * parte de su pipeline, reusando `r2.mjs` — de ahi que la logica de subida NO
 * este aca.
 *
 * Regenera las derivadas desde `samples/` en vez de leer `public/img-dev/`: es
 * el mismo pipeline que el importador (`imagenes.mjs`), asi que lo que se sube
 * es exactamente lo que produciria una importacion. Copiar los archivos ya
 * generados funcionaria igual, pero dejaria sin verificar que las claves
 * coinciden, que es justo la premisa de toda la fase.
 *
 *   node --env-file=.env scripts/import/subir-existentes.mjs --dry-run
 *   node --env-file=.env scripts/import/subir-existentes.mjs
 */
import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import { basename } from 'node:path';

import { hash16, procesarImagen, claveR2 } from './imagenes.mjs';
import { CACHE_CONTROL, clienteR2, leerConfigR2, subirSiFalta } from './r2.mjs';

const ORIGEN = 'samples';
const ENSAYO = process.argv.includes('--dry-run');

const rutas = [];
for await (const r of glob(`${ORIGEN}/*.jpg`)) rutas.push(r);
rutas.sort();

if (rutas.length === 0) {
  console.error(`No se encontraron imagenes en ${ORIGEN}/`);
  process.exit(1);
}

/**
 * En ensayo NO se pide config: el objetivo es poder ver el plan sin tener el
 * token todavia. Con credenciales se valida antes de procesar un solo byte, para
 * no descubrir a la mitad que falta una variable.
 */
const config = ENSAYO ? null : leerConfigR2(process.env);
const cliente = config ? clienteR2(config) : null;

if (ENSAYO) {
  console.log('ENSAYO (--dry-run): no se escribe nada en R2.\n');
} else {
  console.log(`Subiendo a r2://${config.bucket}  ·  Cache-Control: ${CACHE_CONTROL}\n`);
}

let subidas = 0;
let existentes = 0;
let bytesSubidos = 0;
const omitidas = [];

for (const ruta of rutas) {
  const corto = basename(ruta).slice(0, 12);
  const buffer = await readFile(ruta);
  const hash = hash16(buffer);
  const { suficiente, derivadas, origen, avisos } = await procesarImagen(buffer);

  for (const aviso of avisos) console.warn(`  aviso  ${corto}...  ${aviso}`);

  if (!suficiente) {
    omitidas.push(corto);
    continue;
  }

  for (const [lado, bytes] of Object.entries(derivadas)) {
    const clave = claveR2(hash, lado);
    const kb = `${(bytes.length / 1024).toFixed(0)}kB`;

    if (ENSAYO) {
      console.log(`  plan   ${clave}  ${kb}  (${origen.ancho}x${origen.alto} <- ${corto}...)`);
      subidas++;
      bytesSubidos += bytes.length;
      continue;
    }

    if (await subirSiFalta(cliente, config.bucket, clave, bytes)) {
      console.log(`  subida ${clave}  ${kb}`);
      subidas++;
      bytesSubidos += bytes.length;
    } else {
      console.log(`  ya     ${clave}`);
      existentes++;
    }
  }
}

const verbo = ENSAYO ? 'se subirian' : 'subidas';
console.log(
  `\n${subidas} ${verbo} (${(bytesSubidos / 1024).toFixed(0)} kB)` +
    (existentes > 0 ? `, ${existentes} ya estaban` : '') +
    (omitidas.length > 0 ? `, ${omitidas.length} omitidas por resolucion` : '')
);

if (ENSAYO) {
  console.log('\nPara subir de verdad, correr sin --dry-run.');
}
