/**
 * Subida de derivadas a R2 y alta en `imagenes` (SPEC-etapa2 §8.3; SPEC.md §5.1, §6.8).
 *
 * EL RIESGO QUE DEFINE ESTE MÓDULO: el hash lo calcula el NAVEGADOR (§8.3), y la
 * clave en R2 se arma con él — `catalogo/{hash16}/w{n}.webp`. Un hash equivocado, por
 * un bug del cliente que es nuestro propio código, escribiría encima de las fotos de
 * otro producto y no habría forma de recuperarlas.
 *
 * De ahí las dos defensas centrales: **el formato del hash se valida** y **nunca se
 * sobreescribe** una clave existente. El peor caso deja de ser «destruiste una foto»
 * y pasa a ser «te devolvió la que ya estaba», que es recuperable.
 */
import { ANCHOS } from './imagen.ts';
import { claveDeImagen } from './imagenes.ts';
import type { Ejecutar } from './grilla.ts';

/** Mismo `Cache-Control` que usa el importador (SPEC.md §5.1-2). */
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * Tope por derivada.
 *
 * Un `w300.webp` de 20 MB es un bug o un abuso, no una miniatura: las reales rondan
 * los 4 a 50 KB. El tope es holgado a propósito, sólo corta lo absurdo.
 */
const MAXIMO_BYTES = 4 * 1024 * 1024;

const RE_HASH16 = /^[0-9a-f]{16}$/;

/** Lo mínimo de R2 que este módulo necesita. Facilita testear sin bucket. */
export interface BaldeR2 {
  put(
    clave: string,
    bytes: Uint8Array,
    opciones: { httpMetadata: { contentType: string; cacheControl: string } }
  ): Promise<unknown>;
}

export interface DatosSubida {
  /** SHA-256 de los bytes ORIGINALES, primeros 16 hex (§8.1). */
  hash16: string;
  anchoOrigen: number;
  altoOrigen: number;
  bytesOrigen: number;
  /** ancho → bytes del WebP. */
  derivadas: Map<number, Uint8Array>;
}

/**
 * ¿Los bytes son un WebP?
 *
 * Se sirven con `Content-Type: image/webp` desde una URL pública, así que subir otra
 * cosa es, como mínimo, una imagen rota en el catálogo.
 *
 * Se miran los DOS marcadores: `RIFF` al principio y `WEBP` en el byte 8. Un WAV
 * también empieza con `RIFF`, así que los primeros cuatro no alcanzan.
 */
export function esWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const marca = (desde: number, texto: string) =>
    [...texto].every((c, i) => bytes[desde + i] === c.charCodeAt(0));
  return marca(0, 'RIFF') && marca(8, 'WEBP');
}

/** Valida todo antes de tocar R2 o la base. Lanza con el motivo. */
export function validarSubida({
  hash16,
  anchoOrigen,
  altoOrigen,
  bytesOrigen,
  derivadas,
}: DatosSubida): void {
  /**
   * El formato del hash NO es cosmética: con este valor se arma la clave de R2. Un
   * hash con barras o puntos escribiría fuera del prefijo `catalogo/`.
   */
  if (!RE_HASH16.test(hash16)) {
    throw new Error(
      `hash16 inválido: ${JSON.stringify(hash16)}. Se esperan 16 caracteres hex en minúscula.`
    );
  }

  const entero = (n: number) => Number.isInteger(n) && n > 0;
  if (!entero(anchoOrigen) || !entero(altoOrigen) || !entero(bytesOrigen)) {
    throw new Error(
      `Dimensiones de origen inválidas: ${anchoOrigen}×${altoOrigen}, ${bytesOrigen} bytes.`
    );
  }

  if (derivadas.size === 0) {
    throw new Error('No se recibió ninguna derivada.');
  }

  const ladoMayor = Math.max(anchoOrigen, altoOrigen);

  for (const [ancho, bytes] of derivadas) {
    if (!(ANCHOS as readonly number[]).includes(ancho)) {
      throw new Error(`Ancho ${ancho} fuera del contrato. Sólo ${ANCHOS.join(' y ')}.`);
    }
    /**
     * «Nunca se amplía» verificado del lado del servidor. El cliente ya no debería
     * mandar una derivada más grande que el origen, pero el servidor no le cree: es
     * el mismo criterio con el que se valida el hash.
     */
    if (ancho > ladoMayor) {
      throw new Error(
        `No se puede generar w${ancho} desde un origen de ${anchoOrigen}×${altoOrigen}: ` +
          'ampliar inventaría píxeles (SPEC §5.5).'
      );
    }
    if (bytes.length > MAXIMO_BYTES) {
      throw new Error(
        `La derivada w${ancho} pesa ${Math.round(bytes.length / 1024)} kB, más que el ` +
          `tope de ${MAXIMO_BYTES / 1024 / 1024} MB. Parece un error.`
      );
    }
    if (!esWebp(bytes)) {
      throw new Error(`La derivada w${ancho} no es un WebP.`);
    }
  }
}

/**
 * Arma los datos de subida desde el `FormData` del navegador.
 *
 * Va aparte del endpoint y con tests propios porque es el punto donde entra input no
 * confiable: un campo faltante o un número que no es número no puede terminar en un
 * `NaN` viajando hasta el `INSERT`.
 *
 * Espera: `hash16`, `anchoOrigen`, `altoOrigen`, `bytesOrigen`, y un archivo por cada
 * ancho con el nombre `w300` / `w600`.
 */
export async function datosDesdeFormulario(form: FormData): Promise<DatosSubida> {
  const texto = (clave: string): string => {
    const v = form.get(clave);
    if (typeof v !== 'string' || v.trim() === '') {
      throw new Error(`Falta el campo ${clave}.`);
    }
    return v.trim();
  };

  const numero = (clave: string): number => {
    const n = Number(texto(clave));
    // `Number('')` es 0 y `Number('x')` es NaN: los dos tienen que cortar acá y no
    // llegar como 0 a la base.
    if (!Number.isFinite(n)) throw new Error(`El campo ${clave} no es un número.`);
    return n;
  };

  const derivadas = new Map<number, Uint8Array>();
  for (const ancho of ANCHOS) {
    const archivo = form.get(`w${ancho}`);
    if (archivo === null) continue;
    if (typeof archivo === 'string' || typeof archivo.arrayBuffer !== 'function') {
      throw new Error(`El campo w${ancho} no es un archivo.`);
    }
    derivadas.set(ancho, new Uint8Array(await archivo.arrayBuffer()));
  }

  return {
    hash16: texto('hash16'),
    anchoOrigen: numero('anchoOrigen'),
    altoOrigen: numero('altoOrigen'),
    bytesOrigen: numero('bytesOrigen'),
    derivadas,
  };
}

export interface Resultado {
  hash16: string;
  /** `true` si el hash ya existía: no se subió nada. */
  reusada: boolean;
}

/**
 * Sube las derivadas y registra la imagen. Idempotente por hash.
 *
 * @param deps  ejecutor de D1 y balde de R2, inyectados para poder testear.
 */
export async function guardarImagen(
  { ejecutar, balde }: { ejecutar: Ejecutar; balde: BaldeR2 },
  datos: DatosSubida,
  { ahora }: { ahora: string }
): Promise<Resultado> {
  validarSubida(datos);
  const { hash16, anchoOrigen, altoOrigen, bytesOrigen, derivadas } = datos;

  /**
   * DEDUPE Y PROTECCIÓN, la misma consulta.
   *
   * Si el hash ya está, se reusa y NO se escribe nada — ni en R2 ni en la base. Es el
   * dedupe de §6.8 y, a la vez, lo que impide que un hash equivocado pise las fotos
   * de otro producto. Tampoco se actualizan los metadatos de origen: gana la primera
   * fila, que es la que de verdad corresponde a ese contenido.
   */
  const existentes = await ejecutar<{ hash16: string }>(
    `SELECT hash16 FROM imagenes WHERE hash16 = ?`,
    [hash16]
  );
  if (existentes.length > 0) {
    return { hash16, reusada: true };
  }

  /**
   * R2 PRIMERO, la fila después.
   *
   * Una fila sin sus objetos produce un `<img>` roto en el catálogo, que es
   * exactamente lo que `SPEC.md` §5.4 evita con el placeholder. Al revés — objetos
   * sin fila — sólo deja basura invisible en el bucket, que la purga de §12.3
   * recolecta. De los dos desórdenes posibles, se elige el que no se ve.
   */
  const anchos = [...derivadas.keys()].sort((a, b) => a - b);
  for (const ancho of anchos) {
    await balde.put(claveDeImagen(hash16, ancho), derivadas.get(ancho)!, {
      httpMetadata: { contentType: 'image/webp', cacheControl: CACHE_CONTROL },
    });
  }

  await ejecutar(
    `INSERT INTO imagenes (hash16, anchos, ancho_origen, alto_origen, bytes_origen, creado_en)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [hash16, JSON.stringify(anchos), anchoOrigen, altoOrigen, bytesOrigen, ahora]
  );

  return { hash16, reusada: false };
}
