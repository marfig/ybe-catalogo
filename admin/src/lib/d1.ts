/**
 * Adaptador de D1 al ejecutor que usan las consultas.
 *
 * Existe para que `grilla.ts` no dependa de la API de D1: recibe
 * `(sql, params) => Promise<filas>` y con eso el mismo SQL corre contra D1 en
 * produccion y contra `node:sqlite` en los tests, sobre la migracion real.
 */
import type { Ejecutar, EjecutarLote, Sentencia } from './grilla.ts';

/** Envuelve un `D1Database` en un ejecutor. */
export function ejecutorD1(db: D1Database): Ejecutar {
  return async <T>(sql: string, params: unknown[] = []) => {
    const { results } = await db
      .prepare(sql)
      .bind(...params)
      .all<T>();
    return results;
  };
}

/**
 * Varias sentencias en UN viaje y UNA transacción, con `D1Database.batch()`.
 *
 * Ver `EjecutarLote` en `grilla.ts` para el por qué: el costo de escribir en D1 está en la
 * cantidad de viajes y no en el SQL, y las acciones en lote de la grilla hacían unas 200
 * escrituras en serie por cada página guardada.
 *
 * `batch()` corre las sentencias en orden y en una transacción implícita: si una falla,
 * ninguna queda aplicada. Eso es lo que le da atomicidad al `DELETE`+`INSERT` de las
 * categorías, que antes podía quedar a medias.
 */
export function loteD1(db: D1Database): EjecutarLote {
  return async <T>(sentencias: readonly Sentencia[]) => {
    // `batch([])` no está especificado y no hace falta averiguarlo: sin sentencias no hay
    // nada que mandar, y un viaje de ida y vuelta para nada es justo lo que se vino a
    // sacar.
    if (sentencias.length === 0) return [];

    const resultados = await db.batch<T>(
      sentencias.map((s) => db.prepare(s.sql).bind(...(s.params ?? [])))
    );

    // `results` puede venir sin definir en una sentencia que no devuelve filas. Se
    // normaliza a lista vacía: quien llama empareja por posición y un hueco lo rompería.
    return resultados.map((r) => r.results ?? []);
  };
}

/**
 * La misma cosa contra `node:sqlite`, para los tests.
 *
 * NO ES UN DOBLE: es la implementación que hace que los tests de `guardar.ts` y
 * `transiciones.ts` ejerciten el MISMO camino de código que corre en producción, con la
 * migración real. `batch()` es API de Workers y no existe en Node, así que el contrato —
 * filas de cada sentencia en orden, y todo o nada— se cumple acá con una transacción
 * explícita.
 *
 * Vive al lado de `loteD1` a propósito: si alguna vez las dos dejan de comportarse igual,
 * que sea evidente leyendo un solo archivo.
 *
 * El tipo se declara suelto y no como `DatabaseSync` para no importar `node:sqlite` en un
 * módulo que se bundlea para el Worker.
 */
interface BaseSincronica {
  prepare(sql: string): { all(...params: never[]): unknown[] };
  exec(sql: string): void;
}

export function loteSqlite(db: BaseSincronica): EjecutarLote {
  return async <T>(sentencias: readonly Sentencia[]) => {
    if (sentencias.length === 0) return [];

    db.exec('BEGIN');
    try {
      const filas = sentencias.map(
        (s) => db.prepare(s.sql).all(...((s.params ?? []) as never[])) as T[]
      );
      db.exec('COMMIT');
      return filas;
    } catch (error) {
      // Si el ROLLBACK también falla, el error que importa es el primero: es el que dice
      // qué sentencia rompió.
      try {
        db.exec('ROLLBACK');
      } catch {
        // Sin transacción abierta no hay nada que revertir.
      }
      throw error;
    }
  };
}
