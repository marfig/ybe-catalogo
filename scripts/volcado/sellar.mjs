/**
 * Sella la publicacion: `aprobado` -> `publicado` y `publicado_en`
 * (SPEC-etapa2 §5.2, §11.2).
 *
 * Corre en la GitHub Action DESPUES de un deploy exitoso.
 *
 *   node scripts/volcado/sellar.mjs
 *
 * LA CARRERA QUE ESTO EVITA, y por que se sella contra el ARCHIVO:
 *
 * Entre el volcado y este paso pasan minutos. Si alguien aprueba un producto en el
 * medio, sellar "todos los aprobados de ahora" lo marcaria como publicado sin que
 * este en el sitio — y §11.2 promete exactamente lo contrario: «nunca queda un
 * publicado que en realidad no esta en el sitio».
 *
 * La fuente de verdad de "que hay en el sitio" es `src/data/productos.json`, que es
 * literalmente el archivo que se acaba de construir y desplegar. Se sella contra sus
 * slugs y el que llego tarde se queda esperando el proximo build, que es lo correcto.
 */
import { readFile } from 'node:fs/promises';

import { ejecutorD1, leerConfigD1 } from './consultar.mjs';
import { ejecutorWrangler } from './ejecutor-wrangler.mjs';

const CATALOGO = 'src/data/productos.json';

/** Los slugs del catalogo desplegado. El `id` del JSON ES el slug (SPEC.md §4.3). */
export function slugsDelCatalogo(catalogo) {
  const slugs = new Set();
  for (const producto of catalogo) {
    if (typeof producto?.id !== 'string' || producto.id === '') {
      // Sellar contra una lista incompleta dejaria productos en `aprobado` para
      // siempre, esperando un build que ya paso.
      throw new Error(
        `Un producto del catalogo no trae id: ${JSON.stringify(producto)?.slice(0, 120)}`
      );
    }
    slugs.add(producto.id);
  }
  return slugs;
}

/**
 * Pasa a `publicado` los `aprobado` que estan en el catalogo y sella su fecha.
 *
 * @param {(sql: string, params?: unknown[]) => Promise<object[]>} ejecutar
 * @param {ReadonlySet<string>} slugs  los del archivo desplegado
 */
export async function sellarPublicados(ejecutar, slugs, { ahora }) {
  if (slugs.size === 0) return { publicados: 0, sellados: 0 };

  const lista = [...slugs];
  const huecos = lista.map(() => '?').join(', ');

  /**
   * Solo `aprobado` cambia de estado.
   *
   * Los `eliminado` tambien aparecen en el JSON — con `activo: false`, para que su
   * URL no quede rota (§5.2) — y estar en el archivo NO los devuelve al catalogo.
   */
  const publicados = await ejecutar(
    `UPDATE productos
        SET estado = 'publicado'
      WHERE estado = 'aprobado' AND slug IN (${huecos})
      RETURNING id`,
    lista
  );

  /**
   * `publicado_en` se sella solo si esta vacio: es la PRIMERA publicacion, no la
   * ultima. El esquema lo dice — «NULL = nunca fue publico» — y pisarlo en cada
   * build convertiria el campo en otro dato.
   *
   * Va aparte del UPDATE de arriba para cubrir tambien el caso de un producto ya
   * `publicado` al que le falta la fecha, como los que entraron por la migracion.
   */
  const sellados = await ejecutar(
    `UPDATE productos
        SET publicado_en = ?
      WHERE publicado_en IS NULL
        AND estado IN ('publicado', 'eliminado')
        AND slug IN (${huecos})
      RETURNING id`,
    [ahora, ...lista]
  );

  return { publicados: publicados.length, sellados: sellados.length };
}

// --------------------------------------------------------------------------
// CLI
// --------------------------------------------------------------------------

if (import.meta.filename === process.argv[1]) {
  const catalogo = JSON.parse(await readFile(CATALOGO, 'utf8'));
  const slugs = slugsDelCatalogo(catalogo);

  // Mismo criterio de transporte que el resto del volcado.
  const completas = ['CLOUDFLARE_ACCOUNT_ID', 'D1_DATABASE_ID', 'CLOUDFLARE_API_TOKEN'].every(
    (k) => (process.env[k] ?? '').trim() !== ''
  );
  const ejecutar = completas
    ? ejecutorD1(leerConfigD1(process.env))
    : ejecutorWrangler({ base: 'ybe-catalogo', config: 'db/wrangler.jsonc' });

  const { publicados, sellados } = await sellarPublicados(ejecutar, slugs, {
    ahora: new Date().toISOString(),
  });

  console.log(
    `${slugs.size} productos en el catálogo desplegado · ` +
      `${publicados} pasaron a publicado · ${sellados} con fecha sellada.`
  );
}
