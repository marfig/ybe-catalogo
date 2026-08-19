import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

import { ejecutorD1 } from '../../../lib/d1.ts';
import { cuerpoJson, json, soloPost } from '../../../lib/http.ts';
import {
  APP_ID_PARSE,
  POR_PAGINA,
  productosDeRespuesta,
  urlDeConsulta,
} from '../../../lib/migracion/parse.ts';
import { codigosExistentes } from '../../../lib/scrape/registrar.ts';
// El mismo del scrape del proveedor, no una copia: si el tráfico molesta, tiene que poder
// identificarse igual desde los dos caminos.
import { USER_AGENT } from '../../../lib/scrape/ficha.ts';

/**
 * Una página del inventario del catálogo viejo, ya cruzada contra nuestra base.
 *
 * UNA PÁGINA POR PEDIDO, y no las cuatro de una. El paso de 1 pedido por segundo (§7.4) lo
 * marca la pestaña sobre cada request que sale: si el Worker hiciera los cuatro adentro, la
 * cortesía se la saltearía sin que nadie lo decidiera. Es la misma razón por la que
 * `/api/scrape/ficha` procesa una ficha por invocación.
 *
 * VA POR EL WORKER Y NO POR LA PESTAÑA porque la API del catálogo viejo no manda cabeceras
 * CORS: el navegador no puede pedirle nada. No es una elección de diseño, es la única forma.
 * Y de paso el `User-Agent` identificable del proyecto sale del servidor.
 *
 * EL CRUCE CONTRA D1 SE HACE ACÁ, en la misma vuelta, y por eso la pantalla no necesita
 * saber qué hay en el catálogo: `codigosExistentes` es una sola consulta a la base propia,
 * no le cuesta nada a nadie, y lo que ahorra son los 189 pedidos que costaría descubrir lo
 * mismo producto por producto. Es la misma función que usa la importación para «saltear los
 * que ya tengo».
 */

interface Peticion {
  /** Desde qué producto. La pestaña avanza de a `POR_PAGINA` hasta llegar al total. */
  skip?: number;
}

export const POST: APIRoute = async ({ request }) => {
  const datos = await cuerpoJson<Peticion>(request);
  const pedido = Number(datos?.skip);
  const skip = Number.isInteger(pedido) && pedido > 0 ? pedido : 0;

  let cuerpo: unknown;
  try {
    const respuesta = await fetch(urlDeConsulta({ skip, limit: POR_PAGINA, contar: true }), {
      headers: {
        'X-Parse-Application-Id': APP_ID_PARSE,
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });
    if (!respuesta.ok) {
      return json(
        { error: `El catálogo viejo respondió HTTP ${respuesta.status} al pedir el inventario.` },
        502
      );
    }
    cuerpo = await respuesta.json();
  } catch (error) {
    return json(
      {
        error: `No se pudo leer el inventario del catálogo viejo: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      502
    );
  }

  const pagina = productosDeRespuesta(cuerpo);

  /**
   * `null` es un cambio de forma del origen, no una tienda vacía. Cortar acá es mejor que
   * devolver una lista vacía, que la pantalla mostraría como «no falta nada por migrar» —
   * la conclusión opuesta a la verdadera.
   */
  if (!pagina) {
    return json({ error: 'La API del catálogo viejo no devolvió lo esperado.' }, 502);
  }

  const ejecutar = ejecutorD1(env.DB);
  const yaTenemos = new Set(
    (await codigosExistentes(ejecutar, pagina.productos.map((p) => p.codigo))).map((c) =>
      c.toUpperCase()
    )
  );

  const faltan = pagina.productos.filter((p) => !yaTenemos.has(p.codigo.toUpperCase()));

  /**
   * Viajan sólo el código y el nombre. El nombre es para que la pantalla pueda nombrar un
   * problema con algo legible en vez de un número; los datos que se van a ESCRIBIR salen de
   * la API en el paso siguiente, nunca del navegador.
   */
  return json({
    total: pagina.total,
    revisados: pagina.productos.length,
    descartados: pagina.descartados,
    yaEstaban: pagina.productos.length - faltan.length,
    productos: faltan.map((p) => ({ codigo: p.codigo, nombre: p.nombre })),
  });
};

export const ALL: APIRoute = () => soloPost();
