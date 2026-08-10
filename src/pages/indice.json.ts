import type { APIRoute } from 'astro';

import { activos, variantesActivas } from '../lib/productos.ts';
import type { EntradaIndice } from '../lib/buscar.ts';

/**
 * El índice de búsqueda del sitio público (SPEC §9.4, SPEC-etapa2 §5.3).
 *
 * Se genera en BUILD y sale como un archivo estático más. No es un endpoint de
 * búsqueda: el sitio es `output: 'static'` y montar un servidor para esto rompería esa
 * propiedad, que es la que hace que el catálogo cueste $0 y no se caiga (§9.4).
 *
 * SE MANDA EL ÍNDICE COMPLETO, medido en §9.4: con el volumen objetivo de 300 a 1.500
 * productos son ~79 KB con Brotli en el peor caso, y el plan B —shards por categoría—
 * queda especificado y sin construir hasta que el catálogo pase ese techo.
 *
 * LAS CLAVES SON DE UNA LETRA a propósito. Se repiten una vez por producto, así que con
 * 1.500 entradas la diferencia entre `nombre` y `n` son decenas de KB de puro nombre de
 * campo. Comprime bien igual, pero no hay razón para pagarlo.
 */

/** Campos: ver `EntradaIndice`. `descripcion` no entra (§9.4). */
export const GET: APIRoute = async () => {
  const productos = await activos();

  const indice: EntradaIndice[] = productos.map((p) => {
    const variantes = variantesActivas(p);
    const primera = variantes[0]?.imagenes?.[0];

    return {
      i: p.id,
      n: p.data.nombre,
      /**
       * El código sale de `origen.ref`, que es donde vive (§5.3-3). No hay un campo
       * `codigo` aparte: sería el mismo valor escrito dos veces, y dos copias del
       * identificador es una que se puede desincronizar.
       */
      k: p.data.origen.ref,
      p: p.data.precio,
      c: p.data.categorias.map((ref) => ref.id),
      /**
       * Sólo el hash, sin el prefijo ni el ancho: la isla arma la URL con la misma
       * convención que el resto del sitio. Guardar la URL entera repetiría el dominio
       * de R2 en cada entrada.
       */
      t: primera ? primera.base.replace('catalogo/', '') : null,
    };
  });

  return new Response(JSON.stringify(indice), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      /**
       * El índice cambia en cada publicación y su URL no lleva hash, así que NO se
       * puede cachear como inmutable. Una hora es el equilibrio: quien navega no lo
       * vuelve a bajar, y un catálogo actualizado llega el mismo día.
       */
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
