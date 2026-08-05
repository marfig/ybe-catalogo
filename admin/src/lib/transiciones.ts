/**
 * Transiciones en lote de la grilla (SPEC-etapa2 §5.2, §10.3).
 *
 * Acá se ESCRIBE. Dos operaciones: aprobar y asignar categorías.
 *
 * ATOMICIDAD, dicho de frente: el lote NO es atómico. Cada producto se actualiza con
 * una sola sentencia, así que ningún producto queda a medias — pero si el lote falla
 * en el medio, unos quedan cambiados y otros no. Por eso cada operación devuelve un
 * resultado POR PRODUCTO en vez de un booleano: la pantalla puede decir exactamente
 * qué pasó con cada uno, y reintentar es seguro porque las dos operaciones son
 * idempotentes.
 */
import { validarParaAprobar } from './aprobacion.ts';
import type { Ejecutar } from './grilla.ts';
import { slugUnico, slugificar } from './slug.ts';

export interface ResultadoItem {
  id: number;
  codigo?: string;
  ok: boolean;
  /** Por qué NO se pudo. Presente sólo cuando `ok` es false. */
  motivo?: string;
  /** El slug del producto tras aprobar. */
  slug?: string;
}

export interface OpcionesTransicion {
  categoriasValidas: ReadonlySet<string>;
  /** Marca de tiempo a escribir. Inyectable para que los tests sean estables. */
  ahora: string;
  /** Confirmación explícita de aprobar sin foto (§5.2-3). */
  permitirSinFoto?: boolean;
}

/** Datos mínimos para validar y transicionar. */
interface FilaProducto {
  id: number;
  codigo: string;
  nombre: string | null;
  precio: number | null;
  estado: string;
  slug: string | null;
  variantes: number;
  imagenes: number;
}

const huecos = (n: number) => Array.from({ length: n }, () => '?').join(', ');

/** Los productos del lote, con los agregados que la validación necesita. */
async function traerProductos(ejecutar: Ejecutar, ids: number[]): Promise<FilaProducto[]> {
  return ejecutar<FilaProducto>(
    `SELECT p.id, p.codigo, p.nombre, p.precio, p.estado, p.slug,
            (SELECT COUNT(*) FROM variantes v WHERE v.producto_id = p.id) AS variantes,
            (SELECT COUNT(DISTINCT vi.imagen_id)
               FROM variantes v
               JOIN variante_imagenes vi ON vi.variante_id = v.id
              WHERE v.producto_id = p.id) AS imagenes
       FROM productos p
      WHERE p.id IN (${huecos(ids.length)})
      -- Por codigo: el orden decide qué producto se queda con el slug sin sufijo
      -- cuando dos comparten nombre, y eso no puede depender del orden en que la
      -- pantalla mandó los ids.
      ORDER BY p.codigo`,
    ids
  );
}

/** Categorías por producto, en su orden. */
async function traerCategorias(
  ejecutar: Ejecutar,
  ids: number[]
): Promise<Map<number, string[]>> {
  const filas = await ejecutar<{ producto_id: number; categoria_slug: string }>(
    `SELECT producto_id, categoria_slug
       FROM producto_categorias
      WHERE producto_id IN (${huecos(ids.length)})
      ORDER BY producto_id, orden, categoria_slug`,
    ids
  );
  const mapa = new Map<number, string[]>();
  for (const f of filas) {
    const lista = mapa.get(f.producto_id) ?? [];
    lista.push(f.categoria_slug);
    mapa.set(f.producto_id, lista);
  }
  return mapa;
}

/**
 * Aprueba los productos del lote que pasan las validaciones de §5.2.
 *
 * Un lote mixto aprueba los válidos y reporta los inválidos: cortar todo por uno
 * obligaría a des-seleccionar de a uno hasta dar con el que molesta (§10.3).
 */
export async function aprobar(
  ejecutar: Ejecutar,
  ids: number[],
  { categoriasValidas, ahora, permitirSinFoto = false }: OpcionesTransicion
): Promise<ResultadoItem[]> {
  if (ids.length === 0) return [];

  const productos = await traerProductos(ejecutar, ids);
  const categorias = await traerCategorias(ejecutar, ids);

  /**
   * TODOS los slugs de la base, no sólo los del lote.
   *
   * El UNIQUE es global, así que un slug libre dentro del lote puede estar tomado por
   * un producto que no se está aprobando. Con 1.500 productos son 1.500 cadenas
   * cortas: cabe de sobra y evita una consulta por producto.
   */
  const tomados = new Set(
    (await ejecutar<{ slug: string }>(`SELECT slug FROM productos WHERE slug IS NOT NULL`)).map(
      (f) => f.slug
    )
  );

  const porId = new Map(productos.map((p) => [p.id, p]));
  const resultados: ResultadoItem[] = [];

  for (const p of productos) {
    // Sólo `importado` → `aprobado`. La máquina de estados de §5.2 no tiene otra
    // flecha hacia aprobado: desde `publicado` retrocedería un producto que ya está
    // en la calle, y desde `eliminado` la transición es restaurar, que es otra cosa.
    if (p.estado !== 'importado') {
      resultados.push({
        id: p.id,
        codigo: p.codigo,
        ok: false,
        motivo:
          p.estado === 'aprobado'
            ? 'ya estaba aprobado'
            : `no se puede aprobar desde el estado "${p.estado}"`,
      });
      continue;
    }

    const validacion = validarParaAprobar(
      {
        codigo: p.codigo,
        nombre: p.nombre,
        precio: p.precio,
        categorias: categorias.get(p.id) ?? [],
        variantes: p.variantes === 0 ? [] : [{ sku: p.codigo, color: '', imagenes: p.imagenes }],
      },
      { categoriasValidas, permitirSinFoto }
    );

    if (!validacion.puede) {
      resultados.push({
        id: p.id,
        codigo: p.codigo,
        ok: false,
        motivo: validacion.faltantes.join(', '),
      });
      continue;
    }

    /**
     * Si ya tiene slug se REUSA. El slug se genera una sola vez y desde ahí es la URL
     * del producto para siempre (§5.2): regenerarlo rompería enlaces que viven en
     * conversaciones de WhatsApp que nadie va a corregir.
     */
    let slug = p.slug;
    if (slug === null) {
      try {
        slug = slugUnico(slugificar(p.nombre ?? ''), tomados);
      } catch (error) {
        resultados.push({
          id: p.id,
          codigo: p.codigo,
          ok: false,
          motivo: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      // Se reserva ANTES de escribir: dos productos del mismo lote con el mismo
      // nombre generan sus slugs antes de que ninguno esté en la base, y sin esto el
      // UNIQUE rechazaría al segundo.
      tomados.add(slug);
    }

    /**
     * El `AND estado = 'importado'` es una guarda optimista: si algo cambió el estado
     * entre la lectura y esta escritura, la fila no se actualiza y se reporta en vez
     * de pisar un estado más nuevo.
     *
     * `publicado_en` NO se toca: se sella en la publicación, no al aprobar (§5.2).
     */
    const filas = await ejecutar<{ id: number }>(
      `UPDATE productos
          SET estado = 'aprobado', slug = ?, actualizado_en = ?
        WHERE id = ? AND estado = 'importado'
        RETURNING id`,
      [slug, ahora, p.id]
    );

    if (filas.length === 0) {
      resultados.push({
        id: p.id,
        codigo: p.codigo,
        ok: false,
        motivo: 'el estado cambió mientras se aprobaba; volver a intentar',
      });
      continue;
    }

    resultados.push({ id: p.id, codigo: p.codigo, ok: true, slug });
  }

  // Los ids que no existen se reportan igual: un lote que los ignora en silencio
  // deja creer que se hizo algo con ellos.
  for (const id of ids) {
    if (!porId.has(id)) {
      resultados.push({ id, ok: false, motivo: 'no existe' });
    }
  }

  return resultados;
}

/**
 * Agrega categorías a varios productos de una vez (§10.3).
 *
 * AGREGA, no reemplaza. Reemplazar destruiría curaduría en silencio, y agregar al
 * final deja el breadcrumb donde estaba — `categorias[0]` es el breadcrumb (§5.1).
 *
 * LANZA si la entrada es inválida, en vez de reportar por producto: es UNA elección
 * del usuario aplicada a muchos, así que un slug mal escrito no puede quedar
 * aplicado a medias. Se valida antes de tocar la base.
 */
export async function asignarCategorias(
  ejecutar: Ejecutar,
  ids: number[],
  slugsCategorias: string[],
  { categoriasValidas, ahora }: OpcionesTransicion
): Promise<ResultadoItem[]> {
  if (slugsCategorias.length === 0) {
    throw new Error('No se eligió ninguna categoría para asignar.');
  }
  const invalidas = slugsCategorias.filter((c) => !categoriasValidas.has(c));
  if (invalidas.length > 0) {
    throw new Error(
      `Categorías inexistentes: ${invalidas.join(', ')}. ` +
        'Tienen que estar en src/data/categorias.json.'
    );
  }
  if (ids.length === 0) return [];

  const productos = await ejecutar<{ id: number; codigo: string }>(
    `SELECT id, codigo FROM productos WHERE id IN (${huecos(ids.length)}) ORDER BY codigo`,
    ids
  );
  const existentes = await traerCategorias(ejecutar, ids);
  const porId = new Map(productos.map((p) => [p.id, p]));
  const resultados: ResultadoItem[] = [];

  for (const p of productos) {
    const ya = existentes.get(p.id) ?? [];
    const nuevas = slugsCategorias.filter((c) => !ya.includes(c));

    if (nuevas.length > 0) {
      // El orden arranca después de las que ya tiene, para no mover el breadcrumb.
      let orden = ya.length;
      for (const categoria of nuevas) {
        await ejecutar(
          `INSERT INTO producto_categorias (producto_id, categoria_slug, orden) VALUES (?, ?, ?)`,
          [p.id, categoria, orden]
        );
        orden++;
      }
      // Sin esto el volcado emitiría una fecha `actualizado` vieja para un producto
      // que sí cambió.
      await ejecutar(`UPDATE productos SET actualizado_en = ? WHERE id = ?`, [ahora, p.id]);
    }

    resultados.push({ id: p.id, codigo: p.codigo, ok: true });
  }

  for (const id of ids) {
    if (!porId.has(id)) resultados.push({ id, ok: false, motivo: 'no existe' });
  }

  return resultados;
}
