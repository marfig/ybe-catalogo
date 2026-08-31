/**
 * Ejecutor de consultas via wrangler, para correr el volcado en una maquina.
 *
 * En la GitHub Action el volcado va por la API HTTP de D1 (`ejecutorD1` en
 * `consultar.mjs`), que necesita un token. En local no hay token: hay una sesion de
 * wrangler. Este ejecutor existe para poder correr y VERIFICAR el volcado sin
 * montar secrets, y no se usa en produccion.
 */
import { execFileSync } from 'node:child_process';

/**
 * Entrada JS de wrangler.
 *
 * Se invoca con `process.execPath` y NO con `npx`: en Windows, `execFileSync('npx')`
 * da ENOENT y `npx.cmd` da EINVAL sin `shell: true` (Node 22 endurecio el spawn de
 * .cmd/.bat). Ir directo al .js evita el shell y de paso el infierno de comillas.
 */
const WRANGLER = 'node_modules/wrangler/bin/wrangler.js';

/** Un valor como literal de SQL, escapando el apostrofo. */
function literal(valor) {
  if (valor === null || valor === undefined) return 'NULL';
  if (typeof valor === 'number') return String(valor);
  return `'${String(valor).replace(/'/g, "''")}'`;
}

/**
 * Colapsa el SQL a una linea y sustituye los parametros.
 *
 * `wrangler d1 execute --command` recibe UNA cadena, y el SQL de `consultar.mjs`
 * es un template multilinea con parametros.
 */
export function enUnaLinea(sql, params = []) {
  const huecos = (sql.match(/\?/g) ?? []).length;
  if (huecos !== params.length) {
    // Un desajuste silencioso produciria SQL valido con el filtro equivocado.
    const h = huecos === 1 ? 'placeholder' : 'placeholders';
    const p = params.length === 1 ? 'parametro' : 'parametros';
    throw new Error(`El SQL tiene ${huecos} ${h} y se pasaron ${params.length} ${p}.`);
  }

  let i = 0;
  return sql
    .replace(/\?/g, () => literal(params[i++]))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extrae las filas de la salida de `wrangler d1 execute --json`.
 *
 * Dos trampas, las dos descubiertas a la mala:
 *
 *  1. El preambulo ("├ Checking if file needs uploading") va a STDOUT, no a
 *     stderr, asi que hay que buscar donde arranca el JSON.
 *  2. Con `--file`, `--json` devuelve un RESUMEN ("Total queries executed",
 *     "Rows read") en vez de los resultados. Parecia que la consulta traia una
 *     sola fila cuando la base tenia seis. Se usa `--command`, y esta funcion
 *     DETECTA el resumen para que cambiar la bandera no vuelque un catalogo
 *     truncado en silencio.
 */
export function filasDeSalida(texto) {
  const desde = texto.indexOf('[');
  if (desde === -1) {
    throw new Error(`wrangler no devolvio JSON. Salida:\n${texto}`);
  }

  let json;
  try {
    json = JSON.parse(texto.slice(desde));
  } catch (error) {
    throw new Error(`No se pudo parsear la salida de wrangler: ${error.message}\n${texto}`);
  }

  if (!Array.isArray(json) || json.length !== 1) {
    const cuantos = Array.isArray(json) ? json.length : 0;
    throw new Error(`wrangler devolvio ${cuantos} resultados para una sola sentencia.`);
  }
  if (json[0].success === false) {
    throw new Error(`D1 rechazo la consulta: ${JSON.stringify(json[0])}`);
  }

  const filas = json[0].results ?? [];
  if (filas.length > 0 && 'Total queries executed' in filas[0]) {
    throw new Error(
      'wrangler devolvio un resumen en vez de las filas. Pasa con --file: usar --command.'
    );
  }
  return filas;
}

/**
 * Ejecutor listo para `consultarFilas()`.
 *
 * Donde vive la D1 de miniflare con la que trabaja `astro dev` del admin.
 *
 * Sin `--persist-to`, wrangler crea un estado nuevo en la raiz del repo y el volcado
 * saldria de una base vacia: la que se llena al usar el admin en local esta bajo
 * `admin/`, porque es ahi donde corre su dev server.
 */
const ESTADO_LOCAL = 'admin/.wrangler/state';

/**
 * Los argumentos de `wrangler d1 execute`. Pieza pura, con tests.
 *
 * SEPARADA DEL `execFileSync` A PROPOSITO: acá se decide contra QUE BASE se corre, que
 * es la decision mas cara de este archivo. Enterrada en la llamada, la unica forma de
 * verificarla es correrla — y equivocarse significa leer produccion cuando se queria
 * leer local, o peor, volcar una base local sobre el catalogo publicado.
 *
 * `--command` y NUNCA `--file`: con `--file --json` wrangler devuelve un RESUMEN en vez
 * de las filas, y el volcado saldria truncado sin ningun error. Ya paso una vez.
 *
 * @param {{base: string, config: string, local?: boolean}} opciones
 */
export function argumentosWrangler({ base, config, local = false }) {
  return [
    WRANGLER,
    'd1',
    'execute',
    base,
    // Uno o el otro, nunca los dos: juntos no dan error de sintaxis, wrangler elige
    // uno, y cual elige no es algo que convenga averiguar mirando un catalogo publicado.
    ...(local ? ['--local', '--persist-to', ESTADO_LOCAL] : ['--remote']),
    '--config',
    config,
    '--command',
    '',
    '--json',
  ];
}

/**
 * @param {{base: string, config: string, cwd?: string, local?: boolean}} opciones
 */
export function ejecutorWrangler({ base, config, cwd = process.cwd(), local = false }) {
  const plantilla = argumentosWrangler({ base, config, local });
  const iComando = plantilla.indexOf('--command') + 1;

  return (sql, params = []) => {
    const args = [...plantilla];
    args[iComando] = enUnaLinea(sql, params);

    const salida = execFileSync(process.execPath, args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
    });
    return filasDeSalida(salida);
  };
}
