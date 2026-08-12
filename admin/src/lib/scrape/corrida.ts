/**
 * La corrida de scrape: la fila de `scrapes` y su contabilidad (SPEC-etapa2 §7.5, §10.2).
 *
 * El bucle vive en el navegador (§7.1), así que la corrida es lo ÚNICO que sobrevive a
 * que se cierre la pestaña. Sin esta tabla, un scrape interrumpido no deja rastro de
 * qué llegó a entrar ni de qué falló.
 */
import type { Ejecutar } from '../grilla.ts';

/**
 * Qué clase de recorrido es.
 *
 * `importacion` trae productos del proveedor; `barrido` le pregunta por los que ya
 * tenemos. Comparten tabla para compartir la guarda de `corridaEnCurso`: el paso de 1
 * request por segundo (§7.4) lo marca cada pestaña por su cuenta, así que dos
 * recorridos simultáneos se lo duplican al proveedor aunque sean de tipos distintos.
 */
/**
 * `migracion` es la del catálogo viejo y es DE UN SOLO USO: sale de esta unión cuando esa
 * migración termine, junto con `lib/migracion/`. Está acá y no como un `'importacion'`
 * disfrazado porque `scrapes` es de donde alguien va a leer, dentro de seis meses, qué
 * pasó con esos 189 productos.
 *
 * Los dos lugares que se ramifican por esto —`api/scrape/abrir.ts` y `barrido.astro`—
 * preguntan por `'barrido'` y caen al otro lado, así que una migración en curso se anuncia
 * como una importación. Es un mensaje impreciso y no un bug: lo que importa de esa guarda
 * es que NO se pueda abrir un segundo recorrido, y eso vale igual para los tres tipos.
 */
export type TipoCorrida = 'importacion' | 'barrido' | 'migracion';

export interface Corrida {
  id: number;
  url: string;
  tipo: TipoCorrida;
  estado: 'corriendo' | 'terminado' | 'abortado';
  paginas: number;
  hallados: number;
  nuevos: number;
  repetidos: number;
  iniciado_en: string;
  terminado_en: string | null;
}

export interface Resumen extends Corrida {
  errores: number;
}

/**
 * ¿Hay una corrida abierta?
 *
 * IMPORTA DE VERDAD: dos pestañas scrapeando a la vez DUPLICAN el paso al proveedor, y
 * el límite de 1 request por segundo (§7.4) lo marca el navegador. Una segunda corrida
 * no es sólo desprolija — rompe la cortesía sin que nadie se entere.
 *
 * `ahora` entra por parámetro: una corrida vieja que quedó abierta porque se cerró la
 * pestaña no puede bloquear el admin para siempre.
 */
export async function corridaEnCurso(
  ejecutar: Ejecutar,
  { ahora, toleranciaMinutos = 30 }: { ahora: string; toleranciaMinutos?: number }
): Promise<Corrida | null> {
  const [fila] = await ejecutar<Corrida>(
    `SELECT * FROM scrapes WHERE estado = 'corriendo' ORDER BY id DESC LIMIT 1`
  );
  if (!fila) return null;

  const edad = Date.parse(ahora) - Date.parse(fila.iniciado_en);
  // Una corrida abandonada se considera muerta y deja de estorbar.
  if (Number.isFinite(edad) && edad > toleranciaMinutos * 60_000) return null;

  return fila;
}

/** Abre la corrida. `paginas` es el total que dijo el listado. */
export async function iniciarCorrida(
  ejecutar: Ejecutar,
  {
    url,
    paginas,
    ahora,
    tipo = 'importacion',
  }: { url: string; paginas: number; ahora: string; tipo?: TipoCorrida }
): Promise<number> {
  const [fila] = await ejecutar<{ id: number }>(
    `INSERT INTO scrapes (url, tipo, estado, paginas, iniciado_en)
     VALUES (?, ?, 'corriendo', ?, ?) RETURNING id`,
    [url, tipo, paginas, ahora]
  );
  return fila.id;
}

/**
 * Cuenta un producto revisado por el barrido.
 *
 * Sube `hallados` y NADA MÁS. `nuevos` y `repetidos` son de la importación y significan
 * «productos que entraron al catálogo»; reusarlas para contar presentes y ausentes
 * sería ponerle a la misma columna dos sentidos según quién la escribió, y el resumen
 * de §10.2 diría cualquier cosa al mezclarse las corridas.
 *
 * El barrido no necesita más contadores en la base porque **su progreso ES la base**:
 * `revisado_en_origen` dice qué se revisó y `ausente_desde` qué se encontró, así que
 * una corrida cortada a la mitad no pierde nada y la siguiente sigue sola.
 */
export async function contarRevisado(ejecutar: Ejecutar, scrapeId: number): Promise<void> {
  await ejecutar(`UPDATE scrapes SET hallados = hallados + 1 WHERE id = ?`, [scrapeId]);
}

/**
 * Cuenta una ficha procesada.
 *
 * `hallados` sube siempre; `nuevos` o `repetidos` según haya entrado un producto que
 * no existía. Se hace en la base y no en el navegador porque el navegador se puede
 * cerrar en cualquier momento.
 */
export async function contarFicha(
  ejecutar: Ejecutar,
  scrapeId: number,
  { creado }: { creado: boolean }
): Promise<void> {
  await ejecutar(
    `UPDATE scrapes
        SET hallados  = hallados + 1,
            nuevos    = nuevos + ?,
            repetidos = repetidos + ?
      WHERE id = ?`,
    [creado ? 1 : 0, creado ? 0 : 1, scrapeId]
  );
}

/**
 * Una ficha que no se pudo leer. **No aborta la corrida** (§7.4).
 *
 * El proveedor tiene fichas caídas y respuestas raras; que una tanda de 64 productos
 * se pierda entera por una es peor que importar 63 y listar la que falló.
 */
export async function anotarError(
  ejecutar: Ejecutar,
  scrapeId: number,
  { url, motivo, ahora }: { url: string; motivo: string; ahora: string }
): Promise<void> {
  await ejecutar(
    `INSERT INTO scrape_errores (scrape_id, url, motivo, creado_en) VALUES (?, ?, ?, ?)`,
    [scrapeId, url, motivo.slice(0, 500), ahora]
  );
}

/** Cierra la corrida y devuelve el resumen de §10.2. */
export async function cerrarCorrida(
  ejecutar: Ejecutar,
  scrapeId: number,
  { ahora, estado = 'terminado' }: { ahora: string; estado?: 'terminado' | 'abortado' }
): Promise<Resumen> {
  await ejecutar(`UPDATE scrapes SET estado = ?, terminado_en = ? WHERE id = ?`, [
    estado,
    ahora,
    scrapeId,
  ]);
  return resumenDe(ejecutar, scrapeId);
}

export async function resumenDe(ejecutar: Ejecutar, scrapeId: number): Promise<Resumen> {
  const [corrida] = await ejecutar<Corrida>(`SELECT * FROM scrapes WHERE id = ?`, [scrapeId]);
  if (!corrida) throw new Error(`No existe la corrida ${scrapeId}.`);

  const [{ errores }] = await ejecutar<{ errores: number }>(
    `SELECT count(*) AS errores FROM scrape_errores WHERE scrape_id = ?`,
    [scrapeId]
  );
  return { ...corrida, errores };
}

/**
 * ¿Ya se visitó esta ficha en esta corrida?
 *
 * Los colores hermanos se descubren desde la ficha de cualquiera de ellos, así que sin
 * este corte el mismo modelo se pediría una vez por color: tres requests al proveedor
 * para traer exactamente lo mismo (§7.2).
 */
export async function codigoYaVisto(
  ejecutar: Ejecutar,
  scrapeId: number,
  codigo: string
): Promise<boolean> {
  const [fila] = await ejecutar<{ id: number }>(
    `SELECT id FROM productos WHERE upper(codigo) = upper(?) AND scrape_id = ?`,
    [codigo, scrapeId]
  );
  return Boolean(fila);
}
