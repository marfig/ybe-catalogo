import { test } from 'node:test';
import assert from 'node:assert/strict';

import { identidadDeRequest, verificarJwtAccess } from './access.ts';

/**
 * Tests de la validacion del JWT de Cloudflare Access (SPEC-etapa2 §6).
 *
 * El admin no escribe autenticacion propia, pero SI valida el JWT en cada request:
 * confiar solo en el header `Cf-Access-Authenticated-User-Email` seria confiar en
 * que nadie puede alcanzar el Worker sin pasar por Access.
 *
 * Aca el valor esta en los casos NEGATIVOS. Un verificador que acepta un token
 * valido no prueba nada — el que no rechaza un `alg: none` o un `aud` de otra
 * aplicacion es una puerta abierta que igual se ve funcionando.
 *
 * Se firma con un par de claves generado en el test: sin red y sin secretos.
 */

const EQUIPO = 'https://ybe.cloudflareaccess.com';
const AUD = 'aud-de-la-app-de-admin';
const AHORA = 1_800_000_000; // segundos, fijo: un reloj real haria el test inestable

const b64url = (datos: Uint8Array | string): string => {
  const bytes = typeof datos === 'string' ? new TextEncoder().encode(datos) : datos;
  return Buffer.from(bytes).toString('base64url');
};

async function parDeClaves() {
  return crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]), // 65537
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  );
}

/** JWKS con la clave publica, en el formato que sirve Access. */
async function jwksDe(publica: CryptoKey, kid = 'llave-1') {
  const jwk = await crypto.subtle.exportKey('jwk', publica);
  return { keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] };
}

/** Firma un JWT. `alg` se puede falsear para probar los ataques de algoritmo. */
async function firmar(
  privada: CryptoKey,
  payload: Record<string, unknown>,
  { kid = 'llave-1', alg = 'RS256' } = {}
) {
  const cabecera = b64url(JSON.stringify({ alg, kid, typ: 'JWT' }));
  const cuerpo = b64url(JSON.stringify(payload));
  const firma = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privada,
    new TextEncoder().encode(`${cabecera}.${cuerpo}`)
  );
  return `${cabecera}.${cuerpo}.${b64url(new Uint8Array(firma))}`;
}

const payloadValido = (extra: Record<string, unknown> = {}) => ({
  iss: EQUIPO,
  aud: [AUD],
  sub: 'usuario-123',
  email: 'marvin@ybe.com.py',
  iat: AHORA - 60,
  exp: AHORA + 3600,
  ...extra,
});

const claves = await parDeClaves();
const JWKS = await jwksDe(claves.publicKey);
const opciones = { jwks: JWKS, aud: AUD, emisor: EQUIPO, ahora: AHORA };

// --------------------------------------------------------------------------
// El camino feliz, solo para tener linea de base
// --------------------------------------------------------------------------

test('acepta un token bien firmado y devuelve la identidad del JWT', async () => {
  const token = await firmar(claves.privateKey, payloadValido());
  assert.deepEqual(await verificarJwtAccess(token, opciones), {
    email: 'marvin@ybe.com.py',
    sub: 'usuario-123',
  });
});

test('acepta aud como cadena, no solo como arreglo', async () => {
  const token = await firmar(claves.privateKey, payloadValido({ aud: AUD }));
  assert.equal((await verificarJwtAccess(token, opciones)).email, 'marvin@ybe.com.py');
});

// --------------------------------------------------------------------------
// Ataques de algoritmo. Son los que dejan pasar a cualquiera.
// --------------------------------------------------------------------------

test('RECHAZA alg: none', async () => {
  // El clasico: sin firma, cualquiera se fabrica un token de administrador.
  const cabecera = b64url(JSON.stringify({ alg: 'none', kid: 'llave-1', typ: 'JWT' }));
  const cuerpo = b64url(JSON.stringify(payloadValido()));
  await assert.rejects(() => verificarJwtAccess(`${cabecera}.${cuerpo}.`, opciones), /alg/i);
});

test('RECHAZA alg: HS256 aunque el kid exista', async () => {
  // Confusion de algoritmo: si el verificador honrara el `alg` del token, se
  // podria firmar con la clave PUBLICA como secreto de HMAC. El algoritmo se
  // fija en el codigo, no se lee del token.
  const token = await firmar(claves.privateKey, payloadValido(), { alg: 'HS256' });
  await assert.rejects(() => verificarJwtAccess(token, opciones), /alg/i);
});

test('RECHAZA una firma que no corresponde', async () => {
  const otras = await parDeClaves();
  const token = await firmar(otras.privateKey, payloadValido());
  await assert.rejects(() => verificarJwtAccess(token, opciones), /firma/i);
});

test('RECHAZA un kid que no esta en el JWKS', async () => {
  const token = await firmar(claves.privateKey, payloadValido(), { kid: 'llave-que-no-existe' });
  await assert.rejects(() => verificarJwtAccess(token, opciones), /kid/i);
});

test('RECHAZA un token con el cuerpo alterado despues de firmar', async () => {
  const token = await firmar(claves.privateKey, payloadValido());
  const [cabecera, , firma] = token.split('.');
  const alterado = b64url(JSON.stringify(payloadValido({ email: 'intruso@otro.com' })));
  await assert.rejects(
    () => verificarJwtAccess(`${cabecera}.${alterado}.${firma}`, opciones),
    /firma/i
  );
});

// --------------------------------------------------------------------------
// aud: sin esto, un token de OTRA aplicacion del mismo equipo entra
// --------------------------------------------------------------------------

test('RECHAZA un aud de otra aplicacion del mismo equipo', async () => {
  // El equipo de Access puede tener varias aplicaciones. Todas las firma la misma
  // clave y todas tienen el mismo `iss`. Sin verificar `aud`, un token emitido
  // para cualquier otra aplicacion abre el admin.
  const token = await firmar(claves.privateKey, payloadValido({ aud: ['otra-app'] }));
  await assert.rejects(() => verificarJwtAccess(token, opciones), /aud/i);
});

test('RECHAZA un token sin aud', async () => {
  const sinAud = payloadValido();
  delete (sinAud as Record<string, unknown>).aud;
  const token = await firmar(claves.privateKey, sinAud);
  await assert.rejects(() => verificarJwtAccess(token, opciones), /aud/i);
});

test('acepta si el aud esperado esta entre varios', async () => {
  const token = await firmar(claves.privateKey, payloadValido({ aud: ['otra', AUD] }));
  assert.equal((await verificarJwtAccess(token, opciones)).sub, 'usuario-123');
});

// --------------------------------------------------------------------------
// Emisor y tiempos
// --------------------------------------------------------------------------

test('RECHAZA otro emisor', async () => {
  const token = await firmar(claves.privateKey, payloadValido({ iss: 'https://otro.cloudflareaccess.com' }));
  await assert.rejects(() => verificarJwtAccess(token, opciones), /emisor|iss/i);
});

test('RECHAZA un token vencido mas alla de la tolerancia de reloj', async () => {
  // Vencido hace una hora: fuera de la ventana de DESFASAJE. El limite importa —
  // ver el test de desfasaje mas abajo, que es la contraparte.
  const token = await firmar(claves.privateKey, payloadValido({ exp: AHORA - 3600 }));
  await assert.rejects(() => verificarJwtAccess(token, opciones), /vencid|exp/i);
});

test('RECHAZA un token sin exp', async () => {
  // Sin exp seria un token eterno. Que falte no puede leerse como "no vence".
  const sinExp = payloadValido();
  delete (sinExp as Record<string, unknown>).exp;
  const token = await firmar(claves.privateKey, sinExp);
  await assert.rejects(() => verificarJwtAccess(token, opciones), /vencid|exp/i);
});

test('RECHAZA un token que todavia no vale (nbf en el futuro)', async () => {
  const token = await firmar(claves.privateKey, payloadValido({ nbf: AHORA + 600 }));
  await assert.rejects(() => verificarJwtAccess(token, opciones), /nbf|todavia/i);
});

test('tolera un desfasaje de reloj chico', async () => {
  // Contraparte del test de vencimiento: un token que vencio hace 5 segundos no
  // deberia expulsar a quien opera por una diferencia de reloj entre el edge y el
  // emisor. Los dos tests juntos fijan el limite; uno solo no dice nada.
  const token = await firmar(claves.privateKey, payloadValido({ exp: AHORA - 5 }));
  assert.equal((await verificarJwtAccess(token, opciones)).sub, 'usuario-123');
});

// --------------------------------------------------------------------------
// Forma del token y del payload
// --------------------------------------------------------------------------

test('RECHAZA un token que no tiene tres partes', async () => {
  for (const malo of ['', 'a', 'a.b', 'a.b.c.d']) {
    await assert.rejects(() => verificarJwtAccess(malo, opciones), /formato|partes/i);
  }
});

test('RECHAZA un token con JSON invalido', async () => {
  const token = `${b64url('no soy json')}.${b64url('tampoco')}.x`;
  await assert.rejects(() => verificarJwtAccess(token, opciones), /formato|JSON/i);
});

test('RECHAZA un token valido pero sin email', async () => {
  // Sin email no hay a quien atribuir la publicacion (§6, publicaciones.disparada_por).
  const sinEmail = payloadValido();
  delete (sinEmail as Record<string, unknown>).email;
  const token = await firmar(claves.privateKey, sinEmail);
  await assert.rejects(() => verificarJwtAccess(token, opciones), /email/i);
});

// --------------------------------------------------------------------------
// identidadDeRequest — la puerta que usa el middleware
// --------------------------------------------------------------------------

test('identidadDeRequest: saca el token del header Cf-Access-Jwt-Assertion', async () => {
  const token = await firmar(claves.privateKey, payloadValido());
  const req = new Request('https://admin.test/', {
    headers: { 'Cf-Access-Jwt-Assertion': token },
  });
  assert.equal((await identidadDeRequest(req, opciones)).email, 'marvin@ybe.com.py');
});

test('identidadDeRequest: sin el header, rechaza', async () => {
  const req = new Request('https://admin.test/');
  await assert.rejects(() => identidadDeRequest(req, opciones), /Cf-Access-Jwt-Assertion/);
});

test('identidadDeRequest: IGNORA el header de email; la identidad sale del JWT', async () => {
  // El test que justifica todo el modulo. El header es texto que cualquiera puede
  // mandar si alcanza al Worker sin pasar por Access; el JWT esta firmado.
  const token = await firmar(claves.privateKey, payloadValido());
  const req = new Request('https://admin.test/', {
    headers: {
      'Cf-Access-Jwt-Assertion': token,
      'Cf-Access-Authenticated-User-Email': 'intruso@otro.com',
    },
  });
  assert.equal((await identidadDeRequest(req, opciones)).email, 'marvin@ybe.com.py');
});

test('identidadDeRequest: un header de email solo, sin JWT, NO alcanza', async () => {
  const req = new Request('https://admin.test/', {
    headers: { 'Cf-Access-Authenticated-User-Email': 'intruso@otro.com' },
  });
  await assert.rejects(() => identidadDeRequest(req, opciones), /Cf-Access-Jwt-Assertion/);
});
