import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';

import { verificarJwtAccess } from './lib/access.ts';
import { crearProveedorJwks, emisorDeEquipo, type ProveedorJwks } from './lib/jwks.ts';
import { leerConfigAccess, resolverIdentidad } from './lib/sesion.ts';

/**
 * Puerta del admin: valida el JWT de Access en CADA request (SPEC-etapa2 §6).
 *
 * Access delante es la puerta; esto es la cerradura. Sin la validacion, alcanzar el
 * Worker por su URL de `workers.dev` sin pasar por la politica bastaria para entrar,
 * porque el header de identidad es texto plano.
 *
 * Se aplica a TODO, sin lista de rutas exentas. Una excepcion es una ruta que
 * alguien va a olvidar que existe.
 */

/**
 * Proveedores de JWKS por equipo, a nivel de modulo.
 *
 * El modulo sobrevive entre requests del mismo isolate, asi que el cache de claves
 * se comparte y no se pide el JWKS en cada pagina. Se indexa por equipo porque la
 * config llega del entorno del request y no de una constante de build.
 */
const proveedores = new Map<string, ProveedorJwks>();

function proveedorDe(equipo: string): ProveedorJwks {
  let proveedor = proveedores.get(equipo);
  if (!proveedor) {
    proveedor = crearProveedorJwks({ equipo });
    proveedores.set(equipo, proveedor);
  }
  return proveedor;
}

/** El `kid` se lee sin validar, SOLO para saber si hay que refrescar el JWKS. */
function kidDe(token: string): string | undefined {
  try {
    const cabecera = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
    return typeof cabecera?.kid === 'string' ? cabecera.kid : undefined;
  } catch {
    // Un token con cabecera ilegible se rechaza igual mas adelante, con su motivo.
    return undefined;
  }
}

export const onRequest = defineMiddleware(async (context, next) => {
  /**
   * El entorno se importa de `cloudflare:workers`, NO de `locals.runtime.env`: eso
   * se removio en Astro 6 y el sintoma es un 500 al primer acceso.
   *
   * Los modulos de `lib/` reciben el entorno por parametro justamente para no
   * importar esto: asi siguen corriendo bajo `node --test`, donde
   * `cloudflare:workers` no existe.
   */
  const entorno = env as unknown as Record<string, string | undefined>;

  try {
    const { equipo, aud } = leerConfigAccess(entorno);
    const proveedor = proveedorDe(equipo);

    context.locals.identidad = await resolverIdentidad({
      request: context.request,
      env: entorno,
      esDesarrollo: import.meta.env.DEV,
      verificar: async (token) =>
        verificarJwtAccess(token, {
          // Se pasa el `kid` para que una rotacion de claves de Access no deje a
          // nadie afuera hasta que expire el TTL del cache.
          jwks: await proveedor.obtener(kidDe(token)),
          aud,
          emisor: emisorDeEquipo(equipo),
        }),
    });
  } catch (error) {
    /**
     * 403 y no 401: no hay nada que el navegador pueda reintentar con credenciales
     * — el login lo hace Access, no el admin.
     *
     * El motivo va en el cuerpo a proposito. Es una superficie de un solo usuario
     * detras de Access, y en la practica los que van a leer esto son quien lo
     * configura y quien lo depura; esconderlo convertiria un "falta CF_ACCESS_AUD"
     * en una pantalla muda.
     */
    const motivo = error instanceof Error ? error.message : String(error);
    return new Response(`No autorizado.\n\n${motivo}\n`, {
      status: 403,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        // Nada del admin se cachea: son datos de una sola persona autenticada.
        'Cache-Control': 'no-store',
      },
    });
  }

  const respuesta = await next();
  respuesta.headers.set('Cache-Control', 'no-store');
  return respuesta;
});
