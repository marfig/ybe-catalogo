/**
 * Guardado en línea de la grilla (SPEC-etapa2 §10.3).
 *
 * El trabajo real del admin es rellenar nombre, precio y categoría — que son
 * exactamente las validaciones de §5.2 — así que se editan en la propia lista y no en
 * una pantalla aparte. Lo pesado (fotos y colores) vive en §10.4.
 *
 * `descripcion` y `destacado` se sumaron después: son los dos campos que se cargan
 * PRODUCTO POR PRODUCTO al armar la portada, y mandar a abrir y cerrar una ficha por
 * cada uno es el viaje que esta pantalla existe para evitar. No entran en las
 * validaciones de §5.2 — un producto sin descripción se publica igual — así que no
 * pueden hacer fallar una fila; sólo se guardan.
 *
 * Dos invariantes sostienen todo lo demás:
 *
 *  1. **Sólo se escribe lo que cambió.** `actualizado_en` termina en el campo
 *     `actualizado` de `productos.json`; tocar las 50 filas de la página en cada
 *     guardado cambiaría la fecha de todo el catálogo y produciría un diff enorme en
 *     cada publicación, con cero cambios reales adentro.
 *  2. **Cambiar el nombre NO cambia el slug** (SPEC.md §6.7). La URL es inmutable
 *     desde que existe.
 */
import type { Ejecutar } from './grilla.ts';

export interface CambioFila {
  id: number;
  /** Ya parseado. Cadena vacía o espacios se interpretan como "sin nombre". */
  nombre: string | null;
  /**
   * Cadena vacía o espacios se interpretan como "sin descripción" y la BORRAN.
   *
   * A diferencia de `categoriaPrincipal`, acá vaciar SÍ es una orden: el textarea no
   * tiene un estado "sin elegir" del que distinguirlo. Misma semántica que la pantalla
   * de edición (§10.4), y a propósito: dos pantallas que escriben el mismo campo con
   * reglas distintas son una trampa.
   */
  descripcion: string | null;
  /** Ya parseado por `parsearPrecio`. `null` es "Consultar precio". */
  precio: number | null;
  /**
   * Si va en la portada (§4.3).
   *
   * OBLIGATORIO y no opcional, aunque un checkbox sin tildar no viaje en el POST: la
   * traducción de "no vino" a `false` es de la página, que tiene el `fila` para saber
   * que la fila sí se rindió. Si acá fuera opcional, `undefined` se confundiría con
   * "destildado" y un producto destacado no se podría bajar nunca de la portada.
   */
  destacado: boolean;
  /** Categoría principal elegida, o `null` si el select quedó sin elegir. */
  categoriaPrincipal: string | null;
}

export interface ResultadoFila {
  id: number;
  codigo?: string;
  ok: boolean;
  /** `true` sólo si algo se escribió de verdad. */
  cambio?: boolean;
  motivo?: string;
}

export interface OpcionesGuardado {
  categoriasValidas: ReadonlySet<string>;
  ahora: string;
}

interface FilaActual {
  id: number;
  codigo: string;
  nombre: string | null;
  descripcion: string | null;
  precio: number | null;
  /** Columna INTEGER del esquema, no un booleano: 0 o 1. */
  destacado: number;
  estado: string;
}

const huecos = (n: number) => Array.from({ length: n }, () => '?').join(', ');

export async function guardarFilas(
  ejecutar: Ejecutar,
  cambios: CambioFila[],
  { categoriasValidas, ahora }: OpcionesGuardado
): Promise<ResultadoFila[]> {
  if (cambios.length === 0) return [];

  const ids = cambios.map((c) => c.id);

  const actuales = new Map(
    (
      await ejecutar<FilaActual>(
        `SELECT id, codigo, nombre, descripcion, precio, destacado, estado
           FROM productos WHERE id IN (${huecos(ids.length)})`,
        ids
      )
    ).map((f) => [f.id, f])
  );

  const filasCat = await ejecutar<{ producto_id: number; categoria_slug: string; orden: number }>(
    `SELECT producto_id, categoria_slug, orden
       FROM producto_categorias
      WHERE producto_id IN (${huecos(ids.length)})
      ORDER BY producto_id, orden, categoria_slug`,
    ids
  );
  const categoriasActuales = new Map<number, string[]>();
  for (const f of filasCat) {
    const lista = categoriasActuales.get(f.producto_id) ?? [];
    lista.push(f.categoria_slug);
    categoriasActuales.set(f.producto_id, lista);
  }

  const resultados: ResultadoFila[] = [];

  for (const cambio of cambios) {
    const actual = actuales.get(cambio.id);
    if (!actual) {
      resultados.push({ id: cambio.id, ok: false, motivo: 'no existe' });
      continue;
    }

    const nombre = (cambio.nombre ?? '').trim() === '' ? null : cambio.nombre!.trim();

    /**
     * Se recorta ANTES de comparar, y de eso depende el invariante 1.
     *
     * Un `<textarea>` devuelve el contenido tal cual, incluido el salto de línea que
     * queda al tipear. Comparando en crudo, `"Cartera.\n"` contra `"Cartera."` daría
     * distinto y las 50 filas de la página se marcarían como cambiadas en cada
     * guardado, que es exactamente el diff gigante que el invariante evita.
     */
    const descripcion = (cambio.descripcion ?? '').trim() || null;

    /**
     * Vaciar el nombre de un producto que NO está en `importado` se rechaza.
     *
     * El volcado lanza ante un producto publicable sin nombre, así que dejarlo pasar
     * haría que la próxima publicación falle entera. Se corta donde se comete el
     * error, no tres pantallas después.
     */
    if (nombre === null && actual.estado !== 'importado') {
      resultados.push({
        id: cambio.id,
        codigo: actual.codigo,
        ok: false,
        motivo: `un producto en estado "${actual.estado}" no puede quedar sin nombre`,
      });
      continue;
    }

    const principal = cambio.categoriaPrincipal;
    if (principal !== null && !categoriasValidas.has(principal)) {
      resultados.push({
        id: cambio.id,
        codigo: actual.codigo,
        ok: false,
        motivo: `categoría inexistente: ${principal}`,
      });
      continue;
    }

    const yaTiene = categoriasActuales.get(cambio.id) ?? [];

    /**
     * Se comparan TODOS los campos ANTES de escribir. Es el invariante 1: sin esto,
     * abrir la grilla y apretar "Guardar" cambiaría la fecha de las 50 filas.
     */
    const cambiaNombre = nombre !== actual.nombre;
    const cambiaDescripcion = descripcion !== actual.descripcion;
    const cambiaPrecio = cambio.precio !== actual.precio;
    // `destacado` es INTEGER en el esquema: se normaliza a booleano para comparar y no
    // al revés. Comparar `true !== 1` sería siempre distinto y reescribiría cada fila.
    const cambiaDestacado = cambio.destacado !== (actual.destacado === 1);
    // Un select sin elegir NO se lee como "sacale la categoría": borrar curaduría
    // tiene que ser explícito, y este formulario no tiene forma de pedirlo.
    const cambiaCategoria = principal !== null && yaTiene[0] !== principal;

    const cambiaColumna = cambiaNombre || cambiaDescripcion || cambiaPrecio || cambiaDestacado;

    if (!cambiaColumna && !cambiaCategoria) {
      resultados.push({ id: cambio.id, codigo: actual.codigo, ok: true, cambio: false });
      continue;
    }

    if (cambiaColumna) {
      /**
       * Las cuatro columnas van en UN SOLO UPDATE aunque haya cambiado una.
       *
       * Reescribir una columna con el valor que ya tenía no es un cambio para nadie: lo
       * que el invariante 1 protege es `actualizado_en`, y esa fecha se mueve igual
       * porque algo de la fila cambió. Armar el SET dinámicamente daría cuatro caminos
       * de SQL para ahorrar nada.
       *
       * El `slug` NO está acá, y es deliberado: cambiar el nombre de un producto
       * publicado cambia el nombre, nunca la URL (SPEC.md §6.7).
       */
      await ejecutar(
        `UPDATE productos
            SET nombre = ?, descripcion = ?, precio = ?, destacado = ?, actualizado_en = ?
          WHERE id = ?`,
        [nombre, descripcion, cambio.precio, cambio.destacado ? 1 : 0, ahora, cambio.id]
      );
    }

    if (cambiaCategoria) {
      /**
       * La principal reemplaza a la primera y las demás quedan, corridas un lugar.
       *
       * Si la nueva principal ya era secundaria se filtra: sin eso el UNIQUE de
       * `(producto_id, categoria_slug)` rechazaría el INSERT y la fila fallaría por
       * algo que el usuario no puede ver.
       */
      const resto = yaTiene.slice(1).filter((c) => c !== principal);
      const nuevas = [principal!, ...resto];

      await ejecutar(`DELETE FROM producto_categorias WHERE producto_id = ?`, [cambio.id]);
      for (const [orden, slug] of nuevas.entries()) {
        await ejecutar(
          `INSERT INTO producto_categorias (producto_id, categoria_slug, orden) VALUES (?, ?, ?)`,
          [cambio.id, slug, orden]
        );
      }

      // Si sólo cambió la categoría, la fecha igual tiene que moverse.
      if (!cambiaColumna) {
        await ejecutar(`UPDATE productos SET actualizado_en = ? WHERE id = ?`, [ahora, cambio.id]);
      }
    }

    resultados.push({ id: cambio.id, codigo: actual.codigo, ok: true, cambio: true });
  }

  return resultados;
}
