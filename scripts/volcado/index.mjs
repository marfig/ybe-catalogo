/**
 * Volcado D1 -> src/data/productos.json (SPEC-etapa2 §5.5).
 *
 * La UNICA pieza del volcado con E/S. Todo lo demas es puro:
 *
 *   consultar.mjs     el SQL y el ejecutor HTTP
 *   construir.mjs     filas -> estructura de SPEC §4.4, y la serializacion
 *   diferencias.mjs   el reporte de que cambio
 *
 *   node scripts/volcado/index.mjs --dry-run   # no escribe, solo dice que cambiaria
 *   node scripts/volcado/index.mjs
 *
 * ELECCION DE TRANSPORTE. Con las tres variables de D1 en el entorno usa la API
 * HTTP, que es lo que corre en la GitHub Action. Sin ellas cae a wrangler, que en
 * una maquina ya esta autenticado. Es deliberado: sin ese fallback el volcado no se
 * podria correr ni verificar en local sin montar secrets, y una pieza que solo se
 * ejecuta en CI es una pieza que se depura a ciegas.
 */
import { readFile, writeFile } from 'node:fs/promises';

import { construirProductos, serializar } from './construir.mjs';
import { consultarFilas, ejecutorD1, leerConfigD1 } from './consultar.mjs';
import { comparar, resumir } from './diferencias.mjs';
import { ejecutorWrangler } from './ejecutor-wrangler.mjs';

const SALIDA = 'src/data/productos.json';
const BASE = 'ybe-catalogo';
const CONFIG_D1 = 'db/wrangler.jsonc';

const ENSAYO = process.argv.includes('--dry-run');

/** Devuelve el ejecutor y el nombre del transporte, para poder decirlo en el log. */
function elegirTransporte(env) {
  const completas = ['CLOUDFLARE_ACCOUNT_ID', 'D1_DATABASE_ID', 'CLOUDFLARE_API_TOKEN'].every(
    (k) => (env[k] ?? '').trim() !== ''
  );

  if (completas) {
    return { nombre: 'API HTTP de D1', ejecutar: ejecutorD1(leerConfigD1(env)) };
  }
  return {
    nombre: 'wrangler (sesion local)',
    ejecutar: ejecutorWrangler({ base: BASE, config: CONFIG_D1 }),
  };
}

/** El catalogo que hay hoy en disco. `null` si es el primer volcado. */
async function catalogoActual() {
  try {
    return JSON.parse(await readFile(SALIDA, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

const { nombre, ejecutar } = elegirTransporte(process.env);
console.log(`Volcando desde D1 via ${nombre}${ENSAYO ? ' (ENSAYO: no se escribe)' : ''}\n`);

const filas = await consultarFilas(ejecutar);
console.log(
  `  leido: ${filas.productos.length} productos · ${filas.variantes.length} variantes · ` +
    `${filas.imagenes.length} imagenes · ${filas.categorias.length} vinculos de categoria`
);

const productos = construirProductos(filas);
const contenido = serializar(productos);

/**
 * Se compara el TEXTO y no las estructuras para decidir si escribir: es lo que
 * determina si git ve un cambio, que es el criterio de salida de §5.5.
 */
const anterior = await catalogoActual();
const anteriorTexto = anterior === null ? null : serializar(anterior);
const cambio = anteriorTexto !== contenido;

const diff = comparar(anterior, productos);
console.log(`  construido: ${productos.length} productos publicables`);
console.log(`  cambios: ${resumir(diff)}`);

for (const id of diff.altas) console.log(`    + ${id}`);
// Una baja deja la URL de un producto publicado en 404, asi que se marca distinto.
for (const id of diff.bajas) console.log(`    - ${id}  (su URL queda en 404)`);
for (const id of diff.modificados) console.log(`    ~ ${id}`);

/**
 * El reordenamiento puro merece su propio aviso: `git diff` va a mostrar medio
 * archivo movido sin que ningun producto haya cambiado, y sin esta linea eso se
 * lee como un volcado sospechoso.
 */
if (cambio && diff.altas.length === 0 && diff.bajas.length === 0 && diff.modificados.length === 0) {
  console.log(
    '  AVISO: ningun producto cambio pero el archivo si. Es reordenamiento al orden\n' +
      '         canonico (productos por id, variantes por color). Ojo que variantes[0]\n' +
      '         es la variante activa en el HTML inicial.'
  );
}

if (ENSAYO) {
  console.log(`\n${cambio ? `${SALIDA} CAMBIARIA` : `${SALIDA} sin cambios`}. Ensayo: no se escribio.`);
  process.exit(0);
}

if (!cambio) {
  // No se reescribe un archivo identico: mantiene la mtime y deja claro en el log
  // que la publicacion no genera un commit vacio (SPEC §6.5).
  console.log(`\n${SALIDA} sin cambios. No se reescribe.`);
  process.exit(0);
}

await writeFile(SALIDA, contenido);
console.log(`\n${SALIDA} actualizado (${contenido.length} bytes).`);
