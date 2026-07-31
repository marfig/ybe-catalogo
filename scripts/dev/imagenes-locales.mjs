/**
 * Genera las derivadas de las muestras en public/img-dev/, con la MISMA
 * estructura de claves que R2 (SPEC §5.1).
 *
 * Existe para poder ver el sitio antes de tener R2 configurado. Cuando R2 este
 * listo, solo cambia PUBLIC_R2_BASE: ni un componente se toca.
 *
 * Reutiliza scripts/import/imagenes.mjs, el modulo real del importador, para no
 * tener dos pipelines de imagen que puedan divergir.
 *
 *   node scripts/dev/imagenes-locales.mjs
 */
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';

import { hash16, procesarImagen, claveR2 } from '../import/imagenes.mjs';

const ORIGEN = 'samples';
const DESTINO = 'public/img-dev';

const rutas = [];
for await (const r of glob(`${ORIGEN}/*.jpg`)) rutas.push(r);
rutas.sort();

if (rutas.length === 0) {
  console.error(`No se encontraron imagenes en ${ORIGEN}/`);
  process.exit(1);
}

await rm(DESTINO, { recursive: true, force: true });

const mapa = [];

for (const ruta of rutas) {
  const buffer = await readFile(ruta);
  const hash = hash16(buffer);
  const { suficiente, derivadas, origen, avisos } = await procesarImagen(buffer);

  for (const aviso of avisos) {
    console.warn(`  aviso  ${basename(ruta).slice(0, 12)}...  ${aviso}`);
  }

  if (!suficiente) continue;

  const claves = [];
  for (const [lado, bytes] of Object.entries(derivadas)) {
    const clave = claveR2(hash, lado);
    const salida = join(DESTINO, clave);
    await mkdir(dirname(salida), { recursive: true });
    await writeFile(salida, bytes);
    claves.push({ clave, bytes: bytes.length });
  }

  mapa.push({ archivo: basename(ruta), hash, origen, claves });
}

console.log(`\n${mapa.length} imagenes procesadas -> ${DESTINO}/\n`);
for (const m of mapa) {
  const pesos = m.claves.map((c) => `${c.clave.split('/').pop()} ${(c.bytes / 1024).toFixed(0)}kB`);
  console.log(`  ${m.hash}  ${m.origen.ancho}x${m.origen.alto}  ${pesos.join('  ')}  <- ${m.archivo.slice(0, 12)}...`);
}

const total = mapa.reduce((s, m) => s + m.claves.reduce((t, c) => t + c.bytes, 0), 0);
console.log(`\ntotal: ${(total / 1024).toFixed(0)} kB en ${mapa.reduce((s, m) => s + m.claves.length, 0)} archivos`);
