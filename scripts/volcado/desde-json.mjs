/**
 * `productos.json` -> filas de D1: la INVERSA del volcado (SPEC-etapa2 §5.5).
 *
 * Migracion de una sola vez para llevar a la base el catalogo que hoy vive en el
 * JSON comiteado. Despues de esto la fuente de verdad es D1 y esta direccion no se
 * vuelve a usar en produccion — pero se queda, porque el ida y vuelta
 * `JSON -> D1 -> JSON` es el test mas fuerte que tiene el volcado: si una de las
 * dos direcciones pierde un campo, lo delata.
 *
 * PIEZA PURA: no lee disco ni red. Los metadatos de las imagenes se INYECTAN
 * porque no estan en el JSON y hay que medirlos sobre `samples/`.
 */

/** Ids explicitos y secuenciales: hacen la siembra determinista y sin RETURNING. */
const primerId = 1;

/**
 * Datos de origen de una imagen que el JSON no guarda y el esquema exige.
 *
 * `ancho_origen`, `alto_origen` y `bytes_origen` son NOT NULL. No estan en
 * `productos.json` porque describen el archivo ORIGINAL, no la derivada: se miden
 * sobre `samples/` cruzando por hash16.
 *
 * @typedef {Map<string, {ancho: number, alto: number, bytes: number}>} Metadatos
 */

/** El hash16 sale de la clave de contenido: `catalogo/{hash16}`. */
function hashDeBase(base, sku) {
  const partes = String(base).split('/');
  if (partes.length !== 2 || partes[0] !== 'catalogo') {
    throw new Error(`${sku}: base de imagen inesperada: ${JSON.stringify(base)}. Se espera "catalogo/{hash16}".`);
  }
  return partes[1];
}

/**
 * Convierte el catalogo del JSON a filas de las cinco tablas.
 *
 * Devuelve la forma NORMALIZADA de la base — `imagenes` aparte de
 * `varianteImagenes` — no la forma plana que consume `construirProductos()`. Esa
 * la produce `consultarFilas()` leyendo la base, que es justamente lo que el ida y
 * vuelta ejercita.
 *
 * @param {object[]} catalogo  el arreglo de `productos.json`
 * @param {Metadatos} metadatos
 * @param {{ahora: string}} opciones fecha de `creado_en` cuando el producto no la trae
 */
export function aFilas(catalogo, metadatos, { ahora }) {
  const productos = [];
  const variantes = [];
  const imagenes = [];
  const varianteImagenes = [];
  const categorias = [];

  /** hash16 -> id de la fila de imagenes. Dedupe por contenido (SPEC §6.8). */
  const idPorHash = new Map();

  let idProducto = primerId;
  let idVariante = primerId;
  let idImagen = primerId;

  for (const p of catalogo) {
    const codigo = p.origen?.ref;
    if (!codigo) {
      throw new Error(`${p.id}: sin origen.ref. Es el codigo, o sea la identidad de negocio (§5.3).`);
    }

    // El JSON no guarda `estado`: guarda `activo`, que es su proyeccion. Solo
    // `eliminado` lo apaga, asi que la inversa es directa. Todo lo que esta en el
    // JSON comiteado ya estuvo publicado, de ahi `publicado`.
    const estado = p.activo === false ? 'eliminado' : 'publicado';

    // El JSON solo tiene la FECHA (`actualizado`), no un timestamp. Se guarda tal
    // cual en vez de rellenar con T00:00:00Z: inventar una hora seria precision
    // falsa, y `construirProductos()` lee los primeros 10 caracteres igual.
    const fecha = p.actualizado ?? ahora;

    productos.push({
      id: idProducto,
      codigo,
      proveedor: p.origen.proveedor,
      slug: p.id,
      nombre: p.nombre,
      descripcion: p.descripcion ?? null,
      precio: p.precio ?? null,
      destacado: p.destacado === true ? 1 : 0,
      estado,
      creado_en: fecha,
      actualizado_en: fecha,
      publicado_en: fecha,
    });

    p.categorias.forEach((slug, orden) => {
      // El orden se guarda porque categorias[0] es el breadcrumb (§5.1). Sin esto
      // el volcado las reordenaria y cambiaria la navegacion.
      categorias.push({ producto_id: idProducto, categoria_slug: slug, orden });
    });

    p.variantes.forEach((v, ordenVariante) => {
      variantes.push({
        id: idVariante,
        producto_id: idProducto,
        sku: v.sku,
        color: v.color,
        // El literal del proveedor ('(P) ROSADO') no esta en el JSON: se perdio en
        // la normalizacion de la etapa 1 y no se inventa.
        color_origen: null,
        color_hex: v.colorHex ?? null,
        activo: v.activo === false ? 0 : 1,
        orden: ordenVariante,
      });

      v.imagenes.forEach((img, ordenImagen) => {
        const hash = hashDeBase(img.base, v.sku);

        if (!idPorHash.has(hash)) {
          const meta = metadatos.get(hash);
          if (!meta) {
            throw new Error(
              `${v.sku}: la imagen ${hash} viene sin metadatos de origen. ` +
                'ancho_origen, alto_origen y bytes_origen son NOT NULL y se miden sobre samples/.'
            );
          }
          idPorHash.set(hash, idImagen);
          imagenes.push({
            id: idImagen,
            hash16: hash,
            // El esquema guarda los anchos como JSON (§5.1).
            anchos: JSON.stringify(img.anchos),
            ancho_origen: meta.ancho,
            alto_origen: meta.alto,
            bytes_origen: meta.bytes,
            creado_en: fecha,
          });
          idImagen++;
        }

        varianteImagenes.push({
          variante_id: idVariante,
          imagen_id: idPorHash.get(hash),
          orden: ordenImagen,
        });
      });

      idVariante++;
    });

    idProducto++;
  }

  return { productos, variantes, imagenes, varianteImagenes, categorias };
}

/** Arma un INSERT con placeholders a partir de las claves de la fila. */
function insertar(tabla, fila) {
  const columnas = Object.keys(fila);
  return {
    sql: `INSERT INTO ${tabla} (${columnas.join(', ')}) VALUES (${columnas.map(() => '?').join(', ')})`,
    params: columnas.map((c) => fila[c]),
  };
}

/**
 * Sentencias listas para pasarle al mismo ejecutor que usa `consultar.mjs`.
 *
 * El ORDEN NO ES COSMETICO: con foreign keys activas — y D1 las aplica — una
 * variante antes de su producto revienta. Padres primero, tablas puente al final.
 */
export function sentencias({ productos, variantes, imagenes, varianteImagenes, categorias }) {
  return [
    ...productos.map((f) => insertar('productos', f)),
    ...imagenes.map((f) => insertar('imagenes', f)),
    ...variantes.map((f) => insertar('variantes', f)),
    ...categorias.map((f) => insertar('producto_categorias', f)),
    ...varianteImagenes.map((f) => insertar('variante_imagenes', f)),
  ];
}

/** Tablas de la siembra, en orden INVERSO de dependencia: sirve para limpiar. */
export const TABLAS_SEMBRADAS = [
  'variante_imagenes',
  'producto_categorias',
  'variantes',
  'imagenes',
  'productos',
];

/**
 * Un valor como literal de SQL.
 *
 * Existe porque la migracion se aplica con `wrangler d1 execute --file`, que toma
 * SQL plano y no acepta parametros. Con un apostrofo en una descripcion, concatenar
 * sin escapar produce un error de sintaxis — o algo peor.
 */
export function comoLiteral(valor) {
  if (valor === null || valor === undefined) return 'NULL';
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) throw new Error(`valor numerico no finito: ${valor}`);
    return String(valor);
  }
  if (typeof valor === 'boolean') return valor ? '1' : '0';
  if (typeof valor !== 'string') {
    throw new Error(`tipo no soportado en un literal SQL: ${typeof valor}`);
  }
  return `'${valor.replace(/'/g, "''")}'`;
}

/** Las sentencias como un guion de SQL plano, una por linea, con `;`. */
export function comoGuionSql(lista) {
  return lista
    .map(({ sql, params }) => {
      let i = 0;
      return `${sql.replace(/\?/g, () => comoLiteral(params[i++]))};`;
    })
    .join('\n');
}
