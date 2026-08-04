/**
 * Cliente S3 de R2: subida condicional y Cache-Control immutable (SPEC §5.1).
 *
 * Se usa la API S3 y no `wrangler r2 object put` por dos razones:
 *   - una subida por proceso de wrangler no escala a cientos de imagenes;
 *   - el importador necesita preguntar si la clave YA existe para deduplicar,
 *     y eso es un HeadObject.
 *
 * R2 no tiene regiones al estilo S3, pero el SDK exige `region`: 'auto' es el
 * valor que documenta Cloudflare.
 */
import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

/**
 * Cache inmutable. La clave incluye el SHA-256 del original, asi que un cambio
 * de contenido es un cambio de clave y no hay nada que revalidar (SPEC §5.1-2).
 *
 * Es la MISMA cadena que `public/_headers` aplica a `/_astro/*`. Al servir las
 * imagenes desde R2 esta cabecera viaja en el objeto, no en `_headers`: R2 no
 * lee ese archivo, que solo gobierna lo que sirve el Worker del sitio.
 */
export const CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** Variables de entorno que necesita el cliente. Solo el importador las usa. */
const REQUERIDAS = ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];

/**
 * Lee y valida la config de R2 desde un objeto de entorno.
 *
 * Falla con la lista COMPLETA de lo que falta, no con la primera. Un token a
 * medio configurar es el caso normal la primera vez, y descubrirlo de a una
 * variable por corrida es puro ida y vuelta.
 *
 * Pura a proposito: es la parte que se puede testear sin credenciales ni red.
 */
export function leerConfigR2(env) {
  const faltan = REQUERIDAS.filter((clave) => (env[clave] ?? '').trim() === '');

  if (faltan.length > 0) {
    throw new Error(
      `Faltan variables de R2 en .env: ${faltan.join(', ')}.\n` +
        'Las cuatro salen de Cloudflare > R2 > Manage API tokens, con permiso de ' +
        'lectura Y escritura sobre el bucket. R2_ACCOUNT_ID es el Account ID de la cuenta.'
    );
  }

  return {
    accountId: env.R2_ACCOUNT_ID.trim(),
    bucket: env.R2_BUCKET.trim(),
    accessKeyId: env.R2_ACCESS_KEY_ID.trim(),
    secretAccessKey: env.R2_SECRET_ACCESS_KEY.trim(),
  };
}

/** Endpoint S3 de una cuenta R2. Puro para poder testearlo. */
export function endpointR2(accountId) {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

/** Construye el cliente S3 apuntado a R2. */
export function clienteR2(config) {
  return new S3Client({
    region: 'auto',
    endpoint: endpointR2(config.accountId),
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

/**
 * ¿Existe la clave en el bucket?
 *
 * Cualquier error que no sea "no esta" se propaga: un 403 por token sin permiso
 * tiene que reventar, no leerse como "no existe" y disparar una subida que
 * tambien va a fallar, pero con un mensaje peor.
 */
export async function existe(cliente, bucket, clave) {
  try {
    await cliente.send(new HeadObjectCommand({ Bucket: bucket, Key: clave }));
    return true;
  } catch (error) {
    const estado = error?.$metadata?.httpStatusCode;
    if (estado === 404 || error?.name === 'NotFound') return false;
    throw error;
  }
}

/** Sube una derivada con el Cache-Control del contrato. */
export async function subir(cliente, bucket, clave, bytes, tipo = 'image/webp') {
  await cliente.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: clave,
      Body: bytes,
      ContentType: tipo,
      CacheControl: CACHE_CONTROL,
    })
  );
}

/**
 * Sube solo si la clave no esta. Devuelve si hubo subida.
 *
 * Es el dedupe de SPEC §5.1-1: los proveedores repiten la misma foto en varios
 * SKU, y con clave por contenido eso es la misma clave.
 */
export async function subirSiFalta(cliente, bucket, clave, bytes, tipo = 'image/webp') {
  if (await existe(cliente, bucket, clave)) return false;
  await subir(cliente, bucket, clave, bytes, tipo);
  return true;
}
