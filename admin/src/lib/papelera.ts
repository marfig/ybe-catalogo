/**
 * Eliminar, restaurar y vaciar la papelera (SPEC-etapa2 §10.5, §12).
 *
 * LA REGLA, Y DEPENDE DE UNA SOLA COSA: **si el producto llegó a ser público.**
 *
 *   `importado` / `aprobado` → borrado FÍSICO, con sus imágenes huérfanas.
 *   `publicado`              → borrado LÓGICO: pasa a `eliminado`.
 *
 * El motivo no es el espacio. Con las cifras de §12.1, el free tier de R2 aguanta
 * ~33.000 productos muertos y el catálogo objetivo son 1.500: está tres órdenes de
 * magnitud lejos de ser un problema. Lo que se protege es **la URL**. El `slug` se
 * genera una sola vez (§5.2), así que borrar y recargar produce OTRA dirección y deja
 * la anterior muerta — y en un negocio cuyo canal es WhatsApp los enlaces viven para
 * siempre en conversaciones, donde un 404 no lo reporta nadie.
 *
 * Lo que nunca fue público no tiene nada de eso que preservar, y es además el 90 % del
 * inventario muerto: se importan 80 productos de un lanzamiento, se aprueban 30, y los
 * 50 restantes se borran de verdad.
 *
 * ATOMICIDAD, igual que en `transiciones.ts`: el lote NO es atómico. Cada producto se
 * resuelve con sentencias propias, así que ninguno queda a medias, pero un fallo en el
 * medio deja unos hechos y otros no. Por eso todo devuelve un resultado POR PRODUCTO y
 * las operaciones son idempotentes: reintentar es seguro.
 */
import type { Ejecutar } from './grilla.ts';
import type { ResultadoItem } from './transiciones.ts';

/** Meses que tiene que llevar en la papelera para que la purga lo alcance (§12.3). */
export const MESES_PURGA = 6;

/** Estados que nunca tuvieron URL pública: se borran de verdad (§12.2). */
const SIN_URL = new Set(['importado', 'aprobado']);

interface FilaProducto {
  id: number;
  codigo: string;
  estado: string;
  slug: string | null;
}

/** Marcas `?` para un `IN (…)`. D1 no acepta arrays como parámetro. */
const marcas = (n: number) => Array.from({ length: n }, () => '?').join(',');

/**
 * Los hashes de las imágenes que quedarían sin dueño si estos productos desaparecieran.
 *
 * El `NOT EXISTS` es la parte que importa: una foto que también cuelga de un producto
 * que SOBREVIVE no es huérfana. Pasa de verdad, y es el dedupe de `SPEC.md` §6.8
 * funcionando — la misma imagen puede pertenecer a variantes de productos distintos.
 * Sin este filtro, borrar un producto le arrancaría la foto a otro que sigue publicado.
 */
async function huerfanasDe(
  ejecutar: Ejecutar,
  ids: number[]
): Promise<{ id: number; hash16: string }[]> {
  if (ids.length === 0) return [];
  const m = marcas(ids.length);

  return ejecutar<{ id: number; hash16: string }>(
    `SELECT DISTINCT i.id, i.hash16
       FROM imagenes i
       JOIN variante_imagenes vi ON vi.imagen_id = i.id
       JOIN variantes v          ON v.id = vi.variante_id
      WHERE v.producto_id IN (${m})
        AND NOT EXISTS (
          SELECT 1
            FROM variante_imagenes vi2
            JOIN variantes v2 ON v2.id = vi2.variante_id
           WHERE vi2.imagen_id = i.id
             AND v2.producto_id NOT IN (${m})
        )
      ORDER BY i.hash16`,
    [...ids, ...ids]
  );
}

async function traerProductos(ejecutar: Ejecutar, ids: number[]): Promise<FilaProducto[]> {
  if (ids.length === 0) return [];
  return ejecutar<FilaProducto>(
    `SELECT id, codigo, estado, slug FROM productos WHERE id IN (${marcas(ids.length)})`,
    ids
  );
}

/** Por qué un producto no es candidato a eliminarse. */
function motivoOmision(estado: string): string {
  return estado === 'eliminado' ? 'ya está en la papelera' : `estado desconocido: ${estado}`;
}

export interface PlanFisico {
  id: number;
  codigo: string;
  /** Fotos que se van con él. Sólo las que no comparte con un producto que sobrevive. */
  fotos: number;
}

export interface PlanLogico {
  id: number;
  codigo: string;
  slug: string | null;
}

export interface PlanEliminacion {
  fisicos: PlanFisico[];
  logicos: PlanLogico[];
  omitidos: { id: number; codigo?: string; motivo: string }[];
}

/**
 * Qué va a pasar con cada producto, SIN tocar nada.
 *
 * Existe porque §12.2 exige que la confirmación diga qué va a pasar —«se va a borrar
 * definitivamente, junto con sus 4 fotos» contra «se va a sacar del catálogo»— y esos
 * dos mensajes no se pueden escribir sin consultar la base. Una confirmación genérica
 * pone la misma advertencia sobre la acción reversible y sobre la que no lo es.
 */
export async function planearEliminacion(
  ejecutar: Ejecutar,
  ids: number[]
): Promise<PlanEliminacion> {
  const plan: PlanEliminacion = { fisicos: [], logicos: [], omitidos: [] };
  if (ids.length === 0) return plan;

  const productos = await traerProductos(ejecutar, ids);
  const encontrados = new Set(productos.map((p) => p.id));

  // Un id que no está se REPORTA. Callarlo haría creer que se borró algo que no existía.
  for (const id of ids) {
    if (!encontrados.has(id)) plan.omitidos.push({ id, motivo: 'no existe' });
  }

  const fisicos = productos.filter((p) => SIN_URL.has(p.estado));
  const logicos = productos.filter((p) => p.estado === 'publicado');

  for (const p of productos) {
    if (!SIN_URL.has(p.estado) && p.estado !== 'publicado') {
      plan.omitidos.push({ id: p.id, codigo: p.codigo, motivo: motivoOmision(p.estado) });
    }
  }

  /**
   * Las huérfanas se calculan para el LOTE completo y después se reparten por producto.
   * Contarlas de a un producto diría que una foto sobrevive porque la usa otro producto
   * que también se está borrando.
   */
  const huerfanas = await huerfanasDe(
    ejecutar,
    fisicos.map((p) => p.id)
  );
  const idsHuerfanas = new Set(huerfanas.map((h) => h.id));

  for (const p of fisicos) {
    const suyas = await ejecutar<{ imagen_id: number }>(
      `SELECT DISTINCT vi.imagen_id
         FROM variante_imagenes vi
         JOIN variantes v ON v.id = vi.variante_id
        WHERE v.producto_id = ?`,
      [p.id]
    );
    plan.fisicos.push({
      id: p.id,
      codigo: p.codigo,
      fotos: suyas.filter((f) => idsHuerfanas.has(f.imagen_id)).length,
    });
  }

  for (const p of logicos) plan.logicos.push({ id: p.id, codigo: p.codigo, slug: p.slug });

  return plan;
}

export interface FilaPapelera {
  id: number;
  codigo: string;
  nombre: string | null;
  slug: string | null;
  eliminado_en: string | null;
  eliminado_por: string | null;
  /** hash16 de la foto que mostraba el sitio. `null` si no tiene. */
  miniatura: string | null;
}

/**
 * El contenido de la papelera (§10.5).
 *
 * Ordenado por fecha DESCENDENTE: lo recién sacado es lo que más chance tiene de haber
 * sido un error, y por lo tanto lo que se va a querer restaurar. Por código —el orden de
 * la grilla— lo último eliminado aparecería en cualquier lado.
 *
 * Las filas sin fecha van al final: son anteriores a la migración 0004 y no se puede
 * inventar cuándo se eliminaron.
 *
 * La miniatura sale con el MISMO orden que la grilla y que el volcado, para que la foto
 * de la papelera sea la que el sitio mostraba.
 */
export async function listarPapelera(
  ejecutar: Ejecutar,
  { limite = 200 }: { limite?: number } = {}
): Promise<FilaPapelera[]> {
  return ejecutar<FilaPapelera>(
    `SELECT p.id, p.codigo, p.nombre, p.slug, p.eliminado_en, p.eliminado_por,
            (SELECT i.hash16
               FROM variantes v
               JOIN variante_imagenes vi ON vi.variante_id = v.id
               JOIN imagenes i ON i.id = vi.imagen_id
              WHERE v.producto_id = p.id
              ORDER BY v.orden, v.color, v.sku, vi.orden, i.hash16
              LIMIT 1) AS miniatura
       FROM productos p
      WHERE p.estado = 'eliminado'
      ORDER BY p.eliminado_en IS NULL, p.eliminado_en DESC, p.codigo
      LIMIT ?`,
    [limite]
  );
}

export interface ResultadoEliminacion {
  resultados: ResultadoItem[];
  /**
   * hash16 de las imágenes que se borraron de la base y hay que borrar de R2.
   *
   * Este módulo no conoce el balde a propósito: así se testea sin nube. El ORDEN de las
   * dos bajas no es indistinto — primero la base, después R2. Al revés, un fallo entre
   * las dos dejaría filas apuntando a objetos que ya no están, o sea fotos rotas en el
   * catálogo. En este orden el peor caso es un objeto que nadie referencia: invisible,
   * y el espacio nunca fue el problema (§12.1).
   */
  huerfanas: string[];
}

/** Elimina cada producto según §12.2: físico si nunca fue público, lógico si lo fue. */
export async function eliminar(
  ejecutar: Ejecutar,
  ids: number[],
  { ahora, porQuien }: { ahora: string; porQuien: string }
): Promise<ResultadoEliminacion> {
  if (ids.length === 0) return { resultados: [], huerfanas: [] };

  const plan = await planearEliminacion(ejecutar, ids);
  const resultados: ResultadoItem[] = [];

  for (const o of plan.omitidos) {
    resultados.push({ id: o.id, codigo: o.codigo, desenlace: 'omitido', motivo: o.motivo });
  }

  const idsFisicos = plan.fisicos.map((p) => p.id);
  const huerfanas = await huerfanasDe(ejecutar, idsFisicos);

  if (idsFisicos.length > 0) {
    // El producto primero: arrastra `variantes` y con ellas `variante_imagenes`, las dos
    // por ON DELETE CASCADE. Recién con esas referencias fuera se pueden borrar las
    // filas de `imagenes`, que NO tienen cascade.
    await ejecutar(`DELETE FROM productos WHERE id IN (${marcas(idsFisicos.length)})`, idsFisicos);

    if (huerfanas.length > 0) {
      const idsImg = huerfanas.map((h) => h.id);
      await ejecutar(`DELETE FROM imagenes WHERE id IN (${marcas(idsImg.length)})`, idsImg);
    }

    for (const p of plan.fisicos) {
      resultados.push({ id: p.id, codigo: p.codigo, desenlace: 'hecho', motivo: 'borrado' });
    }
  }

  for (const p of plan.logicos) {
    /**
     * El `slug` NO se libera. La URL sigue siendo de este producto aunque no se muestre:
     * es lo que permite restaurarlo sin que el enlace cambie, y lo que evita que otro
     * producto se quede con una dirección que ya circuló.
     */
    await ejecutar(
      `UPDATE productos
          SET estado = 'eliminado', eliminado_en = ?, eliminado_por = ?, actualizado_en = ?
        WHERE id = ? AND estado = 'publicado'`,
      [ahora, porQuien, ahora, p.id]
    );
    resultados.push({
      id: p.id,
      codigo: p.codigo,
      desenlace: 'hecho',
      motivo: 'sacado del catálogo',
    });
  }

  return { resultados, huerfanas: huerfanas.map((h) => h.hash16) };
}

/**
 * Devuelve al catálogo lo que está en la papelera (§10.5).
 *
 * Vuelve a `publicado` y no a `aprobado`: el producto YA tuvo URL, y `aprobado` es el
 * estado de algo que todavía no la tuvo. Igual necesita una publicación para volver a
 * verse en el sitio — hasta entonces sigue en `productos.json` con `activo: false`.
 */
export async function restaurar(
  ejecutar: Ejecutar,
  ids: number[],
  { ahora }: { ahora: string }
): Promise<ResultadoItem[]> {
  if (ids.length === 0) return [];

  const productos = await traerProductos(ejecutar, ids);
  const porId = new Map(productos.map((p) => [p.id, p]));
  const resultados: ResultadoItem[] = [];

  for (const id of ids) {
    const p = porId.get(id);
    if (!p) {
      resultados.push({ id, desenlace: 'omitido', motivo: 'no existe' });
      continue;
    }
    if (p.estado !== 'eliminado') {
      // OMITIDO y no fallo: no hay nada que corregir en un producto que está en el
      // catálogo. Es la misma distinción que hace `aprobar` en `transiciones.ts`.
      resultados.push({
        id,
        codigo: p.codigo,
        desenlace: 'omitido',
        motivo: 'no está en la papelera',
      });
      continue;
    }

    await ejecutar(
      `UPDATE productos
          SET estado = 'publicado', eliminado_en = NULL, eliminado_por = NULL,
              actualizado_en = ?
        WHERE id = ? AND estado = 'eliminado'`,
      [ahora, id]
    );
    resultados.push({ id, codigo: p.codigo, desenlace: 'hecho', slug: p.slug ?? undefined });
  }

  return resultados;
}

/**
 * La fecha antes de la cual un `eliminado` es purgable (§12.3).
 *
 * PIEZA PURA, y con dos guardas que no son adorno porque **la purga es irreversible**:
 *
 *  - una fecha que no parsea daría `Invalid Date`, cuya comparación es siempre falsa en
 *    un sentido y verdadera en otro según cómo se escriba el `WHERE`. El modo de falla
 *    posible es barrer de más.
 *  - `meses = 0` purgaría lo que se acaba de eliminar, que es justo lo que la papelera
 *    existe para evitar.
 *
 * El día se fija DESPUÉS de mover el mes: `setUTCMonth` sobre un 31 en un mes de 30
 * rueda al siguiente, así que «31 de agosto menos 6 meses» daría «31 de febrero» = 3 de
 * marzo, y la purga se comería un mes extra.
 */
export function fechaDeCorte(ahora: string, meses: number = MESES_PURGA): string {
  if (!Number.isInteger(meses) || meses <= 0) {
    throw new Error(`Los meses de la purga tienen que ser un entero positivo: ${meses}.`);
  }

  const d = new Date(ahora);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Fecha inválida: ${JSON.stringify(ahora)}.`);
  }

  const dia = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - meses);

  // Último día del mes al que se llegó: `Date.UTC(año, mes + 1, 0)` es el día 0 del mes
  // siguiente, que es el último del actual.
  const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(dia, ultimo));

  return d.toISOString();
}

/**
 * Los `eliminado` que la purga alcanzaría.
 *
 * `eliminado_en IS NOT NULL` no es defensivo por costumbre: las filas que ya estaban
 * eliminadas antes de la migración 0004 no tienen fecha, y sin este filtro la primera
 * purga se llevaría todo lo histórico sin que su antigüedad se haya podido evaluar.
 */
async function purgablesDe(ejecutar: Ejecutar, antesDe: string): Promise<FilaProducto[]> {
  return ejecutar<FilaProducto>(
    `SELECT id, codigo, estado, slug FROM productos
      WHERE estado = 'eliminado' AND eliminado_en IS NOT NULL AND eliminado_en < ?
      ORDER BY codigo`,
    [antesDe]
  );
}

/** Qué se llevaría la purga, sin tocar nada. §12.3-3 lo exige antes de confirmar. */
export async function contarPurga(
  ejecutar: Ejecutar,
  { antesDe }: { antesDe: string }
): Promise<{ productos: number; imagenes: number; codigos: string[] }> {
  const purgables = await purgablesDe(ejecutar, antesDe);
  const huerfanas = await huerfanasDe(
    ejecutar,
    purgables.map((p) => p.id)
  );

  return {
    productos: purgables.length,
    imagenes: huerfanas.length,
    codigos: purgables.map((p) => p.codigo),
  };
}

/**
 * Vacía la papelera de lo más viejo que `antesDe` (§12.3).
 *
 * Es la única operación de este módulo que no tiene vuelta atrás: las URLs de esos
 * productos pasan de «no muestra el producto» a **404 definitivo**. Por eso es manual y
 * explícita, nunca automática, y por eso `contarPurga` existe.
 */
export async function purgar(
  ejecutar: Ejecutar,
  { antesDe }: { antesDe: string }
): Promise<{ codigos: string[]; huerfanas: string[] }> {
  const purgables = await purgablesDe(ejecutar, antesDe);
  if (purgables.length === 0) return { codigos: [], huerfanas: [] };

  const ids = purgables.map((p) => p.id);
  const huerfanas = await huerfanasDe(ejecutar, ids);

  await ejecutar(`DELETE FROM productos WHERE id IN (${marcas(ids.length)})`, ids);

  if (huerfanas.length > 0) {
    const idsImg = huerfanas.map((h) => h.id);
    await ejecutar(`DELETE FROM imagenes WHERE id IN (${marcas(idsImg.length)})`, idsImg);
  }

  return { codigos: purgables.map((p) => p.codigo), huerfanas: huerfanas.map((h) => h.hash16) };
}
