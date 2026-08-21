/**
 * Imprime cuantos productos quedaron EN EL CATALOGO en el ultimo volcado.
 *
 *   node scripts/volcado/contar.mjs   ->   270
 *
 * Es el numero que la Action le reporta al admin al terminar de publicar (§11.3), y
 * NO es `productos.json.length`. El JSON incluye los eliminados —con `activo: false`,
 * a proposito, para que su direccion web no quede rota (§10.5)—, asi que contar filas
 * daba «281 productos en el catalogo» cuando en el catalogo habia 270. El tablero y el
 * panel de publicacion se contradecian sobre la misma base.
 *
 * ARCHIVO APARTE Y NO UN CLI EN `construir.mjs`: esa pieza es PURA por contrato —no
 * toca red, ni base, ni disco— y es lo que la hace testeable sin credenciales. La E/S
 * vive afuera, como en `index.mjs`. Aca esta la lectura; la regla esta alla, con un
 * test que la sujeta.
 */
import { readFile } from 'node:fs/promises';

import { contarEnElCatalogo } from './construir.mjs';

/** El mismo archivo que escribe `index.mjs`. */
const SALIDA = 'src/data/productos.json';

console.log(contarEnElCatalogo(JSON.parse(await readFile(SALIDA, 'utf8'))));
