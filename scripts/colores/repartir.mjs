/**
 * Reparte en colores las fotos de los productos que la migración del catálogo viejo
 * dejó con una sola variante.
 *
 * QUÉ ES Y QUÉ NO ES. No sube ni baja nada: las fotos ya están en R2 y en `imagenes`.
 * Lo único que se toca es `variante_imagenes`, que es el VÍNCULO entre una foto y una
 * variante. Recablearlo no mueve un byte del bucket.
 *
 * POR QUÉ UN SCRIPT Y NO UNA PANTALLA. Del catálogo viejo ya no hay nada que importar,
 * así que son 33 productos y se acabó. Una pantalla del admin sería una puerta abierta
 * para siempre a una operación que borra variantes — que es justo lo que
 * `actualizarProducto` prohíbe, y con razón: ahí sería un accidente al guardar un
 * formulario, acá es la operación entera y deliberada.
 *
 * LO QUE MÁS SE CUIDA es no hacer de más. Todo se valida ANTES de escribir la primera
 * fila, y ninguna fila de `imagenes` se borra nunca: una foto sin asignar queda huérfana
 * y se reporta, porque estas son las únicas copias que existen y un error de etiquetado
 * no puede costar una foto.
 *
 * Uso:
 *   node --experimental-strip-types scripts/colores/repartir.mjs mapeo.json --dry-run
 *   node --experimental-strip-types scripts/colores/repartir.mjs mapeo.json
 *   node --experimental-strip-types scripts/colores/repartir.mjs mapeo.json --remote
 */
import { skuDe } from '../../admin/src/lib/imagen.ts';

/** Marcas `?` para un `IN (…)`. D1 no acepta arreglos como parámetro. */
const marcas = (n) => Array.from({ length: n }, () => '?').join(',');

/**
 * Reparte las fotos según el mapeo. Devuelve un informe por producto.
 *
 * @param ejecutar  el mismo contrato que usa el volcado: (sql, params) => filas
 * @param mapeo     [{ codigo, variantes: [{ color, fotos: [hash16] }] }]
 */
export async function repartirColores(ejecutar, mapeo, { ahora, ensayo = false }) {
  const informe = [];

  for (const entrada of mapeo) {
    const { codigo } = entrada;

    // ---- Validación. Nada se escribe hasta que TODO este bloque pasó. ----

    const [producto] = await ejecutar(
      `SELECT id, codigo FROM productos WHERE upper(codigo) = upper(?)`,
      [codigo]
    );
    if (!producto) throw new Error(`El producto ${codigo} no existe.`);

    const variantesActuales = await ejecutar(
      `SELECT id, sku, color FROM variantes WHERE producto_id = ?`,
      [producto.id]
    );
    /**
     * Sobre un producto que YA tiene sus colores, esto borraría variantes cuyos SKU sí
     * circularon de verdad. La operación existe sólo para los que quedaron con una.
     */
    if (variantesActuales.length !== 1) {
      throw new Error(
        `${codigo} ya tiene ${variantesActuales.length} variantes. Esto es sólo para los que quedaron con una.`
      );
    }
    const vieja = variantesActuales[0];

    const pedidas = entrada.variantes.flatMap((v) => v.fotos);
    const repetida = pedidas.find((h, i) => pedidas.indexOf(h) !== i);
    if (repetida) {
      /**
       * La base admite que una imagen cuelgue de varias variantes —es el dedupe de
       * §6.8— pero acá cada foto MUESTRA un color. Repetirla es casi siempre un error de
       * etiquetado, y dejarlo pasar pondría la misma foto en dos colores del catálogo.
       */
      throw new Error(`${codigo}: la foto ${repetida} está en dos colores. ¿Repetida por error?`);
    }

    // Los SKU se calculan acá para que un color roto falle antes de escribir.
    const skus = entrada.variantes.map((v) => skuDe(producto.codigo, v.color));
    const skuRepetido = skus.find((s, i) => skus.indexOf(s) !== i);
    if (skuRepetido) {
      throw new Error(`${codigo}: dos colores dan el mismo SKU (${skuRepetido}).`);
    }

    /**
     * LAS FOTOS TIENEN QUE SER DE ESTE PRODUCTO, y esta es la guarda que más importa.
     * Los hashes se copian a mano desde una planilla: uno pegado de la fila de al lado
     * le arrancaría la foto a otro producto, que se quedaría sin ella en el catálogo
     * publicado. Se pregunta por las que HOY cuelgan de este producto, no por las que
     * existen en `imagenes`.
     */
    const suyas = await ejecutar(
      `SELECT i.id, i.hash16
         FROM imagenes i
         JOIN variante_imagenes vi ON vi.imagen_id = i.id
         JOIN variantes v ON v.id = vi.variante_id
        WHERE v.producto_id = ?`,
      [producto.id]
    );
    const idPorHash = new Map(suyas.map((f) => [f.hash16, f.id]));

    for (const hash of pedidas) {
      if (idPorHash.has(hash)) continue;
      const [existe] = await ejecutar(`SELECT 1 AS x FROM imagenes WHERE hash16 = ?`, [hash]);
      throw new Error(
        existe
          ? `${codigo}: la foto ${hash} existe pero no es de ${codigo}. Es de otro producto.`
          : `${codigo}: la foto ${hash} no existe.`
      );
    }

    const asignadas = new Set(pedidas);
    const sinAsignar = suyas.map((f) => f.hash16).filter((h) => !asignadas.has(h));

    const resultado = {
      codigo: producto.codigo,
      variantes: entrada.variantes.map((v, i) => ({ color: v.color, sku: skus[i], fotos: v.fotos.length })),
      sinAsignar,
      quitada: vieja.color,
    };
    informe.push(resultado);

    if (ensayo) continue;

    // ---- Recién acá se escribe. ----

    /**
     * PRIMERO LAS NUEVAS, DESPUÉS SE BORRA LA VIEJA, y el orden no es indistinto: la
     * vieja es lo único que dice hoy qué fotos son de este producto. Borrarla antes
     * dejaría las fotos sin ningún vínculo, y si algo fallara en el medio quedarían
     * huérfanas sin nadie que sepa a qué producto pertenecían.
     *
     * Mientras tanto una foto cuelga de dos variantes a la vez, que la base admite sin
     * problema — es el mismo modelo que permite el dedupe entre productos.
     */
    for (const [orden, v] of entrada.variantes.entries()) {
      const [nueva] = await ejecutar(
        // `color_hex` queda NULL: el catálogo viejo no lo trae y no se inventa (§6.6).
        `INSERT INTO variantes (producto_id, sku, color, orden) VALUES (?, ?, ?, ?) RETURNING id`,
        [producto.id, skus[orden], v.color.trim(), orden]
      );
      for (const [ordenFoto, hash] of v.fotos.entries()) {
        await ejecutar(
          `INSERT INTO variante_imagenes (variante_id, imagen_id, orden) VALUES (?, ?, ?)`,
          [nueva.id, idPorHash.get(hash), ordenFoto]
        );
      }
    }

    // El CASCADE se lleva sus `variante_imagenes`. Las filas de `imagenes` NO se tocan:
    // los objetos de R2 cuelgan de ellas y son las únicas copias que existen.
    await ejecutar(`DELETE FROM variantes WHERE id = ?`, [vieja.id]);

    /**
     * Mover la fecha no es cosmética: `cambiosSinPublicar` compara `actualizado_en`
     * contra la última publicación. Sin esto el catálogo queda distinto de la base y el
     * Inicio dice que no hay nada que publicar.
     */
    await ejecutar(`UPDATE productos SET actualizado_en = ? WHERE id = ?`, [ahora, producto.id]);
  }

  return informe;
}

/** Marca `?` exportada para el CLI, que arma su propio ejecutor. */
export { marcas };
