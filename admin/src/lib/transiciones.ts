/**
 * Transiciones en lote de la grilla (SPEC-etapa2 §5.2, §10.3).
 *
 * Acá se ESCRIBE. Dos operaciones: aprobar y asignar categorías.
 *
 * ATOMICIDAD, dicho de frente: el lote SÍ es atómico, y antes no lo era. Las escrituras
 * se juntan y salen en un `EjecutarLote`, que es un viaje y una transacción: si una falla,
 * no queda ninguna aplicada. Antes cada producto se escribía con su propio `await` y un
 * fallo a la mitad dejaba unos cambiados y otros no.
 *
 * Cambió por rendimiento, no por corrección: escribiendo de a una, aprobar o categorizar
 * una página de 50 eran decenas de viajes en serie en un solo request, y el 2026-08-19 eso
 * —con una migración corriendo en paralelo— colgaba la pantalla. Ver `EjecutarLote`.
 *
 * LO QUE NO CAMBIÓ es que cada operación devuelve un resultado POR PRODUCTO: la validación
 * sigue decidiendo fila por fila antes de escribir, y `RETURNING` sigue distinguiendo al
 * producto cuyo estado cambió en el medio, porque el lote devuelve las filas de cada
 * sentencia por separado. Reintentar sigue siendo seguro: las dos operaciones son
 * idempotentes.
 */
import { validarParaAprobar } from './aprobacion.ts';
import type { Ejecutar, EjecutarLote, Sentencia } from './grilla.ts';
import { slugUnico, slugificar } from './slug.ts';

/**
 * Los tres desenlaces posibles de una transición. NO son dos.
 *
 * La distinción que falta cuando esto es un booleano: un producto que ya está en el
 * catálogo **no es un fallo de aprobación**, simplemente no era candidato. Meterlo en
 * la misma bolsa que uno al que le falta el nombre alarma por algo que no pasó y
 * esconde lo único accionable.
 *
 *  - `hecho`   — se hizo.
 *  - `omitido` — no era candidato. No hay nada que corregir.
 *  - `fallo`   — era candidato y no se pudo. Hay algo que corregir.
 */
export type Desenlace = 'hecho' | 'omitido' | 'fallo';

export interface ResultadoItem {
  id: number;
  codigo?: string;
  desenlace: Desenlace;
  /** Por qué. Presente en `omitido` y en `fallo`. */
  motivo?: string;
  /** El slug del producto tras aprobar. */
  slug?: string;
}

export interface OpcionesTransicion {
  categoriasValidas: ReadonlySet<string>;
  /**
   * Por donde salen las escrituras: todas juntas, en un viaje y una transaccion.
   *
   * Ver `EjecutarLote` en `grilla.ts`. Estas transiciones escribian de a una dentro de un
   * bucle, asi que aprobar o categorizar una pagina de 50 eran decenas de escrituras en
   * serie en un solo request — y el 2026-08-19 eso, sumado a una migracion corriendo,
   * colgaba la pantalla.
   */
  lote: EjecutarLote;
  /** Marca de tiempo a escribir. Inyectable para que los tests sean estables. */
  ahora: string;
  /** Confirmación explícita de aprobar sin foto (§5.2-3). */
  permitirSinFoto?: boolean;
  /**
   * Qué es un producto al que le falta algo para aprobarse.
   *
   * No cambia QUÉ se aprueba —la validación de §5.2 es la misma— sino cómo se REPORTA lo
   * que no se aprobó, y eso depende de quién eligió el lote:
   *
   *  - `false` (default) — lo tildó una persona, producto por producto. Afirmó que este
   *    debía aprobarse, así que si le falta algo es un **fallo**: hay algo que corregir.
   *  - `true` — la acción fue «aprobá lo que esté listo». Nadie afirmó nada sobre este
   *    producto en particular, así que si le falta algo es un **omitido**: no era
   *    candidato y no hay nada que corregir.
   *
   * Sin esta distinción, «Aprobar los completos» sobre una página de 50 con 12 listos
   * reportaría 38 fallos que nadie provocó, y ahogaría el único dato que se esperaba.
   */
  saltearIncompletos?: boolean;
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
  {
    categoriasValidas,
    ahora,
    lote,
    permitirSinFoto = false,
    saltearIncompletos = false,
  }: OpcionesTransicion
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

  /** Las escrituras, para mandarlas todas juntas al final. */
  const sentencias: Sentencia[] = [];
  /** Que fila pidio cada sentencia, y en que puesto de `resultados` va su desenlace. */
  const reservas: Array<{
    p: { id: number; codigo: string };
    slug: string;
    puesto: number;
    sentencia: number;
  }> = [];

  for (const p of productos) {
    // Sólo `importado` → `aprobado`. La máquina de estados de §5.2 no tiene otra
    // flecha hacia aprobado: desde `publicado` retrocedería un producto que ya está
    // en la calle, y desde `eliminado` la transición es restaurar, que es otra cosa.
    if (p.estado !== 'importado') {
      /**
       * OMITIDO, no fallo. Ya paso esta etapa: no hay nada que corregir.
       *
       * Es la distincion que el usuario noto: la grilla deja editar un producto
       * publicado — y esta bien, corregir un precio en vivo es la tarea mas comun —
       * pero aprobarlo no aplica. Reportarlo como fallo hacia parecer que editar y
       * aprobar se contradicen.
       */
      resultados.push({
        id: p.id,
        codigo: p.codigo,
        desenlace: 'omitido',
        motivo:
          p.estado === 'aprobado'
            ? 'ya estaba listo para publicar'
            : `ya está ${p.estado === 'publicado' ? 'en el catálogo' : 'en la papelera'}`,
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
      // El QUE no se aprueba es siempre el mismo; lo que cambia es si eso cuenta como
      // algo a corregir. Ver `saltearIncompletos`.
      resultados.push({
        id: p.id,
        codigo: p.codigo,
        desenlace: saltearIncompletos ? 'omitido' : 'fallo',
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
          desenlace: 'fallo',
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
    /**
     * La escritura se GUARDA para mandarla con las demas, y el resultado se resuelve
     * despues. Se reserva ya el lugar en `resultados` para no cambiar el orden en que se
     * reportan las filas: `resumir` muestra el motivo de la PRIMERA que fallo.
     */
    reservas.push({ p, slug, puesto: resultados.length, sentencia: sentencias.length });
    resultados.push({ id: p.id, codigo: p.codigo, desenlace: 'hecho', slug });
    sentencias.push({
      sql: `UPDATE productos
               SET estado = 'aprobado', slug = ?, actualizado_en = ?
             WHERE id = ? AND estado = 'importado'
             RETURNING id`,
      params: [slug, ahora, p.id],
    });
  }

  /**
   * Un viaje con las 50 escrituras, y recien ahi se lee que paso con cada una.
   *
   * `RETURNING` que vuelve vacio sigue siendo como se detecta que el estado cambio en el
   * medio: `batch()` devuelve las filas de cada sentencia por separado, asi que la guarda
   * optimista se mantiene fila por fila. Lo que cambia es que si una sentencia REVIENTA, no
   * queda ninguna aplicada — antes las anteriores quedaban. Es el mismo trato que
   * `guardarFilas`: para una accion de formulario, todas o ninguna.
   */
  if (sentencias.length > 0) {
    const filasPorSentencia = await lote<{ id: number }>(sentencias);

    for (const r of reservas) {
      if ((filasPorSentencia[r.sentencia] ?? []).length === 0) {
        resultados[r.puesto] = {
          id: r.p.id,
          codigo: r.p.codigo,
          desenlace: 'fallo',
          motivo: 'el estado cambió mientras se aprobaba; volver a intentar',
        };
      }
    }
  }

  // Los ids que no existen se reportan igual: un lote que los ignora en silencio
  // deja creer que se hizo algo con ellos.
  for (const id of ids) {
    if (!porId.has(id)) {
      resultados.push({ id, desenlace: 'fallo', motivo: 'no existe' });
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
  { categoriasValidas, ahora, lote }: OpcionesTransicion
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

  /** Las escrituras, para mandarlas todas juntas al final. */
  const sentencias: Sentencia[] = [];

  for (const p of productos) {
    const ya = existentes.get(p.id) ?? [];
    const nuevas = slugsCategorias.filter((c) => !ya.includes(c));

    if (nuevas.length > 0) {
      // El orden arranca después de las que ya tiene, para no mover el breadcrumb.
      let orden = ya.length;
      for (const categoria of nuevas) {
        sentencias.push({
          sql: `INSERT INTO producto_categorias (producto_id, categoria_slug, orden) VALUES (?, ?, ?)`,
          params: [p.id, categoria, orden],
        });
        orden++;
      }
      // Sin esto el volcado emitiría una fecha `actualizado` vieja para un producto
      // que sí cambió.
      sentencias.push({
        sql: `UPDATE productos SET actualizado_en = ? WHERE id = ?`,
        params: [ahora, p.id],
      });
    }

    // Sin categorias nuevas no se escribio nada: omitido, no hecho.
    resultados.push({
      id: p.id,
      codigo: p.codigo,
      desenlace: nuevas.length > 0 ? 'hecho' : 'omitido',
      motivo: nuevas.length > 0 ? undefined : 'ya tenía esa categoría',
    });
  }

  for (const id of ids) {
    if (!porId.has(id)) resultados.push({ id, desenlace: 'fallo', motivo: 'no existe' });
  }

  /**
   * Un viaje con todas las categorias del lote. Si un producto ya las tenia no aporto
   * ninguna sentencia, asi que asignar algo que ya estaba no le cuesta nada a la base.
   */
  if (sentencias.length > 0) await lote(sentencias);

  return resultados;
}
