import type { APIRoute } from 'astro';

import { json, soloPost } from '../../../lib/http.ts';
import { ORIGEN_VIEJO, productosDelSitemap } from '../../../lib/migracion/viejo.ts';
// El mismo del scrape del proveedor, no una copia: si el trafico molesta, tiene que
// poder identificarse igual desde los dos caminos.
import { USER_AGENT } from '../../../lib/scrape/ficha.ts';

/**
 * El inventario del catálogo viejo: los 368 productos de su sitemap.
 *
 * VA POR EL WORKER Y NO POR LA PESTAÑA por dos razones, y la primera es que no hay
 * alternativa: `catalogst.com` no manda cabeceras CORS, así que el navegador no puede
 * pedirle nada. La segunda es la de siempre — el `User-Agent` identificable del proyecto
 * sale del servidor, no de un navegador que pone el suyo.
 *
 * EL SITEMAP Y NO LOS LISTADOS. Medido el 2026-08-12: `/catalog` y cada página de
 * categoría devuelven 24 items y siguen con scroll infinito, así que recorrerlas da un
 * inventario incompleto. El sitemap trae los 368 en un pedido y sin JavaScript.
 *
 * `robots.txt` del origen, verificado el 2026-08-12: `Allow: /`, con `/cart`,
 * `/checkout`, `/payment`, `/account` y `/search` prohibidos. Esto pide `/sitemap.xml` y
 * después sólo `/product/*`, que están permitidos, y declara el sitemap él mismo.
 */

export const POST: APIRoute = async () => {
  const url = new URL('/sitemap.xml', ORIGEN_VIEJO);

  let xml: string;
  try {
    const respuesta = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/xml,text/xml,*/*' },
    });
    if (!respuesta.ok) {
      return json({ error: `El catálogo viejo respondió HTTP ${respuesta.status} al pedir el sitemap.` }, 502);
    }
    xml = await respuesta.text();
  } catch (error) {
    return json({ error: `No se pudo leer el sitemap: ${error instanceof Error ? error.message : String(error)}` }, 502);
  }

  const productos = productosDelSitemap(xml);

  /**
   * Un sitemap que parsea pero no trae productos es un cambio de forma del origen, no un
   * catálogo vacío. Cortar acá es mejor que devolver una lista vacía que la pantalla
   * mostraría como «nada que migrar».
   */
  if (productos.length === 0) {
    return json({ error: 'El sitemap del catálogo viejo no trajo ningún producto.' }, 502);
  }

  return json({ productos });
};

export const ALL: APIRoute = () => soloPost();
