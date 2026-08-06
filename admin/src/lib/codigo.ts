/**
 * El código como identidad del producto (SPEC-etapa2 §5.3, §7.5, §9).
 *
 * Pieza COMPARTIDA por los dos caminos que crean productos: el formulario manual, que
 * ante un código existente ofrece editar ese producto en vez de fallar (§9), y el
 * scrape, que hace `UPDATE` y no `INSERT` (§7.5). Los dos tienen que preguntar por el
 * código ANTES de insertar.
 *
 * POR QUÉ NO ALCANZA EL `UNIQUE` DE LA COLUMNA, que es lo que uno supondría:
 *
 *  1. SQLite compara TEXT con collation BINARY, así que `CG85527` y `cg85527` son
 *     valores distintos y **entran los dos**. Verificado sobre el esquema, no
 *     supuesto. El resultado sería un producto duplicado creado por tipear en
 *     minúscula: dos filas, dos slugs, dos URLs en la calle.
 *  2. Aunque no fuera así, el `UNIQUE` produce un error crudo de SQLite, y §10 pide
 *     que ningún mensaje del admin lo sea.
 *
 * La red de la base existe igual — el índice único sobre `upper(codigo)` de la
 * migración 0002 — porque una consulta previa no cubre la carrera entre dos pestañas
 * insertando a la vez. Pero la red no es la lógica.
 */
import type { Ejecutar } from './grilla.ts';

/** Tope de largo. Los del proveedor son `CG` + 5 dígitos; 40 es holgado de sobra. */
const LARGO_MAXIMO = 40;

/** Letras, dígitos, guion y guion bajo. Nada más entra en un código. */
const RE_CODIGO = /^[A-Z0-9_-]+$/;

/**
 * Forma canónica de un código: recortado y en mayúsculas.
 *
 * Los espacios de los BORDES se sacan — son artefactos de copiar y pegar — pero los
 * de adentro se RECHAZAN: sacarlos cambiaría en silencio lo que la persona escribió,
 * y «CG 855 27» es casi siempre un error de tipeo, no un código con espacios.
 */
export function normalizarCodigo(texto: string): string {
  const limpio = (texto ?? '').trim().toUpperCase();

  if (limpio === '') {
    throw new Error('El código no puede estar vacío: es la identidad del producto.');
  }
  if (limpio.length > LARGO_MAXIMO) {
    throw new Error(`El código es demasiado largo (máximo ${LARGO_MAXIMO} caracteres).`);
  }
  if (/\s/.test(limpio)) {
    throw new Error(`El código no puede llevar espacios: ${JSON.stringify(texto)}.`);
  }
  if (!RE_CODIGO.test(limpio)) {
    throw new Error(
      `Código inválido: ${JSON.stringify(texto)}. Sólo letras, números, guion y guion bajo.`
    );
  }
  return limpio;
}

export interface ProductoExistente {
  id: number;
  codigo: string;
  nombre: string | null;
  slug: string | null;
  /** Decide qué ofrece el formulario y qué puede pisar el scrape (§7.5). */
  estado: string;
}

/**
 * El producto con ese código, o `null`.
 *
 * La comparación es por `upper()` en los dos lados, igual que el índice de la
 * migración 0002: buscar con la collation por defecto no encontraría `CG85527`
 * escribiendo `cg85527`, el formulario insertaría uno nuevo y quedarían dos productos
 * con dos URLs para la misma cosa.
 *
 * Un código inválido devuelve `null` en vez de lanzar: buscar es una consulta, no un
 * alta, y que el formulario explote mientras alguien todavía está tipeando sería peor
 * que no encontrar nada. Quien valida de verdad es el alta.
 */
export async function buscarPorCodigo(
  ejecutar: Ejecutar,
  codigo: string
): Promise<ProductoExistente | null> {
  let normalizado: string;
  try {
    normalizado = normalizarCodigo(codigo);
  } catch {
    return null;
  }

  const filas = await ejecutar<ProductoExistente>(
    `SELECT id, codigo, nombre, slug, estado
       FROM productos
      WHERE upper(codigo) = ?
      LIMIT 1`,
    [normalizado]
  );
  return filas[0] ?? null;
}
