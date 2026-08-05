/**
 * Consulta de la grilla de productos (SPEC-etapa2 §10.3).
 *
 * Mismo patron de ejecutor que el volcado: recibe `(sql, params) => filas` en vez de
 * una conexion. Asi el SQL corre contra D1 en produccion y contra `node:sqlite` con
 * la migracion real en los tests. D1 ES SQLite: lo que pasa los tests es lo que
 * corre en produccion.
 */

/** `(sql, params) => filas`. D1 y node:sqlite se adaptan a esta forma. */
export type Ejecutar = <T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
) => Promise<T[]>;

export type ValorFiltro = 'sin-completar' | 'aprobado' | 'publicado' | 'eliminado' | 'todos';

/**
 * Opciones del filtro de estado, en el orden en que se muestran.
 *
 * `sin-completar` va PRIMERO porque es el default: la cola de trabajo pendiente
 * (§10.3). Ocupa el lugar de la seccion `SIN CURAR` del reporte de SPEC.md §6.6,
 * pero en pantalla y accionable.
 */
export const FILTROS = [
  { valor: 'sin-completar', etiqueta: 'Sin completar', estado: 'importado' },
  { valor: 'aprobado', etiqueta: 'Listos para publicar', estado: 'aprobado' },
  { valor: 'publicado', etiqueta: 'En el catálogo', estado: 'publicado' },
  { valor: 'eliminado', etiqueta: 'Papelera', estado: 'eliminado' },
  { valor: 'todos', etiqueta: 'Todos', estado: null },
] as const satisfies ReadonlyArray<{
  valor: ValorFiltro;
  etiqueta: string;
  estado: string | null;
}>;

/**
 * Los cuatro estados en castellano, con lo que significan PARA QUIEN OPERA.
 *
 * El valor crudo de la columna (`importado`, `aprobado`...) es vocabulario del
 * esquema. La pantalla no puede pedirle a nadie que recuerde que "importado"
 * significa "todavia no se ve en el sitio": lo tiene que decir.
 *
 * Vive junto a `FILTROS` para que las etiquetas del filtro y las de la fila no se
 * puedan contradecir.
 */
export const ESTADOS_LEGIBLES = {
  importado: {
    etiqueta: 'Sin completar',
    explicacion: 'No se ve en el sitio. Le faltan datos.',
  },
  aprobado: {
    etiqueta: 'Listo para publicar',
    explicacion: 'Ya tiene todo, pero todavía no se ve: falta publicar.',
  },
  publicado: {
    etiqueta: 'En el catálogo',
    explicacion: 'Se ve en el sitio y tiene una dirección web en la calle.',
  },
  eliminado: {
    etiqueta: 'En la papelera',
    explicacion: 'Se sacó del catálogo. Su dirección web no queda rota.',
  },
} as const satisfies Record<string, { etiqueta: string; explicacion: string }>;

/** Etiqueta legible de un estado. Uno desconocido se muestra crudo, no se esconde. */
export function estadoLegible(estado: string): { etiqueta: string; explicacion: string } {
  return (
    ESTADOS_LEGIBLES[estado as keyof typeof ESTADOS_LEGIBLES] ?? {
      etiqueta: estado,
      explicacion: 'Estado desconocido: revisar la base.',
    }
  );
}

export const FILTRO_POR_DEFECTO: ValorFiltro = FILTROS[0].valor;

export interface FilaGrilla {
  id: number;
  codigo: string;
  nombre: string | null;
  precio: number | null;
  estado: string;
  slug: string | null;
  categoria_origen: string | null;
  variantes: number;
  imagenes: number;
  /** hash16 de la foto que muestra el sitio por defecto. `null` si no hay. */
  miniatura: string | null;
  categorias: string[];
}

export interface Filtros {
  estado?: ValorFiltro;
  busqueda?: string;
  limite?: number;
  desplazamiento?: number;
}

/**
 * Escapa los comodines de LIKE.
 *
 * Sin esto, un `%` tipeado por accidente trae TODO y se lee como que la busqueda no
 * filtra. El `\` se escapa primero para no romper los escapes que se agregan despues.
 */
function escaparLike(texto: string): string {
  return texto.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * Condicion de estado y sus parametros.
 *
 * Un estado desconocido REVIENTA. Degradar a "sin WHERE" mostraria los eliminados,
 * que es justo lo que §10.3 no quiere: se filtran, no se borran.
 */
function condicionEstado(valor: ValorFiltro): { sql: string; params: unknown[] } {
  const filtro = FILTROS.find((f) => f.valor === valor);
  if (!filtro) {
    throw new Error(
      `Filtro de estado desconocido: ${JSON.stringify(valor)}. ` +
        `Validos: ${FILTROS.map((f) => f.valor).join(', ')}.`
    );
  }
  if (filtro.estado !== null) {
    return { sql: 'p.estado = ?', params: [filtro.estado] };
  }
  // "Todos" excluye la papelera a proposito (§10.3): los eliminados solo aparecen
  // con su filtro elegido.
  return { sql: "p.estado <> 'eliminado'", params: [] };
}

/**
 * Condicion de busqueda por codigo o nombre.
 *
 * LIKE en SQLite es insensible a mayusculas solo para ASCII. Alcanza para el caso
 * principal — el codigo, que es lo que esa persona tiene a mano (§5.3) — y para
 * nombres sin acentos en la primera letra. Buscar "RIÑONERA" no matchea "Riñonera"
 * por la Ñ; se acepta y se documenta en vez de fingir que no pasa.
 */
function condicionBusqueda(busqueda?: string): { sql: string; params: unknown[] } {
  const termino = (busqueda ?? '').trim();
  if (termino === '') return { sql: '1 = 1', params: [] };

  const patron = `%${escaparLike(termino)}%`;
  return {
    sql: "(p.codigo LIKE ? ESCAPE '\\' OR p.nombre LIKE ? ESCAPE '\\')",
    params: [patron, patron],
  };
}

/**
 * Filas de la grilla.
 *
 * Las categorias se traen en una SEGUNDA consulta y se unen en JS, no con
 * `group_concat`: el orden de `group_concat` no esta especificado en SQLite, y
 * `categorias[0]` es el breadcrumb (§5.1). Un orden que "suele salir bien" no sirve
 * para algo que decide la navegacion.
 */
export async function listarProductos(
  ejecutar: Ejecutar,
  { estado = FILTRO_POR_DEFECTO, busqueda, limite = 50, desplazamiento = 0 }: Filtros = {}
): Promise<FilaGrilla[]> {
  const e = condicionEstado(estado);
  const b = condicionBusqueda(busqueda);

  const filas = await ejecutar<Omit<FilaGrilla, 'categorias'>>(
    `SELECT p.id, p.codigo, p.nombre, p.precio, p.estado, p.slug, p.categoria_origen,
            (SELECT COUNT(*) FROM variantes v WHERE v.producto_id = p.id) AS variantes,
            (SELECT COUNT(DISTINCT vi.imagen_id)
               FROM variantes v
               JOIN variante_imagenes vi ON vi.variante_id = v.id
              WHERE v.producto_id = p.id) AS imagenes,
            (SELECT i.hash16
               FROM variantes v
               JOIN variante_imagenes vi ON vi.variante_id = v.id
               JOIN imagenes i ON i.id = vi.imagen_id
              WHERE v.producto_id = p.id
              -- Mismo orden que usa el volcado para elegir variantes[0] y su
              -- primera foto: la miniatura de la grilla y la de la ficha publica
              -- tienen que ser la misma imagen.
              ORDER BY v.orden, v.color, v.sku, vi.orden, i.hash16
              LIMIT 1) AS miniatura
       FROM productos p
      WHERE ${e.sql} AND ${b.sql}
      -- Por codigo: estable entre corridas y es el dato que se tiene a mano.
      ORDER BY p.codigo
      LIMIT ? OFFSET ?`,
    [...e.params, ...b.params, limite, desplazamiento]
  );

  if (filas.length === 0) return [];

  const huecos = filas.map(() => '?').join(', ');
  const categorias = await ejecutar<{ producto_id: number; categoria_slug: string }>(
    `SELECT producto_id, categoria_slug
       FROM producto_categorias
      WHERE producto_id IN (${huecos})
      ORDER BY producto_id, orden, categoria_slug`,
    filas.map((f) => f.id)
  );

  const porProducto = new Map<number, string[]>();
  for (const c of categorias) {
    const lista = porProducto.get(c.producto_id) ?? [];
    lista.push(c.categoria_slug);
    porProducto.set(c.producto_id, lista);
  }

  return filas.map((f) => ({ ...f, categorias: porProducto.get(f.id) ?? [] }));
}

/** Los cuatro estados del esquema (§5.2), para que un conteo en 0 exista igual. */
const ESTADOS = ['importado', 'aprobado', 'publicado', 'eliminado'] as const;

export type ConteoPorEstado = Record<(typeof ESTADOS)[number], number>;

/**
 * Cuantos productos hay por estado, respetando la busqueda.
 *
 * Incluye `eliminado`: lo que §10.3 oculta es el CONTENIDO de la papelera, no su
 * existencia — el contador es como se llega a ella. Y devuelve los cuatro estados
 * siempre, con 0 donde no hay filas: un estado ausente obligaria a cada lector a
 * recordar el `?? 0`.
 */
export async function contarPorEstado(
  ejecutar: Ejecutar,
  busqueda?: string
): Promise<ConteoPorEstado> {
  const b = condicionBusqueda(busqueda);
  const filas = await ejecutar<{ estado: string; cantidad: number }>(
    `SELECT p.estado, COUNT(*) AS cantidad
       FROM productos p
      WHERE ${b.sql}
      GROUP BY p.estado`,
    b.params
  );

  const conteo = Object.fromEntries(ESTADOS.map((e) => [e, 0])) as ConteoPorEstado;
  for (const fila of filas) {
    if (fila.estado in conteo) conteo[fila.estado as keyof ConteoPorEstado] = fila.cantidad;
  }
  return conteo;
}
