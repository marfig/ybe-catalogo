/**
 * Guardar en D1 lo que trajo el scrape (SPEC-etapa2 §7.5).
 *
 * LA REGLA QUE MANDA: **el scrape aporta estructura; las personas aportan
 * decisiones, y el scrape no las revierte.**
 *
 * Correr el scrape dos veces sobre el mismo modelo no puede pisar un nombre escrito
 * a mano, ni un precio, ni una ocultación. La idempotencia no sale de un archivo de
 * estado sino de las restricciones de la base: `productos.codigo UNIQUE` convierte el
 * segundo INSERT en UPDATE, y `variantes.sku UNIQUE` hace lo propio con los colores.
 */
import type { Ejecutar } from '../grilla.ts';
import { separarColor, skuDeOrigen } from './origen.ts';

/** Un color del proveedor, tal cual vino. */
export interface ColorDeFicha {
  /** Literal, con prefijo: `(T) MARRON CLARO`. `null` si el origen no lo dio. */
  colorOrigen: string | null;
  /** Ficha de la que salió. Auditoría. */
  url: string;
  /**
   * Cuántas fotos trajo este color en la ficha, para decidir el orden del alta.
   *
   * ES EL ÚNICO DATO DE ESTA INTERFAZ QUE NO SE GUARDA EN NINGUNA COLUMNA: se usa
   * para ordenar y se descarta. Las fotos en sí no pasan por acá — las sube el
   * navegador una por una y las vincula `vincularImagen`, así que en el momento en que
   * corre `registrarFicha` todavía no hay ninguna fila en `variante_imagenes` que
   * contar. De ahí que el número tenga que venir de afuera.
   *
   * OPCIONAL A PROPÓSITO. `/api/scrape/ficha` es el único camino que lo conoce; los
   * tests y cualquier otro armador de una `FichaParaRegistrar` no tienen por qué. Sin
   * el dato todos los colores empatan en 0 y queda el orden alfabético de antes.
   */
  cantidadDeFotos?: number;
}

export interface FichaParaRegistrar {
  codigo: string;
  /** La ficha que se visitó. */
  urlOrigen: string;
  /** NULL por el camino de lanzamientos: el origen no expone la categoría (§5.4b). */
  categoriaOrigen?: string | null;
  /** El color propio de la ficha primero, después los hermanos. */
  colores: ColorDeFicha[];
  /**
   * Las medidas ya redactadas, o NULL si la ficha no las trae.
   *
   * SÓLO SE USA EN EL ALTA. Ver la nota de `registrarFicha`.
   */
  medidas?: string | null;
}

export interface ResultadoRegistro {
  productoId: number;
  /** `true` si el producto no existía. */
  creado: boolean;
  /** SKU de las variantes que se agregaron en esta corrida. */
  variantesNuevas: string[];
  /** Colores que llegaron sin nombre y que alguien va a tener que nombrar. */
  coloresSinNombre: number;
  /** `true` si apareció un color nuevo sobre un producto ya curado. */
  avisoDeCambio: boolean;
}

/**
 * Cuáles de estos códigos YA están en el catálogo.
 *
 * Alimenta la opción «saltear los que ya tengo» de la pantalla de importación. Es UNA
 * consulta por página del listado, contra la base propia: no le cuesta nada al
 * proveedor, y lo que ahorra son las decenas de pedidos que costaría descubrir lo
 * mismo bajando cada ficha.
 *
 * COMPARA CON `upper()`, igual que el índice único de §5.3. La collation por defecto
 * de SQLite es BINARY, así que un `IN (…)` pelado trataría `cg85700` y `CG85700` como
 * códigos distintos y el salteo dejaría pasar un producto que sí tenemos.
 *
 * Incluye los `eliminado` a propósito: un producto en la papelera sigue existiendo —
 * su código está tomado y su URL vive. Saltearlo es lo correcto; volver a importarlo
 * haría `UPDATE` sobre una fila que alguien sacó del catálogo a propósito.
 */
export async function codigosExistentes(
  ejecutar: Ejecutar,
  codigos: string[]
): Promise<string[]> {
  if (codigos.length === 0) return [];

  const huecos = codigos.map(() => '?').join(', ');
  const filas = await ejecutar<{ codigo: string }>(
    `SELECT codigo FROM productos WHERE upper(codigo) IN (${huecos})`,
    codigos.map((c) => c.trim().toUpperCase())
  );

  return filas.map((f) => f.codigo);
}

/**
 * Nombre de color presentable: `MARRON CLARO` -> `Marron Claro`.
 *
 * El proveedor escribe todo en mayúsculas. Guardarlo así llegaría tal cual al cliente
 * — el `color_origen` conserva el literal para auditoría, así que no se pierde nada.
 */
export function nombreDeColor(nombre: string): string {
  return nombre
    .toLocaleLowerCase('es')
    .replace(/(^|\s|-)([\p{L}])/gu, (_, sep: string, letra: string) => sep + letra.toLocaleUpperCase('es'));
}

/**
 * Registra una ficha. Devuelve qué cambió, para el resumen de §10.2.
 *
 * `nombre`, `precio`, `slug` y `estado` NO aparecen en ningún UPDATE de esta función,
 * y es la razón de que exista. `destacado` tampoco: salió del admin con la curaduría de
 * portada y la columna quedó congelada en D1, así que un re-scrape no puede tocarla.
 *
 * `descripcion` SÍ APARECE, y con una regla propia: se siembra en el alta, y en el UPDATE
 * se escribe **sólo si está en NULL** (`COALESCE(descripcion, ?)`). Lo que ya está gana
 * siempre, incluso contra unas medidas nuevas del proveedor.
 *
 * No es una excepción a la regla de arriba sino su lectura exacta: donde no hay nada
 * escrito no hay decisión humana que revertir. La nota larga de por qué —432 productos
 * vacíos por un regex— está en el propio UPDATE.
 */
export async function registrarFicha(
  ejecutar: Ejecutar,
  ficha: FichaParaRegistrar,
  { scrapeId, ahora }: { scrapeId: number | null; ahora: string }
): Promise<ResultadoRegistro> {
  const codigo = ficha.codigo.trim().toUpperCase();
  if (!codigo) throw new Error('La ficha no tiene código: es la identidad del producto.');
  if (ficha.colores.length === 0) {
    throw new Error(`La ficha ${codigo} no trajo ningún color: no se guarda a medias.`);
  }

  const [existente] = await ejecutar<{ id: number; estado: string }>(
    `SELECT id, estado FROM productos WHERE upper(codigo) = upper(?)`,
    [codigo]
  );

  let productoId: number;
  const creado = !existente;

  if (existente) {
    /**
     * Sólo los campos DE ORIGEN. La lista corta es el control: cualquier columna que
     * alguien agregue acá sin pensarlo pisaría curaduría en la próxima corrida.
     *
     * `descripcion` ES LA EXCEPCIÓN, y su COALESCE va AL REVÉS que los otros dos: la
     * columna primero. O sea que lo que ya está gana siempre, y lo único que se escribe es
     * una descripción que está en NULL.
     *
     * No contradice la regla de arriba: es su lectura exacta. Donde no hay nada escrito no
     * hay decisión humana que revertir. Y entró por un caso real — 432 productos quedaron
     * sin descripción porque el regex de las medidas no reconocía la etiqueta mayoritaria
     * del proveedor (ver `ES_ETIQUETA_MEDIDAS`). Arreglado el regex, reimportar no los
     * arreglaba: las medidas se sembraban sólo en el INSERT, así que un producto ya
     * existente se quedaba vacío para siempre y no había ningún camino para completarlo.
     *
     * INVERTIR EL ORDEN SERÍA EL BUG: `COALESCE(?, descripcion)` pisaría en cada corrida lo
     * que alguien escribió, que es exactamente lo que esta función existe para impedir.
     */
    await ejecutar(
      `UPDATE productos
          SET categoria_origen = COALESCE(?, categoria_origen),
              url_origen       = ?,
              descripcion      = COALESCE(descripcion, ?),
              scrape_id        = COALESCE(?, scrape_id),
              actualizado_en   = ?
        WHERE id = ?`,
      [
        ficha.categoriaOrigen ?? null,
        ficha.urlOrigen,
        // `|| null` igual que en el INSERT: una cadena vacia le dibujaria a la ficha
        // publica un parrafo en blanco, porque el render pregunta por la descripcion y no
        // por su largo.
        ficha.medidas?.trim() || null,
        scrapeId,
        ahora,
        existente.id,
      ]
    );
    productoId = existente.id;
  } else {
    const [fila] = await ejecutar<{ id: number }>(
      `INSERT INTO productos
         (codigo, proveedor, estado, categoria_origen, url_origen, descripcion, scrape_id, creado_en, actualizado_en)
       VALUES (?, 'chenson', 'importado', ?, ?, ?, ?, ?, ?)
       RETURNING id`,
      [
        codigo,
        ficha.categoriaOrigen ?? null,
        ficha.urlOrigen,
        // `|| null` y no `?? null`: una cadena vacia le dibujaria a la ficha publica un
        // parrafo en blanco, porque el render pregunta por la descripcion, no por su largo.
        ficha.medidas?.trim() || null,
        scrapeId,
        ahora,
        ahora,
      ]
    );
    productoId = fila.id;
  }

  const existentes = await ejecutar<{ sku: string; orden: number }>(
    `SELECT sku, orden FROM variantes WHERE producto_id = ?`,
    [productoId]
  );
  const skusTomados = new Set(existentes.map((v) => v.sku));

  /**
   * Orden de las variantes.
   *
   * En un producto NUEVO manda la CANTIDAD DE FOTOS, de mayor a menor. `orden` es la
   * única fuente de verdad del orden de los colores y el primero es el que sale en la
   * tarjeta, en el buscador, en el mensaje de WhatsApp y en el `og:image` — así que
   * elegirlo por alfabeto, como se hacía antes, era elegirlo al azar. Cuántas fotos
   * tiene un color es lo más cercano a «cuánto material hay para mostrarlo» que la
   * ficha nos dice.
   *
   * El alfabeto queda como DESEMPATE, y es lo que mantiene el alta determinista: sin
   * él, dos colores con las mismas fotos quedarían en el orden en que el proveedor los
   * liste, que cambia cuando le mueve los colores a la ficha. Es el mismo criterio con
   * el que la migración 0008 reordenó el catálogo que ya estaba cargado.
   *
   * En uno que YA EXISTE nada de esto se aplica: las nuevas se agregan AL FINAL. El
   * orden de las que ya estaban es curaduría —alguien decidió qué color se muestra
   * primero— y el scrape no la revierte, ni siquiera por un hermano con diez fotos.
   */
  let siguienteOrden = existentes.length === 0 ? 0 : Math.max(...existentes.map((v) => v.orden)) + 1;

  const candidatos = ficha.colores
    .filter((c) => (c.colorOrigen ?? '').trim() !== '')
    .map((c) => {
      const { nombre } = separarColor(c.colorOrigen!);
      return {
        sku: skuDeOrigen(codigo, c.colorOrigen!),
        colorOrigen: c.colorOrigen!.trim(),
        nombre,
        // `?? 0` y no un error: el dato es opcional (ver `ColorDeFicha`). Una ficha que
        // no lo informa deja a todos empatados y cae entera en el desempate alfabético.
        fotos: c.cantidadDeFotos ?? 0,
      };
    });

  if (creado) candidatos.sort((a, b) => b.fotos - a.fotos || a.nombre.localeCompare(b.nombre, 'es'));

  const variantesNuevas: string[] = [];
  for (const c of candidatos) {
    // Una variante que ya existe NO se toca: su `color_hex` puede haberse cargado a
    // mano, y su color es de donde se derivó el SKU que ya circuló en pedidos.
    if (skusTomados.has(c.sku)) continue;
    skusTomados.add(c.sku);

    await ejecutar(
      `INSERT INTO variantes (producto_id, sku, color, color_origen, orden)
       VALUES (?, ?, ?, ?, ?)`,
      [productoId, c.sku, nombreDeColor(c.nombre), c.colorOrigen, siguienteOrden++]
    );
    variantesNuevas.push(c.sku);
  }

  /**
   * El aviso de §7.5: un color nuevo sobre un producto YA CURADO se marca para que
   * alguien lo mire. No se autopublica un color que nadie vio.
   *
   * En un producto recién importado no hay aviso: todo es nuevo por definición.
   */
  const avisoDeCambio = !creado && variantesNuevas.length > 0 && existente!.estado !== 'importado';
  if (avisoDeCambio) {
    await ejecutar(`UPDATE productos SET cambio_en_origen = ? WHERE id = ?`, [ahora, productoId]);
  }

  return {
    productoId,
    creado,
    variantesNuevas,
    coloresSinNombre: ficha.colores.length - candidatos.length,
    avisoDeCambio,
  };
}

/**
 * Vincula una imagen ya subida a una variante, por SKU.
 *
 * Es un paso aparte de `guardarImagen` porque esa función registra el CONTENIDO —una
 * imagen puede pertenecer a variantes de distintos productos, que es el caso de dedupe
 * de `SPEC.md` §6.8— y este vínculo es lo que dice de quién es.
 *
 * Idempotente: volver a vincular lo mismo no duplica ni reordena. Es lo que permite
 * repetir una corrida interrumpida sin pensar en qué llegó a entrar.
 */
export async function vincularImagen(
  ejecutar: Ejecutar,
  { sku, hash16 }: { sku: string; hash16: string }
): Promise<{ vinculada: boolean }> {
  const [variante] = await ejecutar<{ id: number }>(`SELECT id FROM variantes WHERE sku = ?`, [sku]);
  if (!variante) throw new Error(`No existe la variante ${sku}.`);

  const [imagen] = await ejecutar<{ id: number }>(`SELECT id FROM imagenes WHERE hash16 = ?`, [
    hash16,
  ]);
  // Sin la imagen registrada el vínculo apuntaría a nada y el catálogo mostraría un
  // `<img>` roto, que es justo lo que el placeholder de `SPEC.md` §5.4 evita.
  if (!imagen) throw new Error(`La imagen ${hash16} no está subida.`);

  const [ya] = await ejecutar<{ orden: number }>(
    `SELECT orden FROM variante_imagenes WHERE variante_id = ? AND imagen_id = ?`,
    [variante.id, imagen.id]
  );
  if (ya) return { vinculada: false };

  const [{ siguiente }] = await ejecutar<{ siguiente: number }>(
    `SELECT COALESCE(max(orden) + 1, 0) AS siguiente FROM variante_imagenes WHERE variante_id = ?`,
    [variante.id]
  );

  await ejecutar(
    `INSERT INTO variante_imagenes (variante_id, imagen_id, orden) VALUES (?, ?, ?)`,
    [variante.id, imagen.id, siguiente]
  );
  return { vinculada: true };
}
