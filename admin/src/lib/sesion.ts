/**
 * Resolucion de identidad del admin: config de Access y el atajo de desarrollo.
 *
 * La verificacion criptografica vive en `access.ts`. Este modulo decide **de donde
 * sale la identidad**, que es una decision distinta y con su propio riesgo: en
 * local no hay Access delante, asi que sin atajo el admin es inusable en una
 * maquina — y un atajo mal puesto es una puerta abierta en produccion.
 */
import { HEADER_JWT, type IdentidadAccess } from './access.ts';

const REQUERIDAS = ['CF_ACCESS_TEAM', 'CF_ACCESS_AUD'] as const;

export interface ConfigAccess {
  equipo: string;
  aud: string;
}

type Entorno = Record<string, string | undefined>;

const vacia = (v: string | undefined) => (v ?? '').trim() === '';

/** Config de Access. Lista TODAS las variables faltantes, como el resto del repo. */
export function leerConfigAccess(env: Entorno): ConfigAccess {
  const faltan = REQUERIDAS.filter((k) => vacia(env[k]));
  if (faltan.length > 0) {
    throw new Error(
      `Config de Access incompleta, faltan: ${faltan.join(', ')}.\n` +
        'CF_ACCESS_TEAM es el nombre del equipo y CF_ACCESS_AUD el AUD tag de la ' +
        'aplicacion de Access del admin (panel de Cloudflare > Zero Trust > Access).'
    );
  }
  return { equipo: env.CF_ACCESS_TEAM!.trim(), aud: env.CF_ACCESS_AUD!.trim() };
}

export interface OpcionesIdentidad {
  request: Request;
  env: Entorno;
  /** `import.meta.env.DEV`. Se inyecta para poder testear las dos ramas. */
  esDesarrollo: boolean;
  /** Verificador real de JWT. Se inyecta para no repetir la criptografia acá. */
  verificar: (token: string) => Promise<IdentidadAccess>;
}

/**
 * Identidad de quien hace el request. Lanza si no se puede establecer.
 *
 * EL ATAJO DE DESARROLLO, y por que esta forma:
 *
 *  - Exige DOS condiciones a la vez: estar en desarrollo Y que `ADMIN_DEV_EMAIL`
 *    tenga un valor. Estar en dev no alcanza; es opt-in explicito.
 *  - `esDesarrollo` llega de `import.meta.env.DEV`, que Vite reemplaza por la
 *    constante `false` al compilar para produccion. VERIFICADO sobre el bundle
 *    desplegado: el unico call site queda literalmente `esDesarrollo: false`.
 *
 *    Ojo con lo que esto NO es. La rama sigue estando en el bundle —el cuerpo de
 *    esta funcion se emite entero, `esDesarrollo && !vacia(...)` incluido— y se
 *    evalua en cada request. Lo que la hace inalcanzable es el valor que recibe,
 *    no una eliminacion del bundler. La garantia es «el unico llamador pasa una
 *    constante de build», y deja de valer el dia que alguien agregue un segundo
 *    llamador con un valor calculado.
 *  - Si un `ADMIN_DEV_EMAIL` quedara seteado en produccion por un copiar y pegar
 *    del `.env`, no cambia nada: se sigue exigiendo el JWT.
 *  - Un JWT presente SIEMPRE gana sobre el atajo. Asi el atajo no enmascara un
 *    token roto mientras se prueba la integracion con Access de verdad.
 *  - Un fallo del verificador se PROPAGA, nunca cae al atajo: un token invalido
 *    que entrara por la puerta de desarrollo seria lo peor de los dos mundos.
 */
export async function resolverIdentidad({
  request,
  env,
  esDesarrollo,
  verificar,
}: OpcionesIdentidad): Promise<IdentidadAccess> {
  const token = request.headers.get(HEADER_JWT);

  if (token) {
    return verificar(token);
  }

  const emailDesarrollo = env.ADMIN_DEV_EMAIL;
  if (esDesarrollo && !vacia(emailDesarrollo)) {
    return { email: emailDesarrollo!.trim(), sub: 'desarrollo' };
  }

  throw new Error(
    `Falta el header ${HEADER_JWT}. El request no paso por Cloudflare Access.` +
      (esDesarrollo
        ? '\nEn desarrollo se puede definir ADMIN_DEV_EMAIL para entrar sin Access.'
        : '')
  );
}
