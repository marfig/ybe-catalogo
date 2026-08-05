/**
 * Validaciones para pasar un producto a `aprobado` (SPEC-etapa2 §5.2).
 *
 * PIEZA PURA. Decide dos cosas a la vez: si el boton "Aprobar" se habilita, y que
 * dice la grilla debajo de cada producto (§10.3). De ahi que NO devuelva un
 * booleano: devuelve QUE falta, en texto mostrable.
 *
 * Un validador que solo dijera si/no obligaria a reimplementar los motivos en la
 * vista, y ahi es donde las dos versiones se separan sin que nadie se entere.
 */

/** Umbral del aviso de variacion de precio (SPEC-etapa2 §5.2-5). */
const VARIACION_AVISO = 0.25;

export interface VarianteParaValidar {
  sku: string;
  color: string;
  /** Cuantas imagenes tiene la variante. */
  imagenes: number;
}

export interface ProductoParaValidar {
  codigo: string;
  nombre: string | null;
  precio: number | null;
  categorias: string[];
  variantes: VarianteParaValidar[];
}

export interface OpcionesValidacion {
  /**
   * Slugs de `categorias.json`. La validacion no adivina cuales existen.
   *
   * `ReadonlySet` y no `Set`: esta funcion solo LEE, y declarar `Set` reclamaria el
   * derecho a mutar el conjunto de quien llama.
   */
  categoriasValidas: ReadonlySet<string>;
  /** Confirmacion explicita de publicar sin foto (§5.2-3, SPEC.md §5.4). */
  permitirSinFoto?: boolean;
  /** Precio de la publicacion anterior, para el aviso de variacion. */
  precioAnterior?: number | null;
}

export interface Resultado {
  puede: boolean;
  /** Lo que BLOQUEA la aprobacion. Vacio ⇒ se puede aprobar. */
  faltantes: string[];
  /** Lo que conviene saber pero no bloquea. */
  avisos: string[];
}

/** Formatea un porcentaje sin decimales, para un aviso legible. */
const porcentaje = (fraccion: number) => `${Math.round(Math.abs(fraccion) * 100)} %`;

export function validarParaAprobar(
  producto: ProductoParaValidar,
  { categoriasValidas, permitirSinFoto = false, precioAnterior = null }: OpcionesValidacion
): Resultado {
  const faltantes: string[] = [];
  const avisos: string[] = [];

  // 1. nombre no vacio.
  //
  // Un nombre igual al codigo cuenta como SIN nombre: el importador usa el codigo
  // como marcador cuando el overlay no trae titulo (SPEC.md §6.6). Aceptarlo
  // dejaria publicar "CG85900" como titulo, que es lo que el marcador evitaba.
  const nombre = (producto.nombre ?? '').trim();
  if (nombre === '' || nombre === producto.codigo) {
    faltantes.push('sin nombre');
  }

  // 2. al menos una categoria, y todas existentes en categorias.json.
  if (producto.categorias.length === 0) {
    faltantes.push('sin categoría');
  } else {
    const invalidas = producto.categorias.filter((c) => !categoriasValidas.has(c));
    if (invalidas.length > 0) {
      // Se nombran las invalidas y solo esas: culpar a las validas manda a buscar
      // el problema al lugar equivocado.
      faltantes.push(
        `${invalidas.length === 1 ? 'categoría inexistente' : 'categorías inexistentes'}: ` +
          invalidas.join(', ')
      );
    }
  }

  // 3. al menos una variante, con al menos una imagen o confirmacion explicita.
  if (producto.variantes.length === 0) {
    faltantes.push('sin variantes de color');
  } else {
    const conFoto = producto.variantes.some((v) => v.imagenes > 0);
    if (!conFoto) {
      if (permitirSinFoto) {
        // Se avisa igual: publicar sin foto es una decision tomada, no un silencio.
        avisos.push('se publica sin foto: se muestra el placeholder de "sin imagen"');
      } else {
        faltantes.push('sin fotos');
      }
    }
  }

  // 4. precio opcional. NULL es "Consultar precio", no un error.
  if (producto.precio === null) {
    avisos.push('sin precio: se publica como "Consultar precio"');
  } else if (producto.precio < 0) {
    faltantes.push('precio negativo');
  } else if (producto.precio === 0) {
    // Un cero es casi siempre un tipeo. No bloquea porque puede ser intencional,
    // pero no puede pasar callado.
    avisos.push('precio en 0: revisar si es un error de tipeo');
  }

  // 5. aviso, NO bloqueo, si el precio vario mas de ±25 %.
  if (
    producto.precio !== null &&
    producto.precio > 0 &&
    typeof precioAnterior === 'number' &&
    precioAnterior > 0 // evita la division por cero y el Infinity en el mensaje
  ) {
    const variacion = (producto.precio - precioAnterior) / precioAnterior;
    if (Math.abs(variacion) > VARIACION_AVISO) {
      avisos.push(
        `el precio ${variacion > 0 ? 'subió' : 'bajó'} ${porcentaje(variacion)} ` +
          `respecto del anterior (Gs. ${precioAnterior.toLocaleString('es-PY')})`
      );
    }
  }

  return { puede: faltantes.length === 0, faltantes, avisos };
}
