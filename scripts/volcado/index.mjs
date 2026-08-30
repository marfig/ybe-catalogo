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

import { construirPedidosEspeciales, construirProductos, serializar } from './construir.mjs';
import { consultarFilas, ejecutorD1, leerConfigD1 } from './consultar.mjs';
import { comparar, resumir } from './diferencias.mjs';
import { ejecutorWrangler } from './ejecutor-wrangler.mjs';

const SALIDA = 'src/data/productos.json';

/**
 * El segundo archivo que produce el volcado (SPEC.md 4.5).
 *
 * Va por la MISMA corrida y no por un script aparte: los dos salen de la misma base
 * y se comitean en el mismo commit de publicacion. Dos scripts serian dos Actions,
 * dos commits y una ventana en la que el sitio tiene una mitad nueva y otra vieja.
 */
const SALIDA_PEDIDOS = 'src/data/pedidos-especiales.json';

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

/** Lo que hay hoy en disco en `ruta`. `null` si es el primer volcado. */
async function archivoActual(ruta) {
  try {
    return JSON.parse(await readFile(ruta, 'utf8'));
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
    `${filas.pedidosEspeciales.length} pedidos especiales - ${filas.imagenes.length} imagenes · ${filas.categorias.length} vinculos de categoria`
);

const productos = construirProductos(filas);
const contenido = serializar(productos);

/**
 * Se compara el TEXTO y no las estructuras para decidir si escribir: es lo que
 * determina si git ve un cambio, que es el criterio de salida de §5.5.
 */
const anterior = await archivoActual(SALIDA);
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
    '  AVISO: ningun producto cambio pero el archivo si. Es forma, no contenido:\n' +
      '         orden canonico de productos por id, claves alfabeticas y formato de\n' +
      '         serializar(). El orden de las variantes NO se toca: sale de la columna\n' +
      '         `orden` de la base, que es curaduria.'
  );
}

/**
 * Los pedidos especiales, con el mismo criterio de escritura que el catalogo.
 *
 * SIN el reporte de altas y bajas de `comparar()`: son una decena de fichas curadas a
 * mano por la misma persona que acaba de apretar publicar, no 900 productos que
 * llegaron de un scrape. Un diff detallado le informaria de sus propios cambios.
 */
const pedidos = construirPedidosEspeciales(filas.pedidosEspeciales);
const contenidoPedidos = serializar(pedidos);

const pedidosPrevios = await archivoActual(SALIDA_PEDIDOS);
const cambioPedidos =
  (pedidosPrevios === null ? null : serializar(pedidosPrevios)) !== contenidoPedidos;

console.log(`  construido: ${pedidos.length} pedidos especiales`);

/**
 * SE DECIDE ARCHIVO POR ARCHIVO, y ningun `process.exit` puede colgarse en el medio.
 *
 * Antes el catalogo salia con `exit(0)` cuando no habia cambios. Con un segundo
 * archivo eso se vuelve un bug silencioso: una edicion de pedidos especiales sobre un
 * catalogo quieto no se escribiria nunca, y la publicacion diria que anduvo.
 */
const salidas = [
  { ruta: SALIDA, contenido, cambio },
  { ruta: SALIDA_PEDIDOS, contenido: contenidoPedidos, cambio: cambioPedidos },
];

console.log('');

if (ENSAYO) {
  for (const s of salidas) {
    console.log(`${s.ruta} ${s.cambio ? 'CAMBIARIA' : 'sin cambios'}. Ensayo: no se escribio.`);
  }
  process.exit(0);
}

for (const s of salidas) {
  if (!s.cambio) {
    // No se reescribe un archivo identico: mantiene la mtime y deja claro en el log
    // que la publicacion no genera un commit vacio.
    console.log(`${s.ruta} sin cambios. No se reescribe.`);
    continue;
  }
  await writeFile(s.ruta, s.contenido);
  console.log(`${s.ruta} actualizado (${s.contenido.length} bytes).`);
}
