/**
 * Reconstruccion de las fichas impresas a partir de los fragmentos de una pagina.
 *
 * TODO ACA ES PURO: entra una lista de fragmentos posicionados (ver `pdf.mjs`) y sale
 * la ficha. Sin E/S, asi que se testea con fragmentos sinteticos y sin PDF — que es lo
 * unico posible, porque los PDF son material de temporada y no viven en el repo.
 *
 * EL PROBLEMA QUE RESUELVE ESTE ARCHIVO. El catalogo maqueta en dos y tres columnas,
 * asi que el texto de dos fichas vecinas COMPARTE RENGLON. Leer la pagina ordenando
 * por altura entrevera «(3) NEGRO» de una ficha con las medidas de la de al lado, y el
 * resultado no se nota roto: se nota como un producto que dice medir lo que mide otro.
 * Por eso no se lee la pagina como texto, se la lee como bloques anclados.
 */

/** «Ref.: 8130194», «Ref.:8130194», «Ref. 8130194». */
export const REFERENCIA = /Ref\.?\s*:?\s*(\d{6,9})/;

/** «Color (3) NEGRO», «(2) GRIS», «(Color (33X) NEGRO/NEGRO», «Color (3)NEGRO». */
const COLOR = /\((\w{1,4}(?:-\w{1,2})?)\)\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s./]*)/;

/** «49 x 36 x 19 cm», «48,5 x 34 x 17cm», «45x 31x 15 cm.» */
const MEDIDAS = /(\d{1,3}(?:[.,]\d)?\s*x\s*\d{1,3}(?:[.,]\d)?\s*x\s*\d{1,3}(?:[.,]\d)?\s*c?m?)/i;

/**
 * Cuerpo minimo de un titulo de seccion.
 *
 * EL UMBRAL NO ES ARBITRARIO y es la unica forma de distinguirlos. En el catalogo 2026
 * los cinco titulos reales —BOLSO TÉRMICO, BOLSO, PORTAFOLIOS, MOCHILAS, MOCHILA
 * P/NOTEBOOK— estan todos a 29.6, y las etiquetas sueltas que se les parecen —«MOCHILA
 * TÉRMICA», «Porta notebook»— a 8.5. Por forma del texto son indistinguibles: las dos
 * son mayusculas sin parentesis. Si un catalogo futuro sale con otros cuerpos, ESTE es
 * el numero a mover, y el sintoma sera una seccion de mas o de menos en el conteo que
 * imprime `index.mjs`.
 */
export const CUERPO_MINIMO_DE_TITULO = 13;

/** Un fragmento es titulo de seccion: mayusculas, cuerpo grande, sin referencia. */
export function esEncabezado(fragmento) {
  return (
    fragmento.cuerpo >= CUERPO_MINIMO_DE_TITULO &&
    !REFERENCIA.test(fragmento.texto) &&
    !fragmento.texto.includes('(') &&
    /^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s./]{3,}$/.test(fragmento.texto)
  );
}

/**
 * Cuanto pesa separarse en horizontal frente a separarse en vertical.
 *
 * DOBLE, y ese es el corazon del asunto: lo que separa dos fichas es la COLUMNA, no el
 * renglon. Dentro de una ficha el texto baja varios renglones pegado al mismo margen
 * izquierdo, asi que la distancia vertical dentro de un bloque es grande y la
 * horizontal casi cero. Con peso 1 el color de la columna derecha, que esta a pocos
 * renglones del ancla izquierda, se le asigna a la ficha equivocada.
 */
const PESO_HORIZONTAL = 2;

/** Tolerancia hacia arriba del ancla, en puntos. Absorbe el redondeo de la linea base. */
const TOLERANCIA_VERTICAL = 6;

/**
 * Reparte los fragmentos de una pagina entre sus anclas «Ref.:».
 *
 * Cada fragmento va al ancla mas cercana que este A SU MISMA ALTURA O POR ENCIMA: en
 * la maqueta impresa la referencia encabeza su bloque y el resto cuelga debajo. Sin esa
 * restriccion, la referencia de la ficha de abajo se roba las medidas de la de arriba.
 *
 * Devuelve las anclas en orden de lectura, cada una con sus fragmentos ya ordenados.
 */
export function repartirEnAnclas(fragmentos) {
  const anclas = fragmentos
    .filter((f) => REFERENCIA.test(f.texto))
    .map((f) => ({ ...f, referencia: f.texto.match(REFERENCIA)[1], hijos: [] }))
    .sort((a, b) => b.y - a.y || a.x - b.x);

  if (anclas.length === 0) return [];

  for (const fragmento of fragmentos) {
    if (REFERENCIA.test(fragmento.texto) || esEncabezado(fragmento)) continue;

    let elegida = null;
    let mejor = Infinity;
    for (const ancla of anclas) {
      if (fragmento.y > ancla.y + TOLERANCIA_VERTICAL) continue;
      const costo = Math.abs(fragmento.x - ancla.x) * PESO_HORIZONTAL + (ancla.y - fragmento.y);
      if (costo < mejor) {
        mejor = costo;
        elegida = ancla;
      }
    }
    if (elegida) elegida.hijos.push(fragmento);
  }

  for (const ancla of anclas) ancla.hijos.sort((a, b) => b.y - a.y || a.x - b.x);

  return anclas;
}

/**
 * Lee una ficha a partir de las lineas que cuelgan de su referencia.
 *
 * El orden de las comprobaciones importa: «Medidas aprox.:» y «(alto x largo x ancho)»
 * son rotulos y no datos, y hay que descartarlos ANTES de buscar colores, porque
 * «(alto x largo x ancho)» matchea la forma de un codigo de color entre parentesis.
 *
 * Lo que no cae en ninguna categoria se guarda en `notas` en vez de tirarse: ahi
 * aparecen las etiquetas sueltas del impreso («Porta notebook», «sin tira larga») y,
 * si un catalogo futuro trae un dato nuevo, aparece ahi en vez de desaparecer en
 * silencio. `index.mjs` las imprime para que se vean.
 */
export function leerFicha(lineas) {
  const colores = [];
  const notas = [];
  let enAlternativos = false;
  let consultarOtros = false;
  let medidas = null;

  for (const linea of lineas) {
    if (/Consulte|Consultar/i.test(linea)) {
      consultarOtros = true;
      continue;
    }
    if (/disponible\s+tambi|tambi[eé]n\s+disponible/i.test(linea)) {
      enAlternativos = true;
      continue;
    }
    if (/alto\s*x\s*largo/i.test(linea)) continue;
    if (/Medidas/i.test(linea) && !MEDIDAS.test(linea)) continue;

    const conMedidas = linea.match(MEDIDAS);
    if (conMedidas && medidas === null) {
      medidas = conMedidas[1]
        .replace(/\s+/g, ' ')
        .replace(/\s*c?m?$/i, '')
        .trim();
      continue;
    }

    const conColor = linea.match(COLOR);
    if (conColor) {
      colores.push({
        codigo: conColor[1].toUpperCase(),
        nombre: conColor[2].replace(/\s+/g, ' ').trim(),
        // El primero es el color de portada; a partir del rotulo «Tambien disponible
        // en:» todos son alternativos. Se mira tambien la posicion porque hay fichas
        // que listan un segundo color sin rotulo de por medio.
        alternativo: enAlternativos || colores.length > 0,
      });
      continue;
    }

    notas.push(linea);
  }

  return { colores, consultarOtros, medidas, notas };
}
