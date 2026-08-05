/**
 * JWKS del equipo de Access, con cache y refresco ante rotacion de claves.
 *
 * Existe por dos razones concretas:
 *
 *  1. Traerlo en cada request seria una llamada de red por pagina del admin.
 *  2. **Access rota las claves.** Con un cache a secas, una rotacion deja afuera a
 *     todo el mundo hasta que expire el TTL. Ante un `kid` que no esta en el cache,
 *     se refresca y se reintenta una vez.
 *
 * El (2) es la razon de ser del modulo: si no, pasarle un JWKS a mano a
 * `verificarJwtAccess()` alcanzaba.
 */

/** 1 hora. Access rota rara vez, y el refresco por `kid` cubre el caso urgente. */
const TTL_POR_DEFECTO = 3600;

type Buscar = (url: string) => Promise<Response>;

export interface Jwks {
  keys: JsonWebKey[];
}

export interface OpcionesProveedor {
  /** Nombre del equipo (`ybe`) o su dominio completo. */
  equipo: string;
  buscar?: Buscar;
  /** Segundos de vida del cache. */
  ttl?: number;
  /** Reloj en segundos. Inyectable para testear la expiracion. */
  ahora?: () => number;
}

/**
 * Endpoint de certificados del equipo.
 *
 * Acepta tanto `ybe` como `ybe.cloudflareaccess.com`: es facil configurar la
 * variable con el dominio entero, y que eso produzca
 * `ybe.cloudflareaccess.com.cloudflareaccess.com` seria un error molesto de
 * diagnosticar, porque el sintoma es un fetch que falla sin decir por que.
 */
export function urlJwks(equipo: string): string {
  const limpio = equipo
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  const dominio = limpio.endsWith('.cloudflareaccess.com')
    ? limpio
    : `${limpio}.cloudflareaccess.com`;
  return `https://${dominio}/cdn-cgi/access/certs`;
}

function validarJwks(cuerpo: unknown, url: string): Jwks {
  const keys = (cuerpo as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(keys) || keys.length === 0) {
    /**
     * NO se degrada a `{keys: []}`. Con un JWKS vacio, todo token se rechaza por
     * `kid` desconocido, asi que un endpoint devolviendo basura se leeria como
     * "nadie esta autorizado" — un modo de falla mucho mas confuso de diagnosticar
     * que un error explicito.
     */
    throw new Error(`JWKS invalido en ${url}: no trae un arreglo de keys no vacio.`);
  }
  return { keys: keys as JsonWebKey[] };
}

export interface ProveedorJwks {
  /**
   * Devuelve el JWKS. Si se pasa `kid` y no esta en el cache, refresca una vez
   * antes de devolverlo.
   */
  obtener(kid?: string): Promise<Jwks>;
}

export function crearProveedorJwks({
  equipo,
  buscar = fetch,
  ttl = TTL_POR_DEFECTO,
  ahora = () => Math.floor(Date.now() / 1000),
}: OpcionesProveedor): ProveedorJwks {
  const url = urlJwks(equipo);

  let cache: Jwks | null = null;
  let vence = 0;
  /**
   * `kid` que ya provocaron un refresco. Sin esto, un token con un kid inventado
   * dispararia una llamada de red por intento y se convertiria en un ataque de
   * trafico contra el endpoint de certificados de Cloudflare.
   */
  const refrescadosPor = new Set<string>();

  async function traer(): Promise<Jwks> {
    const respuesta = await buscar(url);
    if (!respuesta.ok) {
      throw new Error(`No se pudo traer el JWKS: HTTP ${respuesta.status} en ${url}.`);
    }
    // Se valida ANTES de pisar el cache: un fallo no puede dejar el cache
    // envenenado y el admin caido hasta el proximo TTL.
    const jwks = validarJwks(await respuesta.json(), url);
    cache = jwks;
    vence = ahora() + ttl;
    return jwks;
  }

  const tiene = (jwks: Jwks, kid: string) =>
    jwks.keys.some((k) => (k as { kid?: string }).kid === kid);

  return {
    async obtener(kid) {
      if (cache === null || ahora() >= vence) {
        const fresco = await traer();
        refrescadosPor.clear();
        return fresco;
      }

      if (kid !== undefined && !tiene(cache, kid) && !refrescadosPor.has(kid)) {
        refrescadosPor.add(kid);
        return traer();
      }

      return cache;
    },
  };
}
