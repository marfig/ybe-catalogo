/**
 * Dispara la publicación: `repository_dispatch` a GitHub Actions (SPEC-etapa2 §11.2).
 *
 * El admin NO construye ni despliega. Sólo avisa. El trabajo lo hace el workflow, que
 * es el único que tiene el token de deploy — si el admin pudiera desplegar, un bug en
 * el admin podría tumbar el catálogo, que es justo lo que §4.1 separó en dos Workers.
 */

const REQUERIDAS = ['GITHUB_REPO', 'GITHUB_TOKEN'] as const;

export interface ConfigDespacho {
  /** `usuario/repo`. */
  repo: string;
  token: string;
}

type Entorno = Record<string, string | undefined>;

/** Config del despacho. Lista TODAS las variables faltantes, como el resto del repo. */
export function leerConfigDespacho(env: Entorno): ConfigDespacho {
  const faltan = REQUERIDAS.filter((k) => (env[k] ?? '').trim() === '');
  if (faltan.length > 0) {
    throw new Error(
      `No se puede publicar: falta configurar ${faltan.join(', ')}.\n` +
        'GITHUB_REPO es "usuario/repo" y GITHUB_TOKEN un token con permiso de ' +
        'contents:write sobre ese repositorio.'
    );
  }
  return { repo: env.GITHUB_REPO!.trim(), token: env.GITHUB_TOKEN!.trim() };
}

/**
 * Manda el `repository_dispatch` de tipo `publicar`.
 *
 * El id de la publicación viaja en `client_payload` para que el workflow sepa QUÉ
 * fila de `publicaciones` actualizar. Sin eso, el workflow no tendría forma de
 * reportar el resultado contra el intento correcto si hubiera dos seguidos.
 */
export async function despacharPublicacion(
  { repo, token }: ConfigDespacho,
  idPublicacion: number,
  buscar: typeof fetch = fetch
): Promise<void> {
  const respuesta = await buscar(`https://api.github.com/repos/${repo}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      // GitHub rechaza los requests sin User-Agent.
      'User-Agent': 'ybe-admin',
    },
    body: JSON.stringify({
      event_type: 'publicar',
      client_payload: { publicacion: idPublicacion },
    }),
  });

  /**
   * Un dispatch exitoso responde 204 SIN cuerpo. Cualquier otra cosa es un fallo, y
   * hay que decirlo con el codigo: los dos casos frecuentes — token sin permiso (403)
   * y repo mal escrito (404) — se distinguen solo por ahi.
   */
  if (respuesta.status !== 204) {
    const cuerpo = await respuesta.text().catch(() => '');
    throw new Error(
      `GitHub rechazó el pedido de publicación (HTTP ${respuesta.status}). ` +
        (respuesta.status === 404
          ? `Revisar que GITHUB_REPO ("${repo}") exista y que el token tenga acceso.`
          : respuesta.status === 403 || respuesta.status === 401
            ? 'Revisar los permisos del GITHUB_TOKEN.'
            : cuerpo.slice(0, 200))
    );
  }
}
