/**
 * Crear en el catálogo un producto que sólo existe en el catálogo viejo.
 *
 * POR QUÉ NO SIRVE `registrarFicha`, que es la función que crea productos todos los días:
 * ésa NO escribe nombre ni precio ni descripción en ningún UPDATE, y eso es literalmente su
 * razón de existir —el scrape aporta estructura; las personas aportan decisiones, y el
 * scrape no las revierte—. Acá el origen ES la curaduría: el catálogo viejo tiene el nombre
 * que alguien escribió, el precio que alguien puso y la descripción que alguien redactó.
 * Meter eso por el camino del scrape diario abriría la puerta a que una corrida cualquiera
 * pise trabajo humano. Se hace por un camino explícitamente de una sola vez.
 *
 * Y tampoco sirve `aplicarCuraduria`, que es la otra mitad de la migración: ésa hace UPDATE
 * sobre un producto que la ficha del proveedor ya creó. Estos 177 no tienen ficha en el
 * proveedor —es la razón por la que no entraron— así que no hay nada que actualizar: hay
 * que crear.
 *
 * ES CÓDIGO DE UN SOLO USO. Cuando los 177 estén dentro, esta carpeta se borra entera sin
 * tocar nada del scrape que sigue corriendo todos los días.
 */
import type { Ejecutar } from '../grilla.ts';
import type { ProductoDelViejo } from './parse.ts';

/**
 * De dónde salió el producto, en `productos.proveedor`.
 *
 * NO ES `chenson` Y NO ES `manual`, y la diferencia decide si el barrido diario funciona.
 *
 * Estos 177 son exactamente los productos que el proveedor YA NO PUBLICA. Con `chenson`,
 * el barrido les preguntaría al buscador del proveedor, recibiría `ausente` siempre, y
 * quedarían marcados de baja para siempre: 177 falsas alarmas permanentes, que es la mejor
 * forma de enseñarle a alguien a ignorar el lugar donde después aparece el aviso de verdad.
 *
 * Con `manual` el barrido sí los saltearía —los excluye desde el primer día— pero mentiría
 * sobre el origen: `url_origen` apunta al catálogo viejo en la fila de al lado. Un valor
 * propio dice la verdad y se excluye igual, porque `cola.ts` barre por LISTA BLANCA.
 */
export const PROVEEDOR_VIEJO = 'catalogo-viejo';

/**
 * El color de la única variante.
 *
 * `variantes.color` es NOT NULL y el catálogo viejo no da un color POR FOTO: lista los
 * colores como prosa a nivel producto. Este valor no se muestra nunca —con una sola
 * variante, `SelectorVariante.tsx` esconde el selector y no lo pone en el mensaje de
 * WhatsApp— así que su trabajo es no mentir, no quedar lindo.
 */
export const COLOR_UNICO = 'Único';

export interface ResultadoCreacion {
  productoId: number;
  /** `true` si el producto no existía. */
  creado: boolean;
  /**
   * SKU de la variante donde van las fotos, o `null` si el producto ya estaba.
   *
   * `null` es lo que hace barata la corrida repetida: sin variante nueva, quien llama no
   * vuelve a bajar las fotos de algo que ya tiene.
   */
  sku: string | null;
}

/**
 * Crea el producto y su variante. Devuelve qué pasó, para el resumen de la pantalla.
 *
 * NO TOCA UN PRODUCTO QUE YA EXISTE, en ningún estado y por ningún motivo. Es lo que hace
 * la corrida reanudable —se corta en el 120, se aprieta de nuevo y los 119 se saltean
 * solos— y también lo que la vuelve inofensiva: los 189 que ya migraron y los 13 cargados
 * por otro camino no se enteran de que esto corrió.
 *
 * Los `eliminado` cuentan como existentes, igual que en `codigosExistentes`: un producto en
 * la papelera sigue teniendo su código tomado y su URL viva. Volver a crearlo resucitaría
 * algo que alguien sacó del catálogo a propósito.
 */
export async function crearDesdeViejo(
  ejecutar: Ejecutar,
  producto: ProductoDelViejo,
  { scrapeId, ahora }: { scrapeId: number | null; ahora: string }
): Promise<ResultadoCreacion> {
  const codigo = producto.codigo.trim().toUpperCase();
  if (!codigo) throw new Error('El producto no tiene código: es la identidad del producto.');

  const nombre = producto.nombre.trim();
  if (!nombre) {
    /**
     * Lanza en vez de devolver un resultado: `productoDeParse` ya descarta los que no
     * tienen título, así que llegar acá sin nombre es un error de programación. Y un
     * importado sin nombre no se puede aprobar, o sea que entraría sólo para que alguien lo
     * descubra después mirando la grilla.
     */
    throw new Error(`El producto ${codigo} no trae nombre: sin nombre no se puede aprobar.`);
  }

  // Por `upper()` en los dos lados, igual que el índice único de la migración 0002: con la
  // collation BINARY de SQLite, `cyb2609` y `CYB2609` entrarían los dos.
  const [existente] = await ejecutar<{ id: number }>(
    `SELECT id FROM productos WHERE upper(codigo) = upper(?)`,
    [codigo]
  );
  if (existente) return { productoId: existente.id, creado: false, sku: null };

  /**
   * El SKU es el código pelado. Los del proveedor son `{codigo}-{codigoColor}`
   * (`CG85527-E`), así que no puede chocar con ninguno — pero un producto cargado a mano
   * puede tener cualquier SKU, y `variantes.sku` es UNIQUE.
   *
   * SE PREGUNTA ANTES DE INSERTAR EL PRODUCTO. `ejecutorD1` no da transacciones: insertar
   * el producto y fallar en la variante dejaría un producto sin ningún lugar donde colgar
   * sus fotos, o sea inservible y difícil de notar. Y el error crudo del UNIQUE es
   * exactamente lo que §10 prohíbe mostrar en el admin.
   */
  const sku = codigo;
  const [tomado] = await ejecutar<{ sku: string }>(`SELECT sku FROM variantes WHERE sku = ?`, [sku]);
  if (tomado) {
    throw new Error(
      `El SKU ${sku} ya está en uso por otro producto, así que ${codigo} no se creó. Hay que revisarlo a mano.`
    );
  }

  const [fila] = await ejecutar<{ id: number }>(
    `INSERT INTO productos
       (codigo, proveedor, estado, nombre, descripcion, precio, url_origen, categoria_origen,
        scrape_id, creado_en, actualizado_en)
     VALUES (?, ?, 'importado', ?, ?, ?, ?, NULL, ?, ?, ?)
     RETURNING id`,
    [
      codigo,
      PROVEEDOR_VIEJO,
      nombre,
      // `|| null` y no `?? null`: una cadena vacía le dibujaría a la ficha pública un
      // párrafo en blanco, porque el render pregunta por la descripción, no por su largo.
      producto.descripcion?.trim() || null,
      producto.precio,
      producto.urlOrigen,
      scrapeId,
      ahora,
      ahora,
    ]
  );

  /**
   * `estado` queda en `importado` y `slug` en NULL: entra como «Por aprobar», igual que
   * cualquier importación. Aprobar crea la dirección web definitiva y eso lo decide una
   * persona (§5.2). Que la migración traiga el nombre y el precio ya puestos no la autoriza
   * a publicar nada.
   *
   * `categoria_origen` en NULL a propósito: el catálogo viejo sí trae la categoría, pero su
   * taxonomía son 24 categorías partidas por género y público contra las 15 nuestras
   * partidas por tipo de producto. Ese mapeo es curaduría y se hace desde la grilla con la
   * acción en lote.
   */
  await ejecutar(
    // `color_hex` no se escribe: queda NULL, que es lo que corresponde a un color que nadie
    // midió (SPEC §6.6). `color_origen` tampoco: el origen no dio un color para ESTA foto.
    `INSERT INTO variantes (producto_id, sku, color, orden) VALUES (?, ?, ?, 0)`,
    [fila.id, sku, COLOR_UNICO]
  );

  return { productoId: fila.id, creado: true, sku };
}
