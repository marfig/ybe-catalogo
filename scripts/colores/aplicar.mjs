/**
 * CLI de `repartir.mjs`: lee el mapeo de un archivo y lo aplica a D1.
 *
 * SEPARADO DE LA LOGICA a proposito, igual que `volcado/index.mjs` lo esta de
 * `construir.mjs`: la parte que decide QUE escribir se prueba sin base y sin red; acá
 * queda sólo la E/S y la eleccion de contra que base se corre.
 *
 * POR DEFECTO VA A LOCAL. Al reves que el volcado, que lee de remoto para publicar.
 * Esto ESCRIBE y borra variantes, asi que tocar produccion tiene que ser explicito:
 * quien se olvida la bandera se equivoca del lado barato.
 *
 * Uso:
 *   node --experimental-strip-types scripts/colores/aplicar.mjs mapeo.json --dry-run
 *   node --experimental-strip-types scripts/colores/aplicar.mjs mapeo.json
 *   node --experimental-strip-types scripts/colores/aplicar.mjs mapeo.json --remote
 */
import { readFile } from 'node:fs/promises';

import { ejecutorWrangler } from '../volcado/ejecutor-wrangler.mjs';
import { repartirColores } from './repartir.mjs';

const BASE = 'ybe-catalogo';
const CONFIG_D1 = 'db/wrangler.jsonc';

const args = process.argv.slice(2);
const ruta = args.find((a) => !a.startsWith('--'));
const ENSAYO = args.includes('--dry-run');
const REMOTO = args.includes('--remote');

if (!ruta) {
  console.error('Falta el archivo con el mapeo.\n  node scripts/colores/aplicar.mjs mapeo.json --dry-run');
  process.exit(1);
}

const mapeo = JSON.parse(await readFile(ruta, 'utf8'));
const ejecutar = ejecutorWrangler({ base: BASE, config: CONFIG_D1, local: !REMOTO });

const donde = REMOTO ? 'PRODUCCION' : 'la D1 local';
console.log(`Repartiendo ${mapeo.length} producto(s) en ${donde}${ENSAYO ? ' (ENSAYO: no se escribe)' : ''}\n`);

const informe = await repartirColores(ejecutar, mapeo, {
  ahora: new Date().toISOString(),
  ensayo: ENSAYO,
});

for (const p of informe) {
  console.log(`${p.codigo}  —  se quita «${p.quitada}»`);
  for (const v of p.variantes) {
    console.log(`    ${v.color.padEnd(14)} ${v.sku.padEnd(20)} ${v.fotos} foto(s)`);
  }
  if (p.sinAsignar.length > 0) {
    /**
     * Ruidoso a proposito. Una foto sin asignar queda SIN NINGUN vinculo, y la
     * recoleccion de huerfanas no la ve: esa consulta arranca desde
     * `variante_imagenes`, asi que una imagen que no cuelga de ninguna variante queda
     * fuera del JOIN. La fila y su objeto en R2 quedan ahi para siempre, invisibles.
     *
     * No se borran acá: son las unicas copias que existen y un error de etiquetado se
     * llevaria una foto buena. Se listan para poder borrarlas a mano si se quiere.
     */
    console.log(`    sin asignar (quedan huerfanas, nadie las recolecta):`);
    for (const h of p.sinAsignar) console.log(`      ${h}`);
  }
}

console.log(
  ENSAYO
    ? '\nEnsayo: no se escribio nada.'
    : `\nListo en ${donde}.${REMOTO ? ' Publicá para que el catalogo lo muestre.' : ''}`
);
