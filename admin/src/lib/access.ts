/**
 * Validacion del JWT de Cloudflare Access (SPEC-etapa2 §6).
 *
 * NO escribimos autenticacion: el login por PIN, la lista de emails y la emision
 * del token los hace Access. Lo que hace este modulo es lo unico que no se puede
 * delegar: **verificar** que el token es de nuestro equipo, para nuestra
 * aplicacion, y que no vencio.
 *
 * Confiar en el header `Cf-Access-Authenticated-User-Email` seria confiar en que
 * nadie puede alcanzar el Worker sin pasar por Access. Es texto plano: si el Worker
 * queda accesible por su URL de `workers.dev` sin la politica delante, ese header
 * lo pone cualquiera. **La identidad sale del JWT firmado, nunca del header.**
 *
 * Sin dependencias: WebCrypto alcanza y esta en Workers y en Node.
 */

import type { ClaveJwk, Jwks } from './jwks.ts';

/** Solo RS256. Se fija ACA y no se lee del token — ver `algoritmoDeclarado`. */
const ALGORITMO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;

/**
 * Tolerancia de reloj, en segundos.
 *
 * Un token que vencio hace un segundo no deberia expulsar a quien opera por una
 * diferencia de reloj entre el edge y el emisor. 60 s es holgado para eso y
 * despreciable frente a la vida de un token de Access.
 */
const DESFASAJE = 60;

export interface IdentidadAccess {
  email: string;
  sub: string;
}

export interface OpcionesAccess {
  /**
   * JWKS del equipo: `https://{equipo}.cloudflareaccess.com/cdn-cgi/access/certs`.
   *
   * El tipo viene de `jwks.ts` — es un import de SOLO TIPO, sin acoplamiento en
   * runtime — porque `JsonWebKey` de lib.dom no declara `kid` y sin eso hay que
   * castear en cada acceso.
   */
  jwks: Jwks;
  /** El AUD tag de ESTA aplicacion de Access. */
  aud: string;
  /** `https://{equipo}.cloudflareaccess.com`. */
  emisor: string;
  /** Segundos desde epoch. Inyectable para poder testear los tiempos. */
  ahora?: number;
}

class ErrorAccess extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorAccess';
  }
}

function decodificar(parte: string, cual: string): Record<string, unknown> {
  let texto: string;
  try {
    texto = Buffer.from(parte, 'base64url').toString('utf8');
  } catch {
    throw new ErrorAccess(`Formato invalido: ${cual} no es base64url.`);
  }
  try {
    const valor = JSON.parse(texto);
    if (valor === null || typeof valor !== 'object') {
      throw new Error('no es un objeto');
    }
    return valor as Record<string, unknown>;
  } catch {
    throw new ErrorAccess(`Formato invalido: ${cual} no es JSON de un objeto.`);
  }
}

/**
 * El `alg` del token se lee SOLO para rechazarlo si no es RS256.
 *
 * Nunca se usa para elegir el algoritmo de verificacion. Honrar el `alg` del token
 * es la vulnerabilidad clasica de JWT: `none` deja pasar cualquier cosa, y `HS256`
 * permite firmar con la clave PUBLICA usada como secreto de HMAC.
 */
function algoritmoDeclarado(cabecera: Record<string, unknown>): void {
  if (cabecera.alg !== 'RS256') {
    throw new ErrorAccess(
      `alg no soportado: ${JSON.stringify(cabecera.alg)}. Access firma con RS256 y ` +
        'el algoritmo se fija en el codigo, no se toma del token.'
    );
  }
}

function claveDelJwks(jwks: Jwks, kid: unknown): ClaveJwk {
  const clave = jwks.keys.find((k) => k.kid === kid);
  if (!clave) {
    throw new ErrorAccess(
      `kid desconocido: ${JSON.stringify(kid)}. No esta en el JWKS del equipo.`
    );
  }
  return clave;
}

/** `aud` puede venir como cadena o como arreglo, segun el emisor. */
function audiencias(payload: Record<string, unknown>): string[] {
  const aud = payload.aud;
  if (typeof aud === 'string') return [aud];
  if (Array.isArray(aud)) return aud.filter((a): a is string => typeof a === 'string');
  return [];
}

/**
 * Verifica un JWT de Access y devuelve la identidad.
 *
 * Lanza `ErrorAccess` ante cualquier problema. No devuelve `null` a proposito: un
 * valor falsy invita a un `if` olvidado, y el costo de olvidarlo aca es dejar el
 * admin abierto.
 */
export async function verificarJwtAccess(
  token: string,
  { jwks, aud, emisor, ahora = Math.floor(Date.now() / 1000) }: OpcionesAccess
): Promise<IdentidadAccess> {
  const partes = token.split('.');
  if (partes.length !== 3) {
    throw new ErrorAccess(`Formato invalido: se esperaban 3 partes y hay ${partes.length}.`);
  }
  const [cabeceraB64, cuerpoB64, firmaB64] = partes;

  const cabecera = decodificar(cabeceraB64, 'la cabecera');
  algoritmoDeclarado(cabecera);

  // La firma se verifica ANTES de creerle un solo dato al payload.
  const jwk = claveDelJwks(jwks, cabecera.kid);
  const clave = await crypto.subtle.importKey('jwk', jwk, ALGORITMO, false, ['verify']);
  const firmaOk = await crypto.subtle.verify(
    ALGORITMO.name,
    clave,
    Buffer.from(firmaB64, 'base64url'),
    new TextEncoder().encode(`${cabeceraB64}.${cuerpoB64}`)
  );
  if (!firmaOk) {
    throw new ErrorAccess('La firma no corresponde a la clave del JWKS.');
  }

  const payload = decodificar(cuerpoB64, 'el cuerpo');

  if (payload.iss !== emisor) {
    throw new ErrorAccess(`Emisor inesperado: ${JSON.stringify(payload.iss)}.`);
  }

  // Un equipo de Access puede tener varias aplicaciones, todas con el mismo emisor
  // y firmadas por la misma clave. Sin este chequeo, un token emitido para
  // cualquier otra aplicacion del equipo abre el admin.
  if (!audiencias(payload).includes(aud)) {
    throw new ErrorAccess(
      'El aud del token no incluye el de esta aplicacion. El token es de otra ' +
        'aplicacion del mismo equipo de Access.'
    );
  }

  const exp = payload.exp;
  if (typeof exp !== 'number' || exp + DESFASAJE < ahora) {
    throw new ErrorAccess('Token vencido (exp).');
  }
  const nbf = payload.nbf;
  if (typeof nbf === 'number' && nbf - DESFASAJE > ahora) {
    throw new ErrorAccess('El token todavia no es valido (nbf).');
  }

  const email = payload.email;
  const sub = payload.sub;
  if (typeof email !== 'string' || email === '') {
    // Sin email no hay a quien atribuir la publicacion (publicaciones.disparada_por).
    throw new ErrorAccess('El token no trae email.');
  }
  if (typeof sub !== 'string' || sub === '') {
    throw new ErrorAccess('El token no trae sub.');
  }

  return { email, sub };
}

/** Header donde Access deja el JWT. */
export const HEADER_JWT = 'Cf-Access-Jwt-Assertion';

/**
 * Identidad de quien hace el request, o error.
 *
 * Es la unica puerta que deberia usar el resto del admin. El header
 * `Cf-Access-Authenticated-User-Email` NO se lee ni para completar: si se usara
 * como respaldo cuando falta el JWT, el respaldo seria el agujero.
 */
export async function identidadDeRequest(
  request: Request,
  opciones: OpcionesAccess
): Promise<IdentidadAccess> {
  const token = request.headers.get(HEADER_JWT);
  if (!token) {
    throw new ErrorAccess(
      `Falta el header ${HEADER_JWT}. El request no paso por Cloudflare Access.`
    );
  }
  return verificarJwtAccess(token, opciones);
}

export { ErrorAccess };
