/**
 * Alta manual de un producto (SPEC-etapa2 §9).
 *
 * Produce exactamente la misma fila que el scrape: estado `importado`, con
 * `proveedor: 'manual'`. Las imágenes ya fueron subidas por `/api/imagenes`; acá sólo
 * se vinculan por hash.
 */
import { buscarPorCodigo, normalizarCodigo, type ProductoExistente } from './codigo.ts';
import type { Ejecutar } from './grilla.ts';
import { skuDe } from './imagen.ts';

/**
 * Una variante nueva.
 *
 * NO LLEVA `colorHex` A PROPÓSITO. La columna `color_hex` existe y el sitio público la
 * usa para la bolita del selector, pero `SPEC.md` §6.6 es explícito: **nunca se
 * inventa**. Un `<input type="color">` no puede cumplir eso porque no tiene estado
 * vacío: siempre devuelve un color, así que guardar un producto le estampaba `#cccccc`
 * a todas sus variantes y el sitio mostraba una bolita gris que nadie eligió.
 *
 * Sin valor, el selector del sitio cae a botón con texto, que es lo que §4.2 ya prevé.
 */
export interface VarianteNueva {
  color: string;
  /** hash16 de las imágenes ya subidas, en el orden en que se muestran. */
  hashes: string[];
}

export interface ProductoNuevo {
  codigo: string;
  nombre: string | null;
  descripcion: string | null;
  precio: number | null;
  categorias: string[];
  variantes: VarianteNueva[];
}

export interface ResultadoAlta {
  creado: boolean;
  id?: number;
  codigo?: string;
  /** Presente cuando el código ya existía: la pantalla ofrece editar ese producto. */
  existente?: ProductoExistente;
}

export async function crearProducto(
  ejecutar: Ejecutar,
  producto: ProductoNuevo,
  {
    categoriasValidas,
    ahora,
  }: { categoriasValidas: ReadonlySet<string>; ahora: string }
): Promise<ResultadoAlta> {
  // Lanza con un mensaje propio: el UNIQUE de la base daría un error crudo de SQLite
  // y §10 pide que ningún mensaje del admin lo sea.
  const codigo = normalizarCodigo(producto.codigo);

  /**
   * TODA la validación corre ANTES de escribir.
   *
   * Sin esto, un alta rechazada a mitad de camino deja el producto creado sin sus
   * variantes, y sacarlo de ahí requiere la terminal. El orden importa más que el
   * ahorro de una consulta.
   */
  if (producto.variantes.length === 0) {
    throw new Error('Hace falta al menos una variante de color: sin variante no hay SKU ni foto.');
  }

  const invalidas = producto.categorias.filter((c) => !categoriasValidas.has(c));
  if (invalidas.length > 0) {
    throw new Error(`Categorías inexistentes: ${invalidas.join(', ')}.`);
  }

  /**
   * Dos variantes del mismo color darían el mismo SKU. Sin este chequeo, el UNIQUE de
   * `sku` frena la segunda a mitad del alta y el producto queda con una sola variante
   * y sin explicación.
   */
  const skus = producto.variantes.map((v) => skuDe(codigo, v.color));
  const repetidos = skus.filter((s, i) => skus.indexOf(s) !== i);
  if (repetidos.length > 0) {
    throw new Error(
      `Hay dos variantes con el mismo color: darían el mismo SKU (${repetidos[0]}).`
    );
  }

  // Las imágenes tienen que existir: vincular una inexistente dejaría la variante sin
  // foto y sin aviso.
  const hashes = [...new Set(producto.variantes.flatMap((v) => v.hashes))];
  const idPorHash = new Map<string, number>();
  if (hashes.length > 0) {
    const filas = await ejecutar<{ id: number; hash16: string }>(
      `SELECT id, hash16 FROM imagenes WHERE hash16 IN (${hashes.map(() => '?').join(', ')})`,
      hashes
    );
    for (const f of filas) idPorHash.set(f.hash16, f.id);

    const faltantes = hashes.filter((h) => !idPorHash.has(h));
    if (faltantes.length > 0) {
      throw new Error(`Hay ${faltantes.length} imagen(es) que no se subieron: ${faltantes.join(', ')}.`);
    }
  }

  /**
   * El código es la identidad (§5.3): si ya existe NO se falla, se devuelve el
   * producto para que la pantalla ofrezca editarlo (§9). Es la diferencia entre «ese
   * código ya está» y «tu trabajo no sirve».
   */
  const existente = await buscarPorCodigo(ejecutar, codigo);
  if (existente) return { creado: false, existente };

  const [fila] = await ejecutar<{ id: number }>(
    `INSERT INTO productos
       (codigo, proveedor, nombre, descripcion, precio, estado, creado_en, actualizado_en)
     VALUES (?, 'manual', ?, ?, ?, 'importado', ?, ?)
     RETURNING id`,
    [
      codigo,
      producto.nombre?.trim() || null,
      producto.descripcion?.trim() || null,
      producto.precio,
      ahora,
      ahora,
    ]
  );
  const id = fila.id;

  // El orden de las categorías es curaduría: `categorias[0]` es el breadcrumb (§5.1).
  for (const [orden, slug] of producto.categorias.entries()) {
    await ejecutar(
      `INSERT INTO producto_categorias (producto_id, categoria_slug, orden) VALUES (?, ?, ?)`,
      [id, slug, orden]
    );
  }

  for (const [orden, variante] of producto.variantes.entries()) {
    // El orden que se cargó decide qué color se ve al abrir la ficha: es la misma
    // regla curatorial que aplica el volcado.
    const [v] = await ejecutar<{ id: number }>(
      // `color_hex` no se escribe: queda NULL, que es lo que corresponde a un color que
      // nadie midió. Ver `VarianteNueva`.
      `INSERT INTO variantes (producto_id, sku, color, orden)
       VALUES (?, ?, ?, ?)
       RETURNING id`,
      [id, skus[orden], variante.color.trim(), orden]
    );

    for (const [ordenFoto, hash] of variante.hashes.entries()) {
      await ejecutar(
        `INSERT INTO variante_imagenes (variante_id, imagen_id, orden) VALUES (?, ?, ?)`,
        [v.id, idPorHash.get(hash)!, ordenFoto]
      );
    }
  }

  return { creado: true, id, codigo };
}
