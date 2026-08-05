/**
 * Adaptador de D1 al ejecutor que usan las consultas.
 *
 * Existe para que `grilla.ts` no dependa de la API de D1: recibe
 * `(sql, params) => Promise<filas>` y con eso el mismo SQL corre contra D1 en
 * produccion y contra `node:sqlite` en los tests, sobre la migracion real.
 */
import type { Ejecutar } from './grilla.ts';

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
