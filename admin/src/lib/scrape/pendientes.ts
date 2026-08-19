/**
 * Los productos a los que les falta la descripción y se les puede pedir de nuevo.
 *
 * POR QUÉ EXISTE ESTO Y NO ALCANZA CON REIMPORTAR. El regex que reconoce la etiqueta de
 * medidas del proveedor sólo aceptaba una de sus dos redacciones (ver `ES_ETIQUETA_MEDIDAS`),
 * así que 438 productos entraron con `descripcion` en NULL. De esos, **432 son recuperables**:
 * los otros 6 están en la papelera y esta lista los excluye. Arreglado el regex, reimportar
 * seguía sin arreglarlos: las medidas se sembraban únicamente en el INSERT.
 *
 * Ahora `registrarFicha` también rellena una descripción vacía en el UPDATE, así que lo único
 * que falta es VOLVER A PASAR por esas fichas. Esta consulta es la lista de trabajo, y el
 * relleno lo hace `/api/scrape/ficha`, el endpoint de todos los días: no hay ningún camino de
 * escritura nuevo, y si el relleno funciona sobre esos 432 el arreglo queda probado.
 *
 * ES CÓDIGO DE UN SOLO USO. Cuando no queden productos sin descripción, esta función, su
 * pantalla y su endpoint se borran; el arreglo del regex y el COALESCE se quedan, que son los
 * que evitan que el problema vuelva.
 */
import type { Ejecutar } from '../grilla.ts';

/** Un producto al que hay que volver a pedirle la ficha. */
export interface PendienteDeDescripcion {
  id: number;
  codigo: string;
  /** La ficha del proveedor. Es lo que recibe `/api/scrape/ficha`. */
  url: string;
}

/**
 * A quién le falta la descripción.
 *
 * LAS CUATRO CONDICIONES, y las cuatro sacan productos que no se pueden resolver por acá:
 *
 *   descripción vacía   — `trim()` incluido: un `'   '` rinde un párrafo en blanco en la
 *                         ficha pública, así que es un hueco y no contenido.
 *   `proveedor = 'chenson'` — los `manual` no salieron de ningún origen, y los
 *                         `catalogo-viejo` son EXACTAMENTE los que el proveedor ya no
 *                         publica: pedirle su ficha traería una página que no existe. Es la
 *                         misma lista blanca que `cola.ts`, por el mismo motivo.
 *   `estado <> 'eliminado'` — ya se decidió sacarlos del catálogo. Si alguno se restaura,
 *                         vuelve a aparecer en esta lista solo.
 *   `url_origen` con algo — sin ficha no hay nada que pedir. Incluirlos daría un error por
 *                         producto en cada corrida, sobre algo que esto no puede resolver.
 *
 * INCLUYE LOS PUBLICADOS a propósito: un producto en la calle sin descripción es el caso que
 * más molesta, porque es el que un cliente está mirando. Rellenarlo no pisa nada — el
 * `COALESCE` de `registrarFicha` sólo escribe sobre NULL.
 *
 * Ordenado por código, que es estable entre corridas. Y no hace falta acordarse de por dónde
 * iba: lo ya rellenado sale de la lista solo, porque ya tiene descripción.
 */
export async function sinDescripcion(ejecutar: Ejecutar): Promise<PendienteDeDescripcion[]> {
  return ejecutar<PendienteDeDescripcion>(
    `SELECT id, codigo, url_origen AS url
       FROM productos
      WHERE trim(COALESCE(descripcion, '')) = ''
        AND proveedor = 'chenson'
        AND estado <> 'eliminado'
        AND COALESCE(url_origen, '') <> ''
      ORDER BY codigo`
  );
}
