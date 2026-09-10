import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

import { ejecutorD1 } from '../../../lib/d1.ts';
import { cuerpoJson, json, soloPost } from '../../../lib/http.ts';
import { anotarError, codigoYaVisto, contarFicha } from '../../../lib/scrape/corrida.ts';
import { cuantasFotosDeColor, fotosPorColor } from '../../../lib/scrape/extractor.ts';
import { extraerFicha } from '../../../lib/scrape/ficha.ts';
import { registrarFicha } from '../../../lib/scrape/registrar.ts';

/**
 * Una ficha del proveedor (SPEC-etapa2 §7.2).
 *
 * La unidad es el MODELO, no la página: el bloque de colores de una ficha ya revela
 * todos los hermanos, así que no hace falta recorrer el catálogo dos veces.
 *
 * **Una ficha por invocación, siempre.** §7.3 midió que el margen de CPU es ~5× y
 * prohíbe explícitamente parsear varias fichas en un mismo request.
 *
 * NO sube imágenes. Devuelve sus URLs para que el navegador las pida una por una a
 * `/api/scrape/imagen`: el Worker no puede derivar (no hay `sharp` en Workers) y el
 * hash va separado del parseo, que es el escalón 2 de la escalera de §7.3.
 *
 * Devuelve las fotos de TODOS los colores del modelo y no sólo del visitado. Es lo que
 * hace que la unidad sea de verdad el modelo: los hermanos nunca se visitan, así que si
 * sus fotos no salieran de acá no saldrían de ningún lado.
 */

interface Peticion {
  scrapeId?: number;
  url?: string;
}

export const POST: APIRoute = async ({ request }) => {
  const datos = await cuerpoJson<Peticion>(request);
  if (!datos?.url) return json({ error: 'Falta la URL de la ficha.' }, 400);
  if (typeof datos.scrapeId !== 'number') return json({ error: 'Falta el scrapeId.' }, 400);

  const ahora = new Date().toISOString();
  const ejecutar = ejecutorD1(env.DB);
  const { scrapeId, url } = datos;

  try {
    const ficha = await extraerFicha(url);

    /**
     * Los hermanos se descubren desde la ficha de cualquiera de ellos. Sin este corte,
     * un modelo de 3 colores costaría 3 requests al proveedor para traer lo mismo.
     */
    if (await codigoYaVisto(ejecutar, scrapeId, ficha.codigo)) {
      return json({ codigo: ficha.codigo, omitida: true, motivo: 'ya visitada en esta corrida' });
    }

    /**
     * El reparto de fotos por color se calcula ANTES de registrar y se usa dos veces:
     * acá, para que `registrarFicha` ordene los colores del alta por cantidad de
     * fotos, y abajo, como respuesta para que el navegador las suba.
     *
     * SE CUENTA SOBRE EL MISMO REPARTO QUE SE DEVUELVE, y no volviendo a mirar
     * `ficha.fotos` y `hermano.foto` por separado. Contar dos veces lo mismo por dos
     * caminos distintos es la clase de duplicación que se desincroniza sin dar error:
     * el orden diría una cosa y las fotos que llegan serían otras.
     */
    const porColor = fotosPorColor(ficha);

    const registro = await registrarFicha(
      ejecutar,
      {
        codigo: ficha.codigo,
        urlOrigen: ficha.url,
        // El origen no expone la categoría por el camino de lanzamientos (§5.4b).
        categoriaOrigen: null,
        colores: [
          {
            colorOrigen: ficha.colorOrigen,
            url: ficha.url,
            cantidadDeFotos: cuantasFotosDeColor(ficha, porColor, ficha.colorOrigen),
          },
          ...ficha.hermanos.map((h) => ({
            colorOrigen: h.colorOrigen,
            url: h.url,
            cantidadDeFotos: cuantasFotosDeColor(ficha, porColor, h.colorOrigen),
          })),
        ],
        // Sólo se usa si el producto es nuevo: `registrarFicha` no la pone en el UPDATE.
        medidas: ficha.medidas,
      },
      { scrapeId, ahora }
    );

    await contarFicha(ejecutar, scrapeId, { creado: registro.creado });

    /**
     * Las fotos de TODOS los colores del modelo, cada una con su SKU.
     *
     * La galería es del color de esta ficha; la foto de cada hermano viene del bloque de
     * colores de esta misma página, y está a resolución completa. Antes se devolvía sólo
     * el color visitado, así que los hermanos entraban como variantes y se quedaban sin
     * imagen — su ficha nunca se visita, la saltea el corte por código de §7.4.
     */
    return json({
      codigo: ficha.codigo,
      productoId: registro.productoId,
      creado: registro.creado,
      variantesNuevas: registro.variantesNuevas,
      avisoDeCambio: registro.avisoDeCambio,
      coloresSinNombre: registro.coloresSinNombre,
      colores: porColor,
      // Para que el navegador las marque como visitadas y no las vuelva a pedir.
      hermanos: ficha.hermanos.map((h) => h.url),
    });
  } catch (error) {
    /**
     * Fallo TOLERANTE (§7.4): la ficha va a `scrape_errores` y la corrida sigue. Que
     * una tanda de 64 productos se pierda entera por una ficha caída es peor que
     * importar 63 y listar la que falló.
     */
    const motivo = error instanceof Error ? error.message : String(error);
    await anotarError(ejecutar, scrapeId, { url, motivo, ahora });
    return json({ error: motivo, anotado: true }, 200);
  }
};

export const ALL: APIRoute = () => soloPost();
