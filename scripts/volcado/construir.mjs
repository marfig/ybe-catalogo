/**
 * Volcado D1 -> productos.json (SPEC-etapa2 §5.5).
 *
 * PIEZA PURA: recibe las filas tal como las devuelve D1 y devuelve la estructura
 * de SPEC §4.4. No toca red, ni base, ni disco. Toda la E/S vive en index.mjs.
 *
 * Dos razones para que sea pura:
 *   1. Se testea con `node --test`, sin workerd ni credenciales.
 *   2. El determinismo se puede verificar llamandola dos veces (SPEC §6.5).
 */

/**
 * Estados que llegan al catalogo. `importado` queda afuera: datos incompletos
 * (SPEC-etapa2 §5.2).
 */
const PUBLICABLES = new Set(['aprobado', 'publicado', 'eliminado']);

/** Anchos declarados como literales en content.config.ts. */
const ANCHOS_VALIDOS = new Set([300, 600]);

const RE_HASH16 = /^[0-9a-f]{16}$/;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}/;

/**
 * Comparador por punto de codigo. NO se usa `localeCompare`.
 *
 * `localeCompare` depende del ICU del runtime, asi que la GitHub Action y una
 * maquina local podrian ordenar distinto y el volcado dejaria de ser
 * deterministico. Es el mismo riesgo que SPEC §9.3 evita al formatear precios en
 * build en vez de en el navegador.
 */
const porTexto = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Agrupa filas por una clave numerica. */
function agrupar(filas, clave) {
  const mapa = new Map();
  for (const fila of filas) {
    const k = fila[clave];
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(fila);
  }
  return mapa;
}

/** D1 devuelve 0/1 por booleano; se aceptan tambien booleanos nativos. */
const aBool = (v) => v === 1 || v === true;

function normalizarAnchos(crudo, codigo, hash16) {
  let anchos;
  try {
    anchos = typeof crudo === 'string' ? JSON.parse(crudo) : crudo;
  } catch {
    throw new Error(`${codigo}: anchos no es JSON valido en la imagen ${hash16}: ${crudo}`);
  }

  if (!Array.isArray(anchos) || anchos.length === 0) {
    throw new Error(`${codigo}: la imagen ${hash16} no declara ningun ancho`);
  }

  for (const a of anchos) {
    if (!ANCHOS_VALIDOS.has(a)) {
      throw new Error(
        `${codigo}: ancho ${a} invalido en la imagen ${hash16}. ` +
          `content.config.ts solo acepta 300 o 600 (SPEC §5.2).`
      );
    }
  }

  // Ascendente: srcSetImagen() los emite de menor a mayor.
  return [...anchos].sort((a, b) => a - b);
}

function construirImagenes(filas, codigo) {
  return [...filas]
    .sort((a, b) => a.orden - b.orden || porTexto(a.hash16, b.hash16))
    .map((img) => {
      if (!RE_HASH16.test(img.hash16 ?? '')) {
        // Una base mal formada NO produce un error: produce una imagen rota en
        // produccion, que es mucho mas caro de diagnosticar. Mismo criterio que
        // validarBaseR2() en src/lib/imagenes.ts.
        throw new Error(
          `${codigo}: hash16 mal formado: ${JSON.stringify(img.hash16)}. ` +
            `Se esperan 16 caracteres hex minusculos.`
        );
      }
      return {
        base: `catalogo/${img.hash16}`,
        anchos: normalizarAnchos(img.anchos, codigo, img.hash16),
      };
    });
}

function construirVariantes(filas, porVariante, codigo) {
  // Alfabetico por color, NO por la columna `orden` del proveedor. Sin esto el
  // JSON cambiaria entre corridas segun el orden en que el origen devuelve los
  // colores, y se caeria la idempotencia (SPEC §6.6).
  return [...filas]
    .sort((a, b) => porTexto(a.color, b.color) || porTexto(a.sku, b.sku))
    .map((v) => {
      const variante = {
        sku: v.sku,
        color: v.color,
        imagenes: construirImagenes(porVariante.get(v.id) ?? [], codigo),
      };

      // Nunca se inventa un hex: sin el, el selector cae a boton con texto
      // (SPEC §6.6). Se omite la clave porque en el schema es .optional().
      if (v.color_hex) variante.colorHex = v.color_hex;

      // `activo` tiene default true: se omite salvo que sea false, para que el
      // diff de git no se llene de ruido (SPEC §6.5).
      if (!aBool(v.activo)) variante.activo = false;

      return variante;
    });
}

/**
 * Construye el arreglo de productos de `src/data/productos.json`.
 *
 * @param {object} filas
 * @param {object[]} filas.productos
 * @param {object[]} filas.variantes
 * @param {object[]} filas.imagenes
 * @param {object[]} filas.categorias
 */
export function construirProductos({ productos = [], variantes = [], imagenes = [], categorias = [] }) {
  const idsConocidos = new Set(productos.map((p) => p.id));

  // Una fila huerfana indica corrupcion referencial en la base, no un caso a
  // tolerar: se corta antes de escribir un JSON silenciosamente incompleto.
  for (const v of variantes) {
    if (!idsConocidos.has(v.producto_id)) {
      throw new Error(`variante ${v.sku} apunta al producto ${v.producto_id}, que no existe`);
    }
  }
  const idsVariantes = new Set(variantes.map((v) => v.id));
  for (const img of imagenes) {
    if (!idsVariantes.has(img.variante_id)) {
      throw new Error(`imagen ${img.hash16} apunta a la variante ${img.variante_id}, que no existe`);
    }
  }

  const porProductoCategorias = agrupar(categorias, 'producto_id');
  const porProductoVariantes = agrupar(variantes, 'producto_id');
  const porVarianteImagenes = agrupar(imagenes, 'variante_id');

  const salida = [];

  for (const p of productos) {
    if (!PUBLICABLES.has(p.estado)) continue;

    const codigo = p.codigo;

    // El slug se genera al aprobar (SPEC-etapa2 §5.2). Si falta a esta altura,
    // estado y slug quedaron desincronizados: es un bug, no un dato.
    if (!p.slug) {
      throw new Error(`${codigo}: estado "${p.estado}" sin slug. El slug se asigna al aprobar.`);
    }
    if (!p.nombre) {
      throw new Error(`${codigo}: sin nombre. Es obligatorio para aprobar (SPEC-etapa2 §5.2).`);
    }
    if (!RE_FECHA.test(p.actualizado_en ?? '')) {
      throw new Error(`${codigo}: actualizado_en no es una fecha ISO: ${p.actualizado_en}`);
    }

    const cats = [...(porProductoCategorias.get(p.id) ?? [])]
      .sort((a, b) => a.orden - b.orden || porTexto(a.categoria_slug, b.categoria_slug))
      .map((c) => c.categoria_slug);

    // min(1) en content.config.ts. Fallar aca da el codigo del producto; fallar
    // en `astro build` da un error de Zod sin decir cual de 1.500 productos es.
    if (cats.length === 0) {
      throw new Error(`${codigo}: sin categorias. Un producto sin categoria es inalcanzable.`);
    }

    const vs = construirVariantes(porProductoVariantes.get(p.id) ?? [], porVarianteImagenes, codigo);
    if (vs.length === 0) {
      throw new Error(`${codigo}: sin variantes. Sin variante no hay imagen ni SKU.`);
    }

    const producto = {
      id: p.slug,
      nombre: p.nombre,
      categorias: cats,
      // nullable pero NO optional: la clave va siempre. null = "Consultar precio".
      precio: p.precio ?? null,
      variantes: vs,
      // z.iso.date() no acepta un timestamp completo.
      actualizado: p.actualizado_en.slice(0, 10),
      origen: { proveedor: p.proveedor, ref: codigo },
    };

    if (p.descripcion) producto.descripcion = p.descripcion;
    if (aBool(p.destacado)) producto.destacado = true;

    // Solo `eliminado` apaga el producto. Los demas estados publicables usan el
    // default true del schema y omiten la clave.
    if (p.estado === 'eliminado') producto.activo = false;

    salida.push(producto);
  }

  // Orden estable por id: sin esto un producto saltaria de lugar entre volcados
  // y el diff de git seria ilegible (SPEC §6.5).
  return salida.sort((a, b) => porTexto(a.id, b.id));
}

/** Reconstruye recursivamente con las claves en orden alfabetico. */
function ordenarClaves(valor) {
  if (Array.isArray(valor)) return valor.map(ordenarClaves);
  if (valor === null || typeof valor !== 'object') return valor;

  const ordenado = {};
  for (const clave of Object.keys(valor).sort(porTexto)) {
    ordenado[clave] = ordenarClaves(valor[clave]);
  }
  return ordenado;
}

/**
 * Serializa a la forma exacta que se comitea.
 *
 * Claves alfabeticas, indentacion de 2 espacios y salto de linea final: misma
 * entrada => bytes identicos, para que el diff de git sea legible y un volcado
 * sin cambios no genere un commit vacio (SPEC §6.5).
 */
export function serializar(productos) {
  return `${JSON.stringify(ordenarClaves(productos), null, 2)}\n`;
}
