/**
 * Emite el guion de SQL que carga en D1 el catalogo de `src/data/productos.json`.
 *
 * Migracion de una sola vez (fase 2.2). Emite SQL en vez de escribir en la base
 * directo, a proposito: el guion se puede leer y revisar antes de aplicarlo, y
 * queda como artefacto de lo que se cargo. Para una migracion de datos que se hace
 * una vez, eso vale mas que la comodidad.
 *
 *   node scripts/volcado/sembrar.mjs > siembra.sql
 *   npx wrangler d1 execute ybe-catalogo --remote --config db/wrangler.jsonc --file siembra.sql
 *
 * `--limpiar` emite los DELETE en orden inverso de dependencia, para reintentar
 * desde cero si algo quedo a medias.
 *
 * Los metadatos de origen de cada imagen NO estan en el JSON — describen el archivo
 * original, no la derivada — asi que se miden sobre `samples/` cruzando por hash16.
 */
import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import sharp from 'sharp';

import { hash16 } from '../import/imagenes.mjs';
import { TABLAS_SEMBRADAS, aFilas, comoGuionSql, sentencias } from './desde-json.mjs';

const CATALOGO = 'src/data/productos.json';
const ORIGEN = 'samples';

if (process.argv.includes('--limpiar')) {
  console.log('-- Limpia lo sembrado, en orden inverso de dependencia.');
  for (const tabla of TABLAS_SEMBRADAS) console.log(`DELETE FROM ${tabla};`);
  process.exit(0);
}

/** Mide los archivos de origen: hash16 -> { ancho, alto, bytes }. */
async function medirOrigen() {
  const metadatos = new Map();
  for await (const ruta of glob(`${ORIGEN}/*.jpg`)) {
    const buffer = await readFile(ruta);
    const meta = await sharp(buffer).metadata();
    metadatos.set(hash16(buffer), {
      ancho: meta.width,
      alto: meta.height,
      bytes: buffer.length,
    });
  }
  return metadatos;
}

const catalogo = JSON.parse(await readFile(CATALOGO, 'utf8'));
const metadatos = await medirOrigen();

// La fecha solo se usa si un producto no trae `actualizado`; hoy todos lo traen.
const hoy = new Date().toISOString().slice(0, 10);
const filas = aFilas(catalogo, metadatos, { ahora: hoy });
const lista = sentencias(filas);

console.log(`-- Siembra de D1 desde ${CATALOGO} (SPEC-etapa2 fase 2.2).`);
console.log(`-- ${filas.productos.length} productos · ${filas.variantes.length} variantes · ${filas.imagenes.length} imagenes`);
console.log(`-- ${filas.categorias.length} vinculos de categoria · ${filas.varianteImagenes.length} vinculos de imagen`);
console.log('--');
console.log('-- Generado por scripts/volcado/sembrar.mjs. No editar a mano.');
console.log('-- Para reintentar desde cero: node scripts/volcado/sembrar.mjs --limpiar');
console.log('');
console.log(comoGuionSql(lista));
