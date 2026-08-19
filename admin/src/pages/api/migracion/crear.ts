import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

import { ejecutorD1 } from '../../../lib/d1.ts';
import { cuerpoJson, json, soloPost } from '../../../lib/http.ts';
import { crearDesdeViejo } from '../../../lib/migracion/crear.ts';
import { APP_ID_PARSE, productoDeParse, urlDeFicha } from '../../../lib/migracion/parse.ts';
import { anotarError, contarFicha } from '../../../lib/scrape/corrida.ts';
import { USER_AGENT } from '../../../lib/scrape/ficha.ts';

/**
 * Trae un producto del catálogo viejo y lo crea en el catálogo (§7.2 en espíritu).
 *
 * LA PESTAÑA MANDA UN CÓDIGO, NO UN PRODUCTO, y ésa es la guarda del endpoint. El nombre, el
 * precio, la descripción y las fotos se piden a la API del catálogo viejo acá adentro: nada
 * de lo que se escribe en la base sale del navegador. Sin esto, cualquiera que pase por
 * Access podría crear productos con el contenido que quisiera — y `crearDesdeViejo` escribe
 * curaduría, que es lo que ninguna otra pieza del scrape se permite.
 *
 * UN PRODUCTO POR INVOCACIÓN, siempre. §7.3 midió que el margen de CPU es de unas 5 veces y
 * prohíbe explícitamente hacer varios en un mismo request.
 *
 * NO SUBE IMÁGENES. Devuelve sus URLs para que el navegador las pida una por una a
 * `/api/migracion/imagen`: el Worker no puede derivar las miniaturas —no hay `sharp` en
 * Workers— y el hash va separado del parseo, que es el escalón 2 de la escalera de §7.3.
 */

interface Peticion {
  scrapeId?: number;
  /**
   * La LLAVE del producto en el catálogo viejo: su `objectId` de Parse.
   *
   * No el código. Ver la nota de `ProductoDelViejo`: el inventario devuelve el código
   * normalizado a mayúsculas y Parse compara distinguiéndolas, así que los tres productos
   * con el código guardado en minúsculas daban cero filas y se reportaban como bajas.
   */
  objectId?: string;
  /** Sólo para nombrar el producto en un mensaje de error. NUNCA se usa de llave. */
  codigo?: string;
}

export const POST: APIRoute = async ({ request }) => {
  const datos = await cuerpoJson<Peticion>(request);
  const objectId = typeof datos?.objectId === 'string' ? datos.objectId.trim() : '';
  if (!objectId) return json({ error: 'Falta el identificador del producto.' }, 400);
  if (typeof datos?.scrapeId !== 'number') return json({ error: 'Falta el scrapeId.' }, 400);

  // Para los mensajes nada más: si la ficha no llega, no hay de dónde sacar un nombre.
  const comoSeLlama = typeof datos.codigo === 'string' && datos.codigo.trim() ? datos.codigo.trim() : objectId;

  const { scrapeId } = datos;
  const ahora = new Date().toISOString();
  const ejecutar = ejecutorD1(env.DB);
  const url = urlDeFicha(objectId);

  try {
    const respuesta = await fetch(url, {
      headers: {
        'X-Parse-Application-Id': APP_ID_PARSE,
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });
    /**
     * Un 404 acá SÍ significa que el producto se dio de baja: se pide por `objectId`, que es
     * exacto, así que no hay grafía que pueda fallar. Es la diferencia con la versión
     * anterior, que buscaba por código y reportaba bajas inexistentes.
     */
    if (respuesta.status === 404) {
      throw new Error(`El catálogo viejo ya no tiene ${comoSeLlama}.`);
    }
    if (!respuesta.ok) {
      throw new Error(`El catálogo viejo respondió HTTP ${respuesta.status}.`);
    }

    /**
     * `productoDeParse` verifica que el producto sea DE ESTA TIENDA, y acá eso es la guarda
     * de seguridad y no una validación de forma: pedir por `objectId` no lleva el filtro por
     * `place` en la consulta, así que sin esto un identificador ajeno traeria el producto de
     * otra tienda del mismo Parse. Devuelve `null` también si falta el título o las fotos.
     */
    const producto = productoDeParse(await respuesta.json());
    if (!producto) {
      throw new Error(`El catálogo viejo no da los datos completos de ${comoSeLlama}.`);
    }

    const registro = await crearDesdeViejo(ejecutar, producto, { scrapeId, ahora });
    await contarFicha(ejecutar, scrapeId, { creado: registro.creado });

    return json({
      codigo: producto.codigo,
      productoId: registro.productoId,
      creado: registro.creado,
      /**
       * La forma que espera `traerFotos`: un item por variante, con su SKU y sus fotos. Acá
       * la variante es siempre una —el catálogo viejo no da un color por foto— y sobre un
       * producto que ya estaba viaja vacía, así que repetir la corrida no vuelve a bajar
       * fotos que ya están.
       */
      colores: registro.sku ? [{ sku: registro.sku, fotos: producto.fotos }] : [],
    });
  } catch (error) {
    /**
     * Fallo TOLERANTE (§7.4): el producto va a `scrape_errores` y la corrida sigue. Que 177
     * productos se pierdan enteros por uno con datos raros es peor que traer 176 y listar el
     * que falló.
     */
    const motivo = error instanceof Error ? error.message : String(error);
    await anotarError(ejecutar, scrapeId, { url, motivo, ahora });
    return json({ error: motivo, anotado: true }, 200);
  }
};

export const ALL: APIRoute = () => soloPost();
