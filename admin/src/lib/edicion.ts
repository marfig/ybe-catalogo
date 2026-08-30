/**
 * Edición de un producto (SPEC-etapa2 §10.4).
 *
 * Trae todo lo que ya está cargado para no retipearlo, y lo guarda. Existe como
 * pantalla propia y no como un modo del formulario de alta: un formulario que es
 * «alta» o «edición» según lo que se tipeó en un campo cambia de significado en
 * silencio, y el caso malo es creer que se está creando algo mientras se pisa un
 * producto publicado.
 *
 * TRES COSAS NO SE TOCAN ACÁ, y cada una por su motivo:
 *
 *  - El **slug**, porque es la URL en la calle y es inmutable desde que existe (§5.2).
 *  - El **estado**, porque sólo se mueve por las transiciones de la máquina de
 *    estados. Si esta pantalla pudiera cambiarlo habría dos caminos para lo mismo, y
 *    uno se olvidaría de generar el slug.
 *  - El **código**, porque es la identidad (§5.3).
 */
import { buscarPorCodigo } from './codigo.ts';
import type { Ejecutar } from './grilla.ts';
import { skuDe } from './imagen.ts';
import type { VarianteNueva } from './alta.ts';

export interface VarianteCargada {
  id: number;
  sku: string;
  color: string;
  colorHex: string | null;
  hashes: string[];
}

export interface ProductoCargado {
  id: number;
  codigo: string;
  nombre: string | null;
  descripcion: string | null;
  precio: number | null;
  estado: string;
  slug: string | null;
  categorias: string[];
  variantes: VarianteCargada[];
}

/**
 * Una variante al editar. `id` presente = ya existe; ausente = es nueva.
 *
 * SE EMPAREJA POR ID Y NO POR SKU, y esto no es un detalle de implementación.
 *
 * El SKU de un producto del proveedor es `{codigo}-{codigoColor}` con el prefijo `(X)`
 * del origen —`CG85527-E`— y `slug(color)` es sólo el FALLBACK para colores sin
 * prefijo (SPEC.md §6.6). Recomputarlo devuelve `CG85527-champagne`, que no coincide
 * con nada, así que emparejar por SKU hacía creer que todas las variantes existentes
 * se habían borrado y la edición fallaba para TODOS los productos del proveedor.
 *
 * El SKU es como el slug: se asigna una vez y no se vuelve a derivar.
 */
export interface VarianteEditada extends VarianteNueva {
  id?: number;
}

export interface CambiosProducto {
  nombre: string | null;
  descripcion: string | null;
  precio: number | null;
  categorias: string[];
  variantes: VarianteEditada[];
}

/** Todo lo cargado de un producto, por código. `null` si no existe. */
export async function cargarProducto(
  ejecutar: Ejecutar,
  codigo: string
): Promise<ProductoCargado | null> {
  const referencia = await buscarPorCodigo(ejecutar, codigo);
  if (!referencia) return null;

  const [p] = await ejecutar<{
    id: number;
    codigo: string;
    nombre: string | null;
    descripcion: string | null;
    precio: number | null;
    estado: string;
    slug: string | null;
  }>(
    `SELECT id, codigo, nombre, descripcion, precio, estado, slug
       FROM productos WHERE id = ?`,
    [referencia.id]
  );

  const categorias = (
    await ejecutar<{ categoria_slug: string }>(
      `SELECT categoria_slug FROM producto_categorias
        WHERE producto_id = ? ORDER BY orden, categoria_slug`,
      [p.id]
    )
  ).map((f) => f.categoria_slug);

  const variantes = await ejecutar<{
    id: number;
    sku: string;
    color: string;
    color_hex: string | null;
  }>(
    `SELECT id, sku, color, color_hex FROM variantes
      WHERE producto_id = ? ORDER BY orden, color, sku`,
    [p.id]
  );

  const fotos =
    variantes.length === 0
      ? []
      : await ejecutar<{ variante_id: number; hash16: string }>(
          `SELECT vi.variante_id, i.hash16
             FROM variante_imagenes vi
             JOIN imagenes i ON i.id = vi.imagen_id
            WHERE vi.variante_id IN (${variantes.map(() => '?').join(', ')})
            ORDER BY vi.variante_id, vi.orden, i.hash16`,
          variantes.map((v) => v.id)
        );

  return {
    ...p,
    categorias,
    variantes: variantes.map((v) => ({
      id: v.id,
      sku: v.sku,
      color: v.color,
      colorHex: v.color_hex,
      hashes: fotos.filter((f) => f.variante_id === v.id).map((f) => f.hash16),
    })),
  };
}

/** Guarda los cambios. Lanza con el motivo, sin escribir nada a medias. */
export async function actualizarProducto(
  ejecutar: Ejecutar,
  id: number,
  cambios: CambiosProducto,
  { categoriasValidas, ahora }: { categoriasValidas: ReadonlySet<string>; ahora: string }
): Promise<void> {
  const [actual] = await ejecutar<{ id: number; codigo: string; estado: string }>(
    `SELECT id, codigo, estado FROM productos WHERE id = ?`,
    [id]
  );
  if (!actual) throw new Error(`El producto ${id} no existe.`);

  const nombre = (cambios.nombre ?? '').trim() || null;

  // Igual que en la grilla: el volcado lanza ante un publicable sin nombre, así que
  // dejarlo pasar haría fallar la próxima publicación entera.
  if (nombre === null && actual.estado !== 'importado') {
    throw new Error(`Un producto en estado "${actual.estado}" no puede quedar sin nombre.`);
  }

  const invalidas = cambios.categorias.filter((c) => !categoriasValidas.has(c));
  if (invalidas.length > 0) throw new Error(`Categorías inexistentes: ${invalidas.join(', ')}.`);
  if (cambios.categorias.length === 0) throw new Error('Hace falta al menos una categoría.');
  if (cambios.variantes.length === 0) throw new Error('Hace falta al menos una variante de color.');

  const existentes = await ejecutar<{ id: number; sku: string }>(
    `SELECT id, sku FROM variantes WHERE producto_id = ?`,
    [id]
  );
  const idsExistentes = new Set(existentes.map((v) => v.id));

  // Un id que no pertenece a este producto es un formulario manipulado o un bug.
  const ajenas = cambios.variantes.filter((v) => v.id !== undefined && !idsExistentes.has(v.id));
  if (ajenas.length > 0) {
    throw new Error(`Hay variantes que no pertenecen a este producto: ${ajenas.map((v) => v.id).join(', ')}.`);
  }

  /**
   * QUITAR una variante existente se RECHAZA acá.
   *
   * Su SKU ya viajó en pedidos y mensajes, y sus fotos quedarían huérfanas. Sacar algo
   * de circulación es una acción destructiva con sus propias reglas y confirmaciones
   * (§12): no puede pasar por descuido al guardar un formulario donde se borró una
   * fila sin querer.
   */
  const enviadas = new Set(cambios.variantes.map((v) => v.id).filter((x): x is number => x !== undefined));
  const faltantes = existentes.filter((v) => !enviadas.has(v.id));
  if (faltantes.length > 0) {
    throw new Error(
      `Falta${faltantes.length === 1 ? '' : 'n'} ${faltantes.map((v) => v.sku).join(', ')}. ` +
        'Desde acá no se pueden quitar variantes: su SKU ya circuló y sus fotos quedarían sueltas.'
    );
  }

  // El SKU sólo se calcula para las NUEVAS: las que ya existen conservan el suyo.
  const skusNuevos = cambios.variantes
    .filter((v) => v.id === undefined)
    .map((v) => skuDe(actual.codigo, v.color));
  const yaUsados = new Set(existentes.map((v) => v.sku));
  const repetido =
    skusNuevos.find((s, i) => skusNuevos.indexOf(s) !== i) ?? skusNuevos.find((s) => yaUsados.has(s));
  if (repetido) {
    throw new Error(`Ya hay una variante con ese color: daría el mismo SKU (${repetido}).`);
  }

  // Las imágenes tienen que existir antes de vincularlas.
  const hashes = [...new Set(cambios.variantes.flatMap((v) => v.hashes))];
  const idPorHash = new Map<string, number>();
  if (hashes.length > 0) {
    const filas = await ejecutar<{ id: number; hash16: string }>(
      `SELECT id, hash16 FROM imagenes WHERE hash16 IN (${hashes.map(() => '?').join(', ')})`,
      hashes
    );
    for (const f of filas) idPorHash.set(f.hash16, f.id);
    const sinSubir = hashes.filter((h) => !idPorHash.has(h));
    if (sinSubir.length > 0) {
      throw new Error(`Hay ${sinSubir.length} imagen(es) que no se subieron.`);
    }
  }

  // ---- Recién acá se escribe. Toda la validación corrió antes. ----

  // `slug`, `estado` y `codigo` NO están en este UPDATE, y es deliberado.
  await ejecutar(
    `UPDATE productos
        SET nombre = ?, descripcion = ?, precio = ?, actualizado_en = ?
      WHERE id = ?`,
    [nombre, cambios.descripcion?.trim() || null, cambios.precio, ahora, id],
  );

  await ejecutar(`DELETE FROM producto_categorias WHERE producto_id = ?`, [id]);
  for (const [orden, slug] of cambios.categorias.entries()) {
    await ejecutar(
      `INSERT INTO producto_categorias (producto_id, categoria_slug, orden) VALUES (?, ?, ?)`,
      [id, slug, orden]
    );
  }

  let siguienteNuevo = 0;
  for (const [orden, variante] of cambios.variantes.entries()) {
    let varianteId = variante.id;

    if (varianteId === undefined) {
      const [v] = await ejecutar<{ id: number }>(
        // `color_hex` queda NULL: ver `VarianteNueva` en `alta.ts`.
        `INSERT INTO variantes (producto_id, sku, color, orden)
         VALUES (?, ?, ?, ?) RETURNING id`,
        [id, skusNuevos[siguienteNuevo++], variante.color.trim(), orden]
      );
      varianteId = v.id;
    } else {
      /**
       * Sólo el orden. Ni el `sku` ni el `color` se tocan: el SKU ya circuló y el color
       * es de donde se derivó — cambiarlo sería otra variante, no la misma renombrada.
       *
       * `color_hex` TAMPOCO. Es el único dato de la variante que el admin no puede
       * escribir, y dejarlo en el UPDATE con un valor que ya no llega del formulario
       * borraría en silencio los que sí están cargados.
       */
      await ejecutar(`UPDATE variantes SET orden = ? WHERE id = ?`, [orden, varianteId]);
    }

    // Las fotos se reescriben en bloque: es la forma simple de respetar el orden que
    // llega, y `variante_imagenes` es sólo el vínculo — borrarlo no toca ni el objeto
    // en R2 ni la fila de `imagenes`.
    await ejecutar(`DELETE FROM variante_imagenes WHERE variante_id = ?`, [varianteId]);
    for (const [ordenFoto, hash] of variante.hashes.entries()) {
      await ejecutar(
        `INSERT INTO variante_imagenes (variante_id, imagen_id, orden) VALUES (?, ?, ?)`,
        [varianteId, idPorHash.get(hash)!, ordenFoto]
      );
    }
  }
}
