import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

import { buscarPorCodigo } from '../../lib/codigo.ts';
import { ejecutorD1 } from '../../lib/d1.ts';

/**
 * ¿Existe un producto con este código? (§5.3, §9)
 *
 * Sirve al aviso que el formulario de alta muestra mientras se escribe. El alta ya
 * detecta el duplicado y ofrece editar, pero enterarse DESPUÉS de cargar tres colores
 * y cuatro fotos es tarde.
 *
 * Es de sólo lectura y devuelve lo mínimo: si existe y su nombre. No expone el resto
 * de la fila porque nadie lo necesita para este aviso.
 */
export const GET: APIRoute = async ({ url }) => {
  const producto = await buscarPorCodigo(ejecutorD1(env.DB), url.searchParams.get('codigo') ?? '');

  return new Response(
    JSON.stringify(
      producto ? { existe: true, codigo: producto.codigo, nombre: producto.nombre } : { existe: false }
    ),
    {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    }
  );
};
