import { test } from 'node:test';
import assert from 'node:assert/strict';

import { urlJwks, crearProveedorJwks } from './jwks.ts';

/**
 * Tests del proveedor de JWKS con cache.
 *
 * Dos cosas que no son obvias y por eso estan cubiertas:
 *
 *  1. Traer el JWKS en cada request seria una llamada de red por pagina del admin.
 *     Se cachea.
 *  2. Access ROTA las claves. Con un cache a secas, una rotacion deja afuera a
 *     todo el mundo hasta que expire el TTL. Ante un `kid` que no esta, el cache
 *     se invalida y se reintenta UNA vez.
 *
 * El (2) es la razon de existir del modulo: sin eso, `verificarJwtAccess` con un
 * JWKS pasado a mano alcanzaba.
 */

const EQUIPO = 'ybe';

const jwksCon = (...kids: string[]) => ({
  keys: kids.map((kid) => ({ kid, kty: 'RSA', alg: 'RS256', n: 'x', e: 'AQAB' })),
});

/** `buscar` falso que cuenta llamadas y puede devolver distinto en cada una. */
function buscarFalso(respuestas: Array<{ cuerpo?: unknown; estado?: number }>) {
  const llamadas: string[] = [];
  let i = 0;
  const buscar = async (url: string) => {
    llamadas.push(url);
    const r = respuestas[Math.min(i, respuestas.length - 1)];
    i++;
    const estado = r.estado ?? 200;
    return {
      ok: estado >= 200 && estado < 300,
      status: estado,
      json: async () => r.cuerpo,
    } as unknown as Response;
  };
  return { buscar, llamadas };
}

test('urlJwks: endpoint de certificados del equipo', () => {
  assert.equal(urlJwks(EQUIPO), 'https://ybe.cloudflareaccess.com/cdn-cgi/access/certs');
});

test('urlJwks: acepta el dominio completo sin duplicarlo', () => {
  // Es facil configurar CF_ACCESS_TEAM con el dominio entero; que eso produzca
  // "ybe.cloudflareaccess.com.cloudflareaccess.com" seria un error molesto de
  // diagnosticar, porque el sintoma es un fetch que falla.
  assert.equal(
    urlJwks('ybe.cloudflareaccess.com'),
    'https://ybe.cloudflareaccess.com/cdn-cgi/access/certs'
  );
});

test('trae el JWKS y lo cachea: dos pedidos, una sola llamada de red', async () => {
  const { buscar, llamadas } = buscarFalso([{ cuerpo: jwksCon('a') }]);
  const proveedor = crearProveedorJwks({ equipo: EQUIPO, buscar, ahora: () => 1000 });

  assert.deepEqual((await proveedor.obtener('a')).keys[0].kid, 'a');
  assert.deepEqual((await proveedor.obtener('a')).keys[0].kid, 'a');
  assert.equal(llamadas.length, 1);
});

test('el cache expira y vuelve a pedir', async () => {
  const { buscar, llamadas } = buscarFalso([{ cuerpo: jwksCon('a') }]);
  let t = 1000;
  const proveedor = crearProveedorJwks({
    equipo: EQUIPO,
    buscar,
    ttl: 60,
    ahora: () => t,
  });

  await proveedor.obtener('a');
  t += 61;
  await proveedor.obtener('a');
  assert.equal(llamadas.length, 2);
});

test('un kid desconocido invalida el cache y reintenta UNA vez', async () => {
  // El caso de la rotacion de claves: el cache tiene la vieja, el token viene
  // firmado con la nueva. Sin este reintento, nadie entra al admin hasta que
  // expire el TTL.
  const { buscar, llamadas } = buscarFalso([
    { cuerpo: jwksCon('vieja') },
    { cuerpo: jwksCon('vieja', 'nueva') },
  ]);
  const proveedor = crearProveedorJwks({ equipo: EQUIPO, buscar, ahora: () => 1000 });

  await proveedor.obtener('vieja');
  assert.equal(llamadas.length, 1);

  const jwks = await proveedor.obtener('nueva');
  assert.equal(llamadas.length, 2, 'deberia haber refrescado');
  assert.deepEqual(
    jwks.keys.map((k) => (k as { kid: string }).kid),
    ['vieja', 'nueva']
  );
});

test('un kid que sigue sin aparecer NO reintenta en bucle', async () => {
  // Un token con un kid inventado no puede convertirse en un ataque de trafico
  // contra el endpoint de certificados de Cloudflare.
  const { buscar, llamadas } = buscarFalso([{ cuerpo: jwksCon('a') }]);
  const proveedor = crearProveedorJwks({ equipo: EQUIPO, buscar, ahora: () => 1000 });

  await proveedor.obtener('a');
  const antes = llamadas.length;
  await proveedor.obtener('fantasma');
  await proveedor.obtener('fantasma');
  await proveedor.obtener('fantasma');
  assert.equal(llamadas.length - antes, 1, 'un solo refresco, no uno por intento');
});

test('sin kid pedido, usa el cache y no refresca', async () => {
  const { buscar, llamadas } = buscarFalso([{ cuerpo: jwksCon('a') }]);
  const proveedor = crearProveedorJwks({ equipo: EQUIPO, buscar, ahora: () => 1000 });
  await proveedor.obtener();
  await proveedor.obtener();
  assert.equal(llamadas.length, 1);
});

// --------------------------------------------------------------------------
// Fallos: un JWKS que no llega no puede degradar a "sin claves"
// --------------------------------------------------------------------------

test('un HTTP de error revienta con el codigo', async () => {
  const { buscar } = buscarFalso([{ estado: 503 }]);
  const proveedor = crearProveedorJwks({ equipo: EQUIPO, buscar, ahora: () => 1000 });
  await assert.rejects(() => proveedor.obtener('a'), /503/);
});

test('un cuerpo sin arreglo de keys revienta', async () => {
  // Degradar a `{keys: []}` haria que TODO token sea rechazado por kid
  // desconocido: un endpoint devolviendo basura se leeria como "nadie autorizado",
  // que es un modo de falla mucho mas confuso que un error explicito.
  for (const cuerpo of [null, {}, { keys: 'no soy arreglo' }, { keys: null }]) {
    const { buscar } = buscarFalso([{ cuerpo }]);
    const proveedor = crearProveedorJwks({ equipo: EQUIPO, buscar, ahora: () => 1000 });
    await assert.rejects(() => proveedor.obtener('a'), /JWKS/);
  }
});

test('un JWKS vacio revienta en vez de rechazar todo en silencio', async () => {
  const { buscar } = buscarFalso([{ cuerpo: { keys: [] } }]);
  const proveedor = crearProveedorJwks({ equipo: EQUIPO, buscar, ahora: () => 1000 });
  await assert.rejects(() => proveedor.obtener('a'), /JWKS/);
});

test('un fallo NO deja el cache envenenado', async () => {
  // Si un 503 pisara el cache con algo invalido, el admin quedaria caido hasta el
  // proximo TTL aunque Cloudflare ya se hubiera recuperado.
  const { buscar } = buscarFalso([{ cuerpo: jwksCon('a') }, { estado: 503 }, { cuerpo: jwksCon('a') }]);
  const proveedor = crearProveedorJwks({ equipo: EQUIPO, buscar, ttl: 60, ahora: () => 1000 });

  await proveedor.obtener('a');
  await assert.rejects(() => proveedor.obtener('fantasma'), /503/);

  // El cache anterior sigue sirviendo.
  assert.deepEqual((await proveedor.obtener('a')).keys[0].kid, 'a');
});
