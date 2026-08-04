import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CACHE_CONTROL,
  endpointR2,
  existe,
  leerConfigR2,
  subir,
  subirSiFalta,
} from '../r2.mjs';

const ENV_OK = {
  R2_ACCOUNT_ID: 'cuenta123',
  R2_BUCKET: 'ybe-catalogo',
  R2_ACCESS_KEY_ID: 'llave',
  R2_SECRET_ACCESS_KEY: 'secreto',
};

/**
 * Doble del cliente S3. No se testea que el SDK sepa hablar S3: se testea que
 * nosotros armemos el comando correcto y que la logica condicional decida bien.
 *
 * `respuestas` mapea nombre de comando -> funcion que recibe el input y devuelve
 * (o lanza). Asi un HeadObject puede simular un 404 o un 403 sin red.
 */
function clienteFalso(respuestas = {}) {
  const enviados = [];
  return {
    enviados,
    async send(comando) {
      const nombre = comando.constructor.name;
      enviados.push({ nombre, input: comando.input });
      const manejar = respuestas[nombre];
      if (manejar) return manejar(comando.input);
      return {};
    },
  };
}

function errorHttp(estado, nombre = 'Error') {
  const e = new Error(`simulado ${estado}`);
  e.name = nombre;
  e.$metadata = { httpStatusCode: estado };
  return e;
}

// --------------------------------------------------------------------------
// leerConfigR2 — la parte que falla antes de tocar la red
// --------------------------------------------------------------------------

test('leerConfigR2: devuelve la config con las cuatro variables', () => {
  const config = leerConfigR2(ENV_OK);
  assert.deepEqual(config, {
    accountId: 'cuenta123',
    bucket: 'ybe-catalogo',
    accessKeyId: 'llave',
    secretAccessKey: 'secreto',
  });
});

test('leerConfigR2: recorta los espacios', () => {
  const config = leerConfigR2({ ...ENV_OK, R2_BUCKET: '  ybe-catalogo \n' });
  assert.equal(config.bucket, 'ybe-catalogo');
});

test('leerConfigR2: lista TODAS las que faltan, no solo la primera', () => {
  assert.throws(
    () => leerConfigR2({ R2_ACCOUNT_ID: 'cuenta123' }),
    (error) => {
      // El valor del test esta aca: descubrir el token a medio configurar de a
      // una variable por corrida es puro ida y vuelta.
      //
      // Se afirma sobre la LISTA, no sobre el mensaje entero: el texto de ayuda
      // menciona R2_ACCOUNT_ID a proposito y afirmar sobre todo el mensaje
      // convertiria esa ayuda en un test roto.
      const lista = error.message.match(/en \.env: ([^.]+)\./)[1];
      assert.deepEqual(lista.split(', '), [
        'R2_BUCKET',
        'R2_ACCESS_KEY_ID',
        'R2_SECRET_ACCESS_KEY',
      ]);
      return true;
    }
  );
});

test('leerConfigR2: una variable vacia o con solo espacios cuenta como ausente', () => {
  // Es el caso real de un .env copiado del .env.example y no completado.
  for (const vacio of ['', '   ', '\t']) {
    assert.throws(
      () => leerConfigR2({ ...ENV_OK, R2_SECRET_ACCESS_KEY: vacio }),
      /R2_SECRET_ACCESS_KEY/
    );
  }
});

// --------------------------------------------------------------------------
// endpointR2
// --------------------------------------------------------------------------

test('endpointR2: endpoint S3 de la cuenta', () => {
  assert.equal(endpointR2('cuenta123'), 'https://cuenta123.r2.cloudflarestorage.com');
});

// --------------------------------------------------------------------------
// existe — un 404 es "no esta", cualquier otro error revienta
// --------------------------------------------------------------------------

test('existe: true cuando el HeadObject responde', async () => {
  const cliente = clienteFalso();
  assert.equal(await existe(cliente, 'balde', 'catalogo/abc/w300.webp'), true);
  assert.equal(cliente.enviados[0].nombre, 'HeadObjectCommand');
  assert.deepEqual(cliente.enviados[0].input, {
    Bucket: 'balde',
    Key: 'catalogo/abc/w300.webp',
  });
});

test('existe: false ante 404', async () => {
  const cliente = clienteFalso({
    HeadObjectCommand: () => {
      throw errorHttp(404, 'NotFound');
    },
  });
  assert.equal(await existe(cliente, 'balde', 'catalogo/abc/w300.webp'), false);
});

test('existe: false ante NotFound sin codigo http', async () => {
  // El SDK no siempre adjunta $metadata; el name es la otra punta.
  const cliente = clienteFalso({
    HeadObjectCommand: () => {
      const e = new Error('no esta');
      e.name = 'NotFound';
      throw e;
    },
  });
  assert.equal(await existe(cliente, 'balde', 'k'), false);
});

test('existe: un 403 se propaga, NO se lee como ausente', async () => {
  // El caso que motiva el test: un token sin permiso de lectura devolveria 403.
  // Tragarlo como "no existe" dispararia una subida que tambien falla, pero con
  // un mensaje mucho peor de diagnosticar.
  const cliente = clienteFalso({
    HeadObjectCommand: () => {
      throw errorHttp(403, 'AccessDenied');
    },
  });
  await assert.rejects(() => existe(cliente, 'balde', 'k'), /simulado 403/);
});

// --------------------------------------------------------------------------
// subir — el Cache-Control del contrato viaja en el objeto
// --------------------------------------------------------------------------

test('subir: manda el Cache-Control inmutable y el content type', async () => {
  const cliente = clienteFalso();
  const bytes = Buffer.from([1, 2, 3]);
  await subir(cliente, 'balde', 'catalogo/abc/w600.webp', bytes);

  assert.equal(cliente.enviados[0].nombre, 'PutObjectCommand');
  assert.deepEqual(cliente.enviados[0].input, {
    Bucket: 'balde',
    Key: 'catalogo/abc/w600.webp',
    Body: bytes,
    ContentType: 'image/webp',
    CacheControl: 'public, max-age=31536000, immutable',
  });
});

test('CACHE_CONTROL: es la misma cadena que public/_headers aplica a /_astro/*', async () => {
  // Si alguien afloja una de las dos, el catalogo y el resto del sitio dejarian
  // de cachear igual sin que nada falle.
  const { readFile } = await import('node:fs/promises');
  const headers = await readFile('public/_headers', 'utf8');
  assert.ok(
    headers.includes(CACHE_CONTROL),
    `public/_headers no contiene "${CACHE_CONTROL}"`
  );
});

// --------------------------------------------------------------------------
// subirSiFalta — el dedupe de SPEC §5.1-1
// --------------------------------------------------------------------------

test('subirSiFalta: no sube si la clave ya esta', async () => {
  const cliente = clienteFalso();
  assert.equal(await subirSiFalta(cliente, 'balde', 'k', Buffer.alloc(1)), false);
  assert.deepEqual(
    cliente.enviados.map((e) => e.nombre),
    ['HeadObjectCommand']
  );
});

test('subirSiFalta: sube si falta', async () => {
  const cliente = clienteFalso({
    HeadObjectCommand: () => {
      throw errorHttp(404, 'NotFound');
    },
  });
  assert.equal(await subirSiFalta(cliente, 'balde', 'k', Buffer.alloc(1)), true);
  assert.deepEqual(
    cliente.enviados.map((e) => e.nombre),
    ['HeadObjectCommand', 'PutObjectCommand']
  );
});
