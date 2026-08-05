/**
 * Generacion del slug de un producto (SPEC.md §6.7, SPEC-etapa2 §5.2).
 *
 * PIEZA PURA.
 *
 * El slug se genera UNA sola vez, al aprobar — es el momento exacto en que la URL
 * empieza a existir — y desde ahi es inmutable. Vive en conversaciones de WhatsApp
 * que nadie va a corregir, asi que un bug aca no se arregla despues: se arrastra o
 * rompe un enlace. Renombrar un producto publicado cambia el `nombre`, nunca el slug.
 */

/**
 * Largo maximo del slug.
 *
 * No hay limite tecnico; el limite es humano. Un slug de 200 caracteres produce una
 * URL que no se puede leer ni pegar en un mensaje, que es justo para lo que existe.
 */
export const LARGO_MAXIMO = 60;

/** Traducciones que `NFD` no resuelve porque no son letras con acento. */
const EQUIVALENCIAS: Array<[RegExp, string]> = [
  [/×/g, 'x'], // signo de multiplicacion: '2×1' -> '2x1'
  [/[ßẛ]/g, 's'],
  [/[øØ]/g, 'o'],
  [/[đĐ]/g, 'd'],
  [/[łŁ]/g, 'l'],
  [/æÆ/g, 'ae'],
];

/**
 * Recorta a `LARGO_MAXIMO` cortando en un guion.
 *
 * Cortar por posicion dejaria la ultima palabra mutilada (`...para-noteb`), que se
 * lee como un error de programa. Si no hay ningun guion antes del limite se corta
 * duro: una sola palabra de 60+ caracteres no tiene mejor salida.
 */
function recortar(slug: string, largo: number): string {
  if (slug.length <= largo) return slug;
  const cortado = slug.slice(0, largo);
  const ultimoGuion = cortado.lastIndexOf('-');
  return (ultimoGuion > 0 ? cortado.slice(0, ultimoGuion) : cortado).replace(/-+$/, '');
}

/**
 * Slug base a partir del nombre.
 *
 * LANZA si no queda nada slugificable. Devolver cadena vacia produciria la URL
 * `/productos/`, que no es la ficha de nadie, y el UNIQUE de la base lo dejaria
 * pasar una vez porque SQLite admite varios NULL pero una cadena vacia es un valor.
 * Publicar un producto inalcanzable es peor que cortar.
 */
export function slugificar(nombre: string): string {
  let texto = (nombre ?? '').normalize('NFD').toLowerCase();
  for (const [patron, reemplazo] of EQUIVALENCIAS) texto = texto.replace(patron, reemplazo);

  const slug = recortar(
    texto
      // Marcas diacriticas que NFD separo: asi 'ñ' -> 'n' y 'á' -> 'a' (§6.7).
      .replace(/[̀-ͯ]/g, '')
      // Todo lo que no sea alfanumerico ASCII pasa a separador.
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, ''),
    LARGO_MAXIMO
  );

  if (slug === '') {
    throw new Error(
      `No se pudo derivar un slug de ${JSON.stringify(nombre)}: no quedan letras ni numeros. ` +
        'Hace falta un nombre con al menos un caracter alfanumerico.'
    );
  }
  return slug;
}

/**
 * Primer slug libre a partir de `base`, sufijando `-2`, `-3`... (§6.7).
 *
 * NO muta `tomados`: quien llama decide cuando registrar el slug. Mutar aca haria
 * que un intento fallido igual reserve el nombre.
 */
export function slugUnico(base: string, tomados: ReadonlySet<string>): string {
  if (!tomados.has(base)) return base;

  for (let n = 2; ; n++) {
    const sufijo = `-${n}`;
    // El base se recorta para que el sufijo entre: si el base ya estaba en el
    // limite, concatenar lo pasaria.
    const candidato = `${recortar(base, LARGO_MAXIMO - sufijo.length)}${sufijo}`;
    if (!tomados.has(candidato)) return candidato;
  }
}
