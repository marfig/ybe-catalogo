import { createHash } from 'node:crypto';
import sharp from 'sharp';

/** Tamanos del contrato de imagenes. El origen es 600x600 (SPEC §5.2). */
export const TAMANOS = [300, 600];

/** Lado minimo del origen para que alguna derivada se sostenga sin ampliar. */
export const LADO_MINIMO = Math.min(...TAMANOS);

/** Calidad WebP fijada por el contrato (SPEC §5.2). */
const CALIDAD_WEBP = 82;

/** Relleno: coincide con el fondo real de las fotos y con --color-superficie. */
const RELLENO = { r: 255, g: 255, b: 255 };

/**
 * Clave de deduplicacion: primeros 16 hex del SHA-256 del archivo ORIGINAL.
 *
 * Se calcula sobre los bytes, nunca sobre el nombre: los nombres del origen son
 * IDs opacos de 80 hex que no son hashes de contenido (SPEC §2.2-7).
 */
export function hash16(buffer) {
  return createHash('sha256').update(buffer).digest('hex').slice(0, 16);
}

/**
 * Normaliza una imagen de origen a las derivadas cuadradas del contrato.
 *
 * Una sola operacion cubre todos los casos (SPEC §6.10):
 *   - fit 'contain'         -> encaja dentro del cuadrado, NUNCA recorta
 *   - background blanco     -> el relleno es invisible sobre el fondo real
 *   - withoutEnlargement    -> nunca amplia, que es lo que hace cumplir §5.5
 *
 * @returns {Promise<{
 *   suficiente: boolean,
 *   derivadas: Record<number, Buffer>,
 *   origen: { ancho: number, alto: number },
 *   avisos: string[]
 * }>}
 */
export async function procesarImagen(buffer) {
  const meta = await sharp(buffer).metadata();
  const ancho = meta.width ?? 0;
  const alto = meta.height ?? 0;
  const ladoMayor = Math.max(ancho, alto);
  const avisos = [];

  // Por debajo del tamano mas chico, cualquier derivada seria pixeles
  // inventados. El placeholder es mas honesto (SPEC §5.4, §5.5).
  if (ladoMayor < LADO_MINIMO) {
    avisos.push(
      `resolucion insuficiente: ${ancho}x${alto}, menor a ${LADO_MINIMO} px. Sin imagenes; se usa el placeholder.`
    );
    return { suficiente: false, derivadas: {}, origen: { ancho, alto }, avisos };
  }

  const derivadas = {};
  for (const lado of TAMANOS) {
    if (ladoMayor < lado) {
      avisos.push(
        `no se genera w${lado}: el origen mide ${ancho}x${alto} y ampliarlo inventaria pixeles.`
      );
      continue;
    }
    derivadas[lado] = await sharp(buffer)
      .resize(lado, lado, {
        fit: 'contain',
        background: RELLENO,
        withoutEnlargement: true,
      })
      // Sin metadatos: el EXIF del origen no aporta y agrega bytes no
      // deterministas al resultado.
      .webp({ quality: CALIDAD_WEBP, effort: 4 })
      .toBuffer();
  }

  return { suficiente: true, derivadas, origen: { ancho, alto }, avisos };
}

/** Clave en R2 para una derivada. Direccionada por contenido (SPEC §5.1). */
export function claveR2(hash, lado) {
  return `catalogo/${hash}/w${lado}.webp`;
}
