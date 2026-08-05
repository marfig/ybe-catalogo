/**
 * Reporte de cambios del volcado.
 *
 * No es cosmetica. Quien publica no entra a GitHub (SPEC-etapa2 §11.3), asi que el
 * log de la Action es lo unico que cuenta lo que paso — y "el archivo cambio" no
 * distingue una publicacion normal de un volcado que borro medio catalogo.
 *
 * PIEZA PURA: compara dos catalogos ya construidos.
 */

/** Igualdad estructural por serializacion con claves ordenadas. */
function iguales(a, b) {
  return canonico(a) === canonico(b);
}

function canonico(valor) {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`;
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor);
  return `{${Object.keys(valor)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonico(valor[k])}`)
    .join(',')}}`;
}

/**
 * Compara dos catalogos y devuelve los ids de lo que cambio.
 *
 * Se indexa por `id` y NO se compara posicion contra posicion: el volcado emite
 * orden canonico, y si el orden contara, cualquier reordenado se leeria como
 * "cambiaron todos" y el reporte no serviria para nada.
 *
 * @param {object[] | null} anterior  `null` en el primer volcado
 * @param {object[]} nuevo
 */
export function comparar(anterior, nuevo) {
  const antes = new Map((anterior ?? []).map((p) => [p.id, p]));
  const despues = new Map(nuevo.map((p) => [p.id, p]));

  const altas = [];
  const bajas = [];
  const modificados = [];

  for (const [id, p] of despues) {
    if (!antes.has(id)) altas.push(id);
    else if (!iguales(antes.get(id), p)) modificados.push(id);
  }
  for (const id of antes.keys()) {
    if (!despues.has(id)) bajas.push(id);
  }

  const porTexto = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return {
    altas: altas.sort(porTexto),
    bajas: bajas.sort(porTexto),
    modificados: modificados.sort(porTexto),
  };
}

/** `1 alta`, `2 bajas`... con el plural bien, que despues se lee en un log. */
function contar(n, singular, plural) {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** Una linea para el log de la Action. */
export function resumir({ altas, bajas, modificados }) {
  if (altas.length === 0 && bajas.length === 0 && modificados.length === 0) {
    return 'sin cambios';
  }
  return [
    contar(altas.length, 'alta', 'altas'),
    contar(bajas.length, 'baja', 'bajas'),
    contar(modificados.length, 'modificado', 'modificados'),
  ].join(' · ');
}
