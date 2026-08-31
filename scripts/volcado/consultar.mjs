/**
 * Capa de consultas del volcado: D1 -> filas planas (SPEC-etapa2 §5.5).
 *
 * Es la UNICA pieza del volcado que necesita una base. `construir.mjs` es puro y
 * recibe estas filas tal cual, asi que la frontera entre las dos es donde vive
 * toda la E/S.
 *
 * El SQL no se ejecuta desde aca: `consultarFilas()` recibe un ejecutor. Con eso
 * la misma consulta corre contra D1 por HTTP en produccion y contra `node:sqlite`
 * en memoria en los tests. D1 ES SQLite, asi que el SQL que pasa los tests es el
 * que corre en produccion — un doble no daria esa garantia.
 */
import { PUBLICABLES } from './construir.mjs';

/**
 * Estados publicables, ordenados para que el SQL sea estable entre corridas.
 * Derivan de `construir.mjs`: una sola fuente de verdad.
 */
export const ESTADOS = [...PUBLICABLES].sort();

/** Parametros de las cuatro consultas: siempre la lista de estados. */
export const PARAMS = ESTADOS;

const HUECOS = ESTADOS.map(() => '?').join(', ');

/**
 * Las cuatro consultas.
 *
 * El filtro por estado es el MISMO en las cuatro, y eso no es redundancia: si los
 * hijos vinieran sin su padre, `construirProductos()` los leeria como huerfanos y
 * cortaria el volcado denunciando una corrupcion referencial que no existe.
 *
 * Corolario que conviene tener presente: por venir todo filtrado por un JOIN a
 * `productos`, las guardas de huerfanas de `construir.mjs` NO cubren este camino
 * — una fila realmente huerfana queda excluida por el JOIN, no denunciada. Esas
 * guardas protegen el contrato de la funcion pura; lo que protege la base son las
 * foreign keys, que D1 aplica (verificado en la fase 2.2).
 *
 * Los ORDER BY no son la garantia de determinismo — `construir.mjs` reordena todo
 * igual. Estan para que una lectura manual de la base sea comparable y para que
 * el plan de consulta use los indices del esquema.
 */
export const SQL = {
  productos: `
    SELECT id, codigo, proveedor, slug, nombre, descripcion, precio,
           estado, actualizado_en
      FROM productos
     WHERE estado IN (${HUECOS})
     ORDER BY id`,

  // `orden` es imprescindible, no informativo: construirProductos() ordena las
  // variantes por esa columna y de ahi sale que color se ve al abrir la ficha.
  variantes: `
    SELECT v.id, v.producto_id, v.sku, v.color, v.color_hex, v.activo, v.orden
      FROM variantes v
      JOIN productos p ON p.id = v.producto_id
     WHERE p.estado IN (${HUECOS})
     ORDER BY v.producto_id, v.orden, v.id`,

  /**
   * Pedidos especiales (SPEC.md §4.5). No lleva `PARAMS`: la tabla no tiene `estado`
   * ni `activo` — lo que esta cargado esta publicado, y la ficha que no va se borra.
   *
   * El JOIN a `imagenes` es INNER a proposito: `imagen_id` es NOT NULL con foreign
   * key, asi que una fila sin imagen es corrupcion referencial, no un caso a tolerar.
   * Si apareciera, `construirPedidosEspeciales` la denuncia por su slug.
   */
  pedidosEspeciales: `
    SELECT pe.slug, pe.nombre, pe.descripcion, pe.orden,
           i.hash16, i.anchos
      FROM pedidos_especiales pe
      JOIN imagenes i ON i.id = pe.imagen_id
     ORDER BY pe.orden, pe.slug`,

  // La imagen llega identificada por VARIANTE, no por su id: es la forma que
  // espera construirProductos(), que agrupa por variante_id.
  imagenes: `
    SELECT vi.variante_id, i.hash16, i.anchos, vi.orden
      FROM variante_imagenes vi
      JOIN imagenes i ON i.id = vi.imagen_id
      JOIN variantes v ON v.id = vi.variante_id
      JOIN productos p ON p.id = v.producto_id
     WHERE p.estado IN (${HUECOS})
     ORDER BY vi.variante_id, vi.orden, i.hash16`,

  categorias: `
    SELECT pc.producto_id, pc.categoria_slug, pc.orden
      FROM producto_categorias pc
      JOIN productos p ON p.id = pc.producto_id
     WHERE p.estado IN (${HUECOS})
     ORDER BY pc.producto_id, pc.orden, pc.categoria_slug`,
};

/**
 * Corre las cuatro consultas y devuelve las filas listas para
 * `construirProductos()`.
 *
 * @param {(sql: string, params: unknown[]) => Promise<object[]> | object[]} ejecutar
 */
export async function consultarFilas(ejecutar) {
  const [productos, variantes, imagenes, categorias, pedidosEspeciales] = await Promise.all([
    ejecutar(SQL.productos, PARAMS),
    ejecutar(SQL.variantes, PARAMS),
    ejecutar(SQL.imagenes, PARAMS),
    ejecutar(SQL.categorias, PARAMS),
    // Sin PARAMS: la consulta no filtra por estado, ver el comentario en SQL.
    ejecutar(SQL.pedidosEspeciales, []),
  ]);

  return { productos, variantes, imagenes, categorias, pedidosEspeciales };
}

/** Variables de entorno del volcado. En la Action salen de los secrets. */
const REQUERIDAS = ['CLOUDFLARE_ACCOUNT_ID', 'D1_DATABASE_ID', 'CLOUDFLARE_API_TOKEN'];

/**
 * Lee y valida la config de D1.
 *
 * Mismo criterio que `leerConfigR2()`: lista TODAS las que faltan de una vez.
 * Descubrir un secret sin configurar de a uno por corrida de Action es carisimo
 * en tiempo de vuelta.
 */
export function leerConfigD1(env) {
  const faltan = REQUERIDAS.filter((clave) => (env[clave] ?? '').trim() === '');

  if (faltan.length > 0) {
    throw new Error(
      `Config de D1 incompleta, faltan: ${faltan.join(', ')}.\n` +
        'El token necesita permiso de lectura sobre D1. En GitHub Actions van como secrets.'
    );
  }

  return {
    accountId: env.CLOUDFLARE_ACCOUNT_ID.trim(),
    databaseId: env.D1_DATABASE_ID.trim(),
    token: env.CLOUDFLARE_API_TOKEN.trim(),
  };
}

/** Endpoint de consulta de la API HTTP de D1. Puro para poder testearlo. */
export function endpointD1({ accountId, databaseId }) {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
}

/**
 * Ejecutor contra la API HTTP de D1 (SPEC-etapa2 §5.5).
 *
 * Se usa la API HTTP y no el binding porque el volcado corre en GitHub Actions,
 * fuera de Workers, y tampoco `wrangler d1 execute`: una consulta por proceso de
 * wrangler, parseando su salida, es mas fragil que un fetch.
 *
 * Los errores de D1 llegan con HTTP 200 y `success: false`, asi que mirar solo el
 * codigo de estado dejaria pasar un fallo de SQL como un resultado vacio — y un
 * volcado vacio borraria el catalogo entero de `productos.json`.
 */
export function ejecutorD1(config, buscar = fetch) {
  const url = endpointD1(config);

  return async (sql, params = []) => {
    const respuesta = await buscar(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    });

    const cuerpo = await respuesta.json().catch(() => null);

    if (!respuesta.ok) {
      throw new Error(`D1 respondio HTTP ${respuesta.status}: ${mensajeDeError(cuerpo)}`);
    }
    if (!cuerpo?.success) {
      throw new Error(`D1 rechazo la consulta: ${mensajeDeError(cuerpo)}`);
    }

    // `/query` devuelve un arreglo con un resultado por sentencia. Se manda una
    // sola, asi que el arreglo tiene exactamente un elemento.
    const resultados = cuerpo.result;
    if (!Array.isArray(resultados) || resultados.length !== 1) {
      // Nunca es 1 en esta rama, asi que el plural siempre corresponde.
      const cuantos = Array.isArray(resultados) ? resultados.length : 0;
      throw new Error(
        `D1 devolvio ${cuantos} resultados para una sola sentencia. Se esperaba exactamente uno.`
      );
    }

    return resultados[0].results ?? [];
  };
}

/** Aplana los errores que devuelve la API de Cloudflare a una linea legible. */
function mensajeDeError(cuerpo) {
  const errores = cuerpo?.errors;
  if (!Array.isArray(errores) || errores.length === 0) return 'sin detalle';
  return errores.map((e) => `${e.code ?? '?'} ${e.message ?? ''}`.trim()).join('; ');
}
