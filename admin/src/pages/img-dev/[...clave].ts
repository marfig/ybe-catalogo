import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

import { claveDesdeRuta } from '../../lib/imagenes.ts';
import { rutaDeVideo } from '../../lib/video.ts';

/**
 * Sirve las miniaturas desde el R2 LOCAL, sólo en desarrollo (SPEC-etapa2 §8.1).
 *
 * EL BUG QUE CIERRA: en `astro dev` el binding `IMAGENES` es un bucket de miniflare que
 * vive en `.wrangler/state/`, pero `PUBLIC_R2_BASE` apunta al dominio público del bucket
 * de Cloudflare. Se escribe en un lado y se lee del otro, así que TODO lo que se acaba
 * de subir —o de importar— da 404. No es un error de configuración: son dos
 * almacenamientos distintos, y hace falta una puerta al de acá.
 *
 * NO EXISTE FUERA DE DESARROLLO. En producción las imágenes las sirve el dominio público
 * del bucket, con su `Cache-Control` inmutable y sin pasar por el Worker (§5.1). Dejar
 * esta ruta viva ahí sería una segunda URL para el mismo contenido y egress facturado a
 * través del Worker por algo que R2 ya entrega gratis.
 *
 * La ruta es delgada: la validación de la clave vive en `lib/imagenes.ts`, con tests. Sin
 * ella, cualquier objeto del bucket sería descargable por su nombre.
 *
 * TAMBIÉN SIRVE LOS VIDEOS, que viven en el mismo balde bajo `videos/`. Sin esto el
 * poster y el `<video>` de la ficha dan 404 en `astro dev` — el mismo agujero que ya
 * hizo que las miniaturas de pedidos especiales no cargaran en desarrollo. La
 * diferencia con las fotos es que acá el `Content-Type` no se puede hardcodear:
 * conviven un MP4 y un WebP bajo el mismo prefijo.
 */

/** Un 404 sin detalle: qué claves existen no es información que este endpoint deba dar. */
const noExiste = () => new Response('No existe.', { status: 404 });

export const GET: APIRoute = async ({ params }) => {
  if (!import.meta.env.DEV) return noExiste();

  const ruta = params.clave ?? '';
  const imagen = claveDesdeRuta(ruta);
  const video = imagen ? null : rutaDeVideo(ruta);

  const clave = imagen ?? video?.clave;
  if (!clave) return noExiste();

  const objeto = await env.IMAGENES.get(clave);
  if (!objeto) return noExiste();

  return new Response(objeto.body, {
    headers: {
      // El tipo no es una suposición: `claveDesdeRuta` sólo devuelve `.webp`, y
      // `rutaDeVideo` devuelve el suyo junto con la clave.
      'Content-Type': video?.tipo ?? 'image/webp',
      /**
       * `no-store` y no la política inmutable de producción. Acá la foto que importa es
       * la que se acaba de subir, y una miniatura cacheada mostrando la versión anterior
       * mandaría a buscar el problema al lugar equivocado.
       */
      'Cache-Control': 'no-store',
    },
  });
};
