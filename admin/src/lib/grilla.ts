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

export type ValorFiltro =
  | 'por-aprobar'
  | 'aprobado'
  | 'publicado'
  | 'dados-de-baja'
  | 'eliminado'
  | 'todos';

/**
 * Opciones del filtro de estado, en el orden en que se muestran.
 *
 * `por-aprobar` va PRIMERO porque es el default: la cola de trabajo pendiente
 * (§10.3). Ocupa el lugar de la seccion `SIN CURAR` del reporte de SPEC.md §6.6,
 * pero en pantalla y accionable.
 *
 * Se llama «Por aprobar» y no «Sin completar» porque nombra la ACCION que falta, no
 * una carencia: la lista es una cola de trabajo y su nombre tiene que decir qué hacer.
 */
export const FILTROS = [
  { valor: 'por-aprobar', etiqueta: 'Por aprobar', estado: 'importado' },
  { valor: 'aprobado', etiqueta: 'Listos para publicar', estado: 'aprobado' },
  { valor: 'publicado', etiqueta: 'En el catálogo', estado: 'publicado' },
  /**
   * NO ES UN ESTADO, y por eso tiene `estado: null` sin ser «todos».
   *
   * Un producto puede estar publicado y dado de baja en el origen AL MISMO TIEMPO: son
   * dos ejes distintos. Meterlo en la máquina de estados de §5.2 obligaría a inventar un
   * quinto estado, a romper el `CHECK` del esquema y a decidir qué pasa cuando el
   * proveedor lo repone. La marca es ortogonal — `ausente_desde` — y esto es un filtro
   * sobre ella.
   */
  { valor: 'dados-de-baja', etiqueta: 'Ya no está en el proveedor', estado: null },
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
    etiqueta: 'Por aprobar',
    explicacion: 'No se ve en el sitio. Falta completarlo y aprobarlo.',
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
  descripcion: string | null;
  precio: number | null;
  /**
   * Si va en la portada (§4.3). BOOLEANO, aunque la columna sea INTEGER.
   *
   * La conversión se hace acá y no en la plantilla porque en JSX `checked={0}` es un
   * valor presente: un 0 crudo saldría tildado en las 50 filas.
   */
  destacado: boolean;
  estado: string;
  slug: string | null;
  categoria_origen: string | null;
  /** Desde cuándo el proveedor dejó de publicarlo. `null` = sigue estando. */
  ausente_desde: string | null;
  variantes: number;
  imagenes: number;
  /** hash16 de la foto que muestra el sitio por defecto. `null` si no hay. */
  miniatura: string | null;
  categorias: string[];
}

/**
 * Valor del filtro de categoría para «los que no tienen ninguna».
 *
 * Es la cola de curaduría más grande que hay: un producto recién scrapeado nace sin
 * categoría, y sin categoría no se puede aprobar (§5.2). Sin este valor habría que
 * recorrer la lista entera a ojo para encontrarlos.
 *
 * No colisiona con un slug real porque `categorias.json` no tiene ninguno así, y si
 * algún día lo tuviera el filtro dejaría de encontrarlo — por eso el nombre lleva el
 * guión que ningún nombre de categoría de negocio usaría.
 */
export const SIN_CATEGORIA = 'sin-categoria';

export interface Filtros {
  estado?: ValorFiltro;
  busqueda?: string;
  /**
   * Slug de categoría, `SIN_CATEGORIA`, o vacío para no filtrar.
   *
   * Un slug filtra por «tiene esta categoría en CUALQUIER posición», no sólo la
   * principal: las transversales —escolar, dama, fiesta— son secundarias en casi todos
   * los productos que las llevan, así que mirar sólo `categorias[0]` no encontraría
   * justamente lo que se está buscando.
   */
  categoria?: string;
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
  /**
   * Las bajas del proveedor cruzan los estados: se filtra por la marca, no por
   * `p.estado`. Excluye la papelera igual que "Todos" — un producto ya eliminado que
   * ademas no esta en el origen no es trabajo pendiente para nadie.
   */
  if (filtro.valor === 'dados-de-baja') {
    return { sql: SQL_DADOS_DE_BAJA, params: [] };
  }
  // "Todos" excluye la papelera a proposito (§10.3): los eliminados solo aparecen
  // con su filtro elegido.
  return { sql: "p.estado <> 'eliminado'", params: [] };
}

/** La condicion de "dado de baja en el origen". Compartida por el filtro y el conteo. */
const SQL_DADOS_DE_BAJA = `p.ausente_desde IS NOT NULL AND p.estado <> 'eliminado'`;

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
 * Condicion de categoria.
 *
 * Se resuelve con EXISTS y no con un JOIN, y es la decision que importa acá:
 *
 *  1. Un JOIN a `producto_categorias` duplica la fila del producto una vez por
 *     categoría que matchee, y habría que arreglarlo con DISTINCT o GROUP BY.
 *  2. Y sobre todo: el JOIN acotaría también las categorías que se traen. La segunda
 *     consulta de `listarProductos` las lee aparte, así que la columna de la grilla
 *     seguiría mostrando todas — pero el día que alguien las una en una sola consulta,
 *     un producto filtrado por «escolar» mostraría sólo «escolar» y guardar le pisaría
 *     el resto de la curaduría.
 *
 * EXISTS pregunta y no trae: acota las filas sin tocar lo que cada fila contiene.
 */
function condicionCategoria(categoria?: string): { sql: string; params: unknown[] } {
  const valor = (categoria ?? '').trim();
  if (valor === '') return { sql: '1 = 1', params: [] };

  if (valor === SIN_CATEGORIA) {
    return {
      sql: `NOT EXISTS (SELECT 1 FROM producto_categorias pc WHERE pc.producto_id = p.id)`,
      params: [],
    };
  }

  return {
    sql: `EXISTS (SELECT 1 FROM producto_categorias pc
                   WHERE pc.producto_id = p.id AND pc.categoria_slug = ?)`,
    params: [valor],
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
  { estado = FILTRO_POR_DEFECTO, busqueda, categoria, limite = 50, desplazamiento = 0 }: Filtros = {}
): Promise<FilaGrilla[]> {
  const e = condicionEstado(estado);
  const b = condicionBusqueda(busqueda);
  const c = condicionCategoria(categoria);

  // `destacado` llega como el 0/1 de la columna y se normaliza al final, junto con las
  // categorias: por eso el tipo de la consulta no es el de la fila.
  const filas = await ejecutar<
    Omit<FilaGrilla, 'categorias' | 'destacado'> & { destacado: number }
  >(
    `SELECT p.id, p.codigo, p.nombre, p.descripcion, p.precio, p.destacado,
            p.estado, p.slug, p.categoria_origen, p.ausente_desde,
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
      WHERE ${e.sql} AND ${b.sql} AND ${c.sql}
      -- Por codigo: estable entre corridas y es el dato que se tiene a mano.
      ORDER BY p.codigo
      LIMIT ? OFFSET ?`,
    [...e.params, ...b.params, ...c.params, limite, desplazamiento]
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

  return filas.map((f) => ({
    ...f,
    destacado: f.destacado === 1,
    categorias: porProducto.get(f.id) ?? [],
  }));
}

/** Los cuatro estados del esquema (§5.2), para que un conteo en 0 exista igual. */
const ESTADOS = ['importado', 'aprobado', 'publicado', 'eliminado'] as const;

export type ConteoPorEstado = Record<(typeof ESTADOS)[number], number> & {
  /**
   * Los dados de baja en el origen. Va aparte de los estados y no dentro, porque NO es
   * uno: se cruza con `publicado` y con `aprobado`, así que sumarlo al resto daría un
   * total mayor que el catálogo.
   */
  dadosDeBaja: number;
};

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
  /**
   * Los MISMOS acotes que la lista, y no sólo la búsqueda.
   *
   * Estos números van en el desplegable de estado. Si la lista se acota por categoría y
   * el conteo no, el desplegable ofrece «En el catálogo (4)» y al elegirlo aparece uno:
   * el contador y la lista dirían cosas distintas sobre la misma pantalla.
   */
  { busqueda, categoria }: Pick<Filtros, 'busqueda' | 'categoria'> = {}
): Promise<ConteoPorEstado> {
  const b = condicionBusqueda(busqueda);
  const c = condicionCategoria(categoria);
  const filas = await ejecutar<{ estado: string; cantidad: number }>(
    `SELECT p.estado, COUNT(*) AS cantidad
       FROM productos p
      WHERE ${b.sql} AND ${c.sql}
      GROUP BY p.estado`,
    [...b.params, ...c.params]
  );

  /**
   * Consulta aparte y no una columna más del `GROUP BY`: la baja en el origen no
   * particiona el catálogo como el estado, así que no puede salir del mismo agrupado
   * sin contar dos veces al mismo producto.
   */
  const [baja] = await ejecutar<{ cantidad: number }>(
    `SELECT COUNT(*) AS cantidad
       FROM productos p
      WHERE ${b.sql} AND ${c.sql} AND ${SQL_DADOS_DE_BAJA}`,
    [...b.params, ...c.params]
  );

  const conteo = {
    ...(Object.fromEntries(ESTADOS.map((e) => [e, 0])) as Record<
      (typeof ESTADOS)[number],
      number
    >),
    dadosDeBaja: baja?.cantidad ?? 0,
  } as ConteoPorEstado;

  for (const fila of filas) {
    if (fila.estado in conteo) conteo[fila.estado as keyof ConteoPorEstado] = fila.cantidad;
  }
  return conteo;
}
