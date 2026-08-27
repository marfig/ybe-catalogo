/**
 * El aviso de que el proveedor sirvió un color del que no sale un SKU.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO. `registrarFicha` viene informando `coloresSinNombre` desde
 * siempre, el endpoint lo devuelve, y NADIE lo miraba. Lo que costó, medido el 2026-08-27:
 * los productos de outlet traen el título con un asterisco entre el código y el color
 * —`Producto: 0031688 *(O8) NARANJA/LIL`— que el regex no reconocía. Sin color no hay SKU,
 * sin SKU no se crea la variante, y sin variante `fotosPorColor` descarta las fotos porque
 * no hay dónde colgarlas. 17 productos entraron sin variantes y sin fotos, en silencio, y
 * el síntoma apareció semanas después como «algunos productos no trajeron foto».
 *
 * El regex ya está arreglado. Esto es lo que hace que la PRÓXIMA vez que el proveedor
 * cambie el formato se vea en la corrida en vez de descubrirse por un hueco en el catálogo.
 *
 * VIVE EN UN MÓDULO PROPIO Y NO EN CADA CLIENTE porque lo usan los dos —la importación y la
 * recuperación de fotos— y un texto duplicado es uno que se corrige en un solo lado. No
 * importa nada: se puede empaquetar para el navegador sin arrastrar código de servidor, que
 * es lo que descarta ponerlo en `registrar.ts` junto a quien produce el número.
 */

/**
 * El motivo para la lista de problemas, o `null` si no hay nada que avisar.
 *
 * Devuelve `null` en vez de cadena vacía para que quien llama tenga que decidir: un `if`
 * sobre el resultado es una línea, y una cadena vacía anotada como problema sería una fila
 * en blanco en la lista.
 *
 * ACEPTA `undefined` a propósito: la respuesta del endpoint es JSON sin garantías, y una
 * versión vieja del Worker no manda el campo. Que falte no puede hacer ruido.
 */
export function avisoDeColoresSinNombre(cuantos: number | undefined | null): string | null {
  if (typeof cuantos !== 'number' || !Number.isFinite(cuantos) || cuantos < 1) return null;

  const plural = cuantos === 1 ? 'color' : 'colores';
  const esas = cuantos === 1 ? 'esa variante' : 'esas variantes';

  // Dice QUÉ pasó, QUÉ se perdió y DÓNDE mirar. Un «color inválido» a secas manda a leer
  // código; esto manda a mirar el título de la ficha, que es donde está la causa.
  return (
    `El proveedor no dio un color reconocible para ${cuantos} ${plural}: ` +
    `${esas} no se ${cuantos === 1 ? 'creó' : 'crearon'} y sus fotos no se pudieron cargar. ` +
    'Suele ser un cambio de formato en el título de la ficha.'
  );
}
