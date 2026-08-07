/**
 * `robots.txt` del proveedor (SPEC-etapa2 §7.4, SPEC.md §6.2).
 *
 * Hoy el sitio devuelve 404 — sin exclusiones declaradas — pero el chequeo se hace
 * igual. Un scraper que sólo respeta las reglas cuando las midió una vez es un scraper
 * que las ignora el día que aparecen.
 *
 * El parseo es pequeño a propósito: grupos de `User-agent`, `Allow` y `Disallow`, y la
 * precedencia estándar de la regla más específica. No implementa `Crawl-delay`, porque
 * el paso ya está fijado en 1 request por segundo y no se va a acelerar por nada.
 */
import { ORIGEN } from './origen.ts';
import { USER_AGENT } from './ficha.ts';

export interface Regla {
  permite: boolean;
  ruta: string;
}

export interface Robots {
  /** Reglas que aplican a nuestro agente, ya resueltas. */
  reglas: Regla[];
  /** `true` si no había archivo: sin exclusiones declaradas. */
  ausente: boolean;
}

/** Token de nuestro agente para machear grupos, en minúsculas. */
const TOKEN = USER_AGENT.split('/')[0].toLowerCase();

/**
 * Parsea `robots.txt` y devuelve las reglas que nos aplican.
 *
 * Un grupo que nombra a nuestro agente gana sobre el grupo `*`: es lo que dice el
 * estándar y también lo prudente, porque un sitio que nos nombra lo hizo a propósito.
 */
export function parsearRobots(texto: string): Regla[] {
  const grupos = new Map<string, Regla[]>();
  let agentes: string[] = [];
  let esperandoAgentes = true;

  for (const cruda of texto.split('\n')) {
    const linea = cruda.replace(/#.*$/, '').trim();
    if (!linea) continue;

    const i = linea.indexOf(':');
    if (i < 0) continue;
    const campo = linea.slice(0, i).trim().toLowerCase();
    const valor = linea.slice(i + 1).trim();

    if (campo === 'user-agent') {
      // Varios `User-agent` seguidos comparten el mismo bloque de reglas.
      if (!esperandoAgentes) {
        agentes = [];
        esperandoAgentes = true;
      }
      agentes.push(valor.toLowerCase());
      if (!grupos.has(valor.toLowerCase())) grupos.set(valor.toLowerCase(), []);
      continue;
    }

    if (campo !== 'allow' && campo !== 'disallow') continue;
    esperandoAgentes = false;
    // Una regla sin agente declarado no pertenece a ningún grupo: se descarta.
    for (const a of agentes) grupos.get(a)!.push({ permite: campo === 'allow', ruta: valor });
  }

  return grupos.get(TOKEN) ?? grupos.get('*') ?? [];
}

/**
 * ¿Podemos pedir esta URL?
 *
 * Gana la regla de ruta más larga; a igual largo, gana `Allow`. Un `Disallow:` vacío
 * no prohíbe nada — es la forma de decir «todo permitido».
 */
export function permiteRuta(reglas: Regla[], url: string): boolean {
  let mejor: Regla | null = null;
  let ruta: string;
  try {
    const u = new URL(url);
    ruta = u.pathname + u.search;
  } catch {
    return false;
  }

  for (const regla of reglas) {
    if (regla.ruta === '') continue;
    if (!ruta.startsWith(regla.ruta)) continue;
    if (
      !mejor ||
      regla.ruta.length > mejor.ruta.length ||
      (regla.ruta.length === mejor.ruta.length && regla.permite)
    ) {
      mejor = regla;
    }
  }

  return mejor ? mejor.permite : true;
}

/**
 * Baja el `robots.txt`. Un 404 significa «sin exclusiones», no un error.
 *
 * Si la red falla, se devuelve `ausente` y sin reglas: bloquear el scrape porque el
 * `robots.txt` no cargó sería castigar al usuario por un problema que no es suyo, y el
 * paso de 1 request por segundo ya lo protege al proveedor.
 */
export async function leerRobots({ buscar = fetch }: { buscar?: typeof fetch } = {}): Promise<Robots> {
  try {
    const respuesta = await buscar(`${ORIGEN}/robots.txt`, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!respuesta.ok) return { reglas: [], ausente: true };
    return { reglas: parsearRobots(await respuesta.text()), ausente: false };
  } catch {
    return { reglas: [], ausente: true };
  }
}
