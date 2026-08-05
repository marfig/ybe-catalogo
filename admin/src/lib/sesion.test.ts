import { test } from 'node:test';
import assert from 'node:assert/strict';

import { leerConfigAccess, resolverIdentidad } from './sesion.ts';

/**
 * Tests de la resolucion de identidad del admin.
 *
 * El nudo esta en el atajo de desarrollo. En local NO hay Access delante, asi que
 * sin atajo el admin es inusable en una maquina; y un atajo mal puesto es una
 * puerta abierta en produccion. Los tests que importan son los que verifican que
 * el atajo NO se puede activar fuera de desarrollo.
 */

const ENV_OK = { CF_ACCESS_TEAM: 'ybe', CF_ACCESS_AUD: 'aud-admin' };

// --------------------------------------------------------------------------
// leerConfigAccess
// --------------------------------------------------------------------------

test('leerConfigAccess: equipo y aud', () => {
  assert.deepEqual(leerConfigAccess(ENV_OK), { equipo: 'ybe', aud: 'aud-admin' });
});

test('leerConfigAccess: lista TODAS las que faltan', () => {
  assert.throws(
    () => leerConfigAccess({}),
    (error: Error) => {
      const lista = error.message.match(/faltan: ([^.]+)\./)![1];
      assert.deepEqual(lista.split(', '), ['CF_ACCESS_TEAM', 'CF_ACCESS_AUD']);
      return true;
    }
  );
});

test('leerConfigAccess: una variable vacia cuenta como ausente', () => {
  assert.throws(() => leerConfigAccess({ ...ENV_OK, CF_ACCESS_AUD: '   ' }), /CF_ACCESS_AUD/);
});

// --------------------------------------------------------------------------
// El atajo de desarrollo. Acá está el riesgo.
// --------------------------------------------------------------------------

const req = (headers: Record<string, string> = {}) =>
  new Request('https://admin.test/', { headers });

/** Verificador falso: no interesa la criptografia acá, ya está probada aparte. */
const verificadorFalso = async () => ({ email: 'real@ybe.com.py', sub: 'sub-real' });

test('en desarrollo, con ADMIN_DEV_EMAIL y sin JWT, entra como ese email', async () => {
  const identidad = await resolverIdentidad({
    request: req(),
    env: { ...ENV_OK, ADMIN_DEV_EMAIL: 'yo@local' },
    esDesarrollo: true,
    verificar: verificadorFalso,
  });
  assert.deepEqual(identidad, { email: 'yo@local', sub: 'desarrollo' });
});

test('FUERA de desarrollo, ADMIN_DEV_EMAIL se IGNORA por completo', async () => {
  // EL test del modulo. Si la variable quedara seteada en produccion por un copiar
  // y pegar del .env, esto tiene que seguir exigiendo el JWT.
  await assert.rejects(
    () =>
      resolverIdentidad({
        request: req(),
        env: { ...ENV_OK, ADMIN_DEV_EMAIL: 'intruso@local' },
        esDesarrollo: false,
        verificar: verificadorFalso,
      }),
    /Cf-Access-Jwt-Assertion/
  );
});

test('en desarrollo SIN ADMIN_DEV_EMAIL, sigue exigiendo el JWT', async () => {
  // El atajo es opt-in explicito: "estar en dev" no alcanza para abrir la puerta.
  await assert.rejects(
    () =>
      resolverIdentidad({
        request: req(),
        env: ENV_OK,
        esDesarrollo: true,
        verificar: verificadorFalso,
      }),
    /Cf-Access-Jwt-Assertion/
  );
});

test('en desarrollo, un JWT presente GANA sobre el atajo', async () => {
  // Si hay token, se valida. Asi el atajo no enmascara un token roto mientras se
  // prueba la integracion con Access de verdad.
  const identidad = await resolverIdentidad({
    request: req({ 'Cf-Access-Jwt-Assertion': 'un.token.cualquiera' }),
    env: { ...ENV_OK, ADMIN_DEV_EMAIL: 'yo@local' },
    esDesarrollo: true,
    verificar: verificadorFalso,
  });
  assert.equal(identidad.email, 'real@ybe.com.py');
});

test('el atajo NO se activa con un ADMIN_DEV_EMAIL vacio', async () => {
  await assert.rejects(
    () =>
      resolverIdentidad({
        request: req(),
        env: { ...ENV_OK, ADMIN_DEV_EMAIL: '  ' },
        esDesarrollo: true,
        verificar: verificadorFalso,
      }),
    /Cf-Access-Jwt-Assertion/
  );
});

test('en produccion con JWT valido, devuelve la identidad del token', async () => {
  const identidad = await resolverIdentidad({
    request: req({ 'Cf-Access-Jwt-Assertion': 'un.token.cualquiera' }),
    env: ENV_OK,
    esDesarrollo: false,
    verificar: verificadorFalso,
  });
  assert.deepEqual(identidad, { email: 'real@ybe.com.py', sub: 'sub-real' });
});

test('un fallo del verificador se propaga, no cae al atajo', async () => {
  // Que un token invalido caiga al atajo de desarrollo seria lo peor de los dos
  // mundos: parece que autentica y no autentica.
  await assert.rejects(
    () =>
      resolverIdentidad({
        request: req({ 'Cf-Access-Jwt-Assertion': 'malo' }),
        env: { ...ENV_OK, ADMIN_DEV_EMAIL: 'yo@local' },
        esDesarrollo: true,
        verificar: async () => {
          throw new Error('La firma no corresponde');
        },
      }),
    /firma/i
  );
});
