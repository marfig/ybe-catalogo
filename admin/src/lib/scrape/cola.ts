/**
 * A quién le toca ser revisado en el proveedor, y qué se anota con la respuesta.
 *
 * TODO EL BARRIDO SE APOYA EN EL ORDEN DE ESTA COLA. Se revisa primero lo que hace más
 * tiempo que nadie mira, y eso es lo que lo hace **reanudable**: se corta a los cinco
 * minutos, y la próxima corrida sigue por donde iba en vez de volver a empezar. Nadie
 * tiene que elegir un filtro ni acordarse de qué barrió la vez pasada — que es trabajo
 * que le toca a la máquina, no a la persona.
 *
 * Y ningún producto queda sin revisar nunca: el que no se mira se va volviendo el más
 * viejo hasta que le llega el turno. Es la propiedad que un barrido «por categoría» no
 * tiene, porque la categoría que no se elige no se revisa jamás.
 *
 * ESTE MÓDULO NO BORRA NADA. Marca, y una persona decide desde la grilla con el flujo
 * de eliminación que ya existe (§12.2).
 */
import type { Ejecutar, Sentencia } from '../grilla.ts';
import type { OpcionesTransicion, ResultadoItem } from '../transiciones.ts';
import type { Presencia } from './presencia.ts';

/** Un producto al que hay que preguntarle al proveedor. */
export interface Candidato {
  id: number;
  codigo: string;
  estado: string;
  revisado_en_origen: string | null;
  ausente_desde: string | null;
}

/**
 * A quién SÍ se le pregunta al proveedor.
 *
 *  - `proveedor = 'chenson'`: salió del proveedor, o sea que su buscador lo conoce y una
 *    respuesta «no está» significa algo.
 *  - `estado <> 'eliminado'`: los de la papelera no. Preguntar por ellos es gastar un
 *    request en algo sobre lo que ya se decidió.
 *
 * ES UNA LISTA BLANCA, y antes era negra —`proveedor <> 'manual'`—. El cambio no es de
 * estilo: con la lista negra, cualquier origen que se agregue entra a la cola por olvido, y
 * ya pasó. La migración del catálogo viejo trae 177 productos con
 * `proveedor = 'catalogo-viejo'` que son EXACTAMENTE los que el proveedor ya no publica: la
 * lista negra les preguntaría todos los días, recibiría `ausente` siempre, y los dejaría
 * marcados de baja para siempre. Un aviso permanente que es siempre falso enseña a ignorar
 * el lugar donde después aparece el de verdad.
 *
 * Los cargados a mano siguen afuera por la misma razón de siempre: el buscador del proveedor
 * no los conoce y los marcaría de baja igual.
 */
const BARRIBLES = `p.proveedor = 'chenson' AND p.estado <> 'eliminado'`;

/**
 * El orden de la cola.
 *
 * LOS NULOS PRIMERO —lo que nunca se revisó— y después de lo más viejo a lo más nuevo.
 *
 * El desempate por `publicado` va TERCERO y no primero, y la diferencia decide si el
 * barrido sirve para algo: si «publicado» ordenara antes que la fecha, cada corrida
 * volvería a revisar los mismos publicados, ya frescos, y el resto del catálogo no
 * llegaría nunca a su turno. Desempatando, hace lo que se quiere —en la primera
 * corrida, cuando todos son NULL, los de la calle salen antes— sin romper la rotación.
 *
 * Que estén publicados importa porque una baja ahí es un cliente pidiendo algo que no
 * existe; en un «por aprobar» es curaduría que alguien se ahorra.
 */
const ORDEN = `p.revisado_en_origen IS NULL DESC,
               p.revisado_en_origen ASC,
               (p.estado = 'publicado') DESC,
               p.codigo`;

/**
 * Cuántos productos entran en una corrida.
 *
 * A un pedido por segundo (§7.4) son cinco minutos de pestaña abierta, que es lo que se
 * puede pedir sin que nadie la cierre por aburrimiento. NO es un tope al catálogo: lo
 * que no entró queda primero en la cola de la próxima corrida, porque el orden es por
 * antigüedad. Se aprieta de nuevo y sigue.
 */
export const LIMITE_BARRIDO = 300;

/** Los próximos `limite` productos a revisar. */
export async function proximosABarrer(
  ejecutar: Ejecutar,
  { limite = LIMITE_BARRIDO }: { limite?: number } = {}
): Promise<Candidato[]> {
  return ejecutar<Candidato>(
    `SELECT p.id, p.codigo, p.estado, p.revisado_en_origen, p.ausente_desde
       FROM productos p
      WHERE ${BARRIBLES}
      ORDER BY ${ORDEN}
      LIMIT ?`,
    [limite]
  );
}

/**
 * Un candidato por id, o `null` si no existe.
 *
 * NO FILTRA POR ORIGEN NI POR ESTADO, y es lo que lo separa de la cola automática.
 *
 * Tildar un producto y mandarlo a revisar es una PREGUNTA EXPLÍCITA sobre ese producto, y
 * el código no la discute: todos se manejan por su código y así se buscan en el proveedor.
 * Que el buscador lo encuentre o no es información útil — también para uno cargado a mano,
 * cuyo código puede ser perfectamente un código del proveedor.
 *
 * ANTES SÍ FILTRABA, y estaba mal. Cuando la migración del catálogo viejo cambió
 * `BARRIBLES` a lista blanca para mantener sus 174 productos fuera de la ROTACIÓN
 * automática, este camino se llevó la misma regla de rebote: tildarlos devolvía «no hay
 * nada que revisar» sobre productos que el proveedor conoce perfectamente. Quién se
 * pregunta por qué producto lo decide quien opera, no esta función.
 *
 * Sigue existiendo para que el endpoint NO confíe en lo que le manda la pestaña: la página
 * rinde la cola una vez y puede quedar abierta horas, así que el id se resuelve contra la
 * base en el momento del pedido. Lo único que devuelve `null` es un id que no existe.
 */
export async function candidatoPorId(ejecutar: Ejecutar, id: number): Promise<Candidato | null> {
  const [fila] = await ejecutar<Candidato>(
    `SELECT p.id, p.codigo, p.estado, p.revisado_en_origen, p.ausente_desde
       FROM productos p
      WHERE p.id = ?`,
    [id]
  );
  return fila ?? null;
}

/**
 * Los candidatos de una selección hecha a mano en la grilla.
 *
 * Respeta el ORDEN DE LA COLA y no el de la selección: si alguien tilda 40 productos,
 * revisar primero los que hace más tiempo que nadie mira sigue siendo lo correcto.
 *
 * NO filtra por origen ni por estado, al revés que la cola automática: lo tildado se
 * revisa. Ver `candidatoPorId` para el por qué — y para el bug que arregló.
 */
export async function candidatosPorIds(ejecutar: Ejecutar, ids: number[]): Promise<Candidato[]> {
  if (ids.length === 0) return [];
  const huecos = ids.map(() => '?').join(', ');

  return ejecutar<Candidato>(
    `SELECT p.id, p.codigo, p.estado, p.revisado_en_origen, p.ausente_desde
       FROM productos p
      WHERE p.id IN (${huecos})
      ORDER BY ${ORDEN}`,
    ids
  );
}

/** Cuántos productos hay para revisar en total. Da el denominador del progreso. */
export async function contarBarribles(ejecutar: Ejecutar): Promise<number> {
  const [fila] = await ejecutar<{ cantidad: number }>(
    `SELECT COUNT(*) AS cantidad FROM productos p WHERE ${BARRIBLES}`
  );
  return fila?.cantidad ?? 0;
}

export interface MarcaBarrido {
  presencia: Presencia;
  /** El código, sólo para el mensaje de error. */
  codigo: string;
  ahora: string;
  /** La ficha que devolvió el buscador, si lo encontró. */
  url: string | null;
}

/**
 * Anota el resultado de revisar un producto.
 *
 * `indeterminado` NO ESCRIBE NADA, y es la mitad del valor de esta función. No saber
 * no es una respuesta: anotarlo como revisado lo mandaría al fondo de la cola y el
 * producto se quedaría sin mirar de verdad hasta la vuelta entera del catálogo,
 * escondiendo que el proveedor estuvo caído justo cuando le tocaba.
 */
export async function marcar(
  ejecutar: Ejecutar,
  id: number,
  { presencia, ahora, url }: MarcaBarrido
): Promise<void> {
  if (presencia === 'indeterminado') return;

  if (presencia === 'presente') {
    /**
     * `ausente_desde` vuelve a NULL: el proveedor repone modelos, y una marca de una
     * sola dirección dejaría dado de baja para siempre algo que volvió.
     *
     * `url_origen` se refresca con `COALESCE` porque el proveedor le cambia el
     * `idColor` a un producto cuando le mueve los colores, y la ficha guardada queda
     * vieja sin que nada lo note. Nunca se pisa con NULL: una URL vieja es mejor que
     * ninguna.
     */
    await ejecutar(
      `UPDATE productos
          SET revisado_en_origen = ?,
              ausente_desde      = NULL,
              url_origen         = COALESCE(?, url_origen)
        WHERE id = ?`,
      [ahora, url, id]
    );
    return;
  }

  /**
   * `COALESCE` sobre `ausente_desde`: es un «desde», no un «visto por última vez».
   * Pisarlo en cada corrida haría que un producto dado de baja hace tres meses dijera
   * siempre «hace un rato» — justo el dato con el que alguien decide si ya es hora.
   *
   * `actualizado_en` NO se toca acá a propósito: alimenta el aviso de «hay cambios sin
   * publicar» del Inicio (§11.3), y esta marca no cambia nada de lo que el sitio
   * muestra. Moverlo pediría publicar por un barrido que no publicó nada.
   */
  await ejecutar(
    `UPDATE productos
        SET revisado_en_origen = ?,
            ausente_desde      = COALESCE(ausente_desde, ?)
      WHERE id = ?`,
    [ahora, ahora, id]
  );
}

/** Sólo lo accionable: un producto ya en la papelera no es trabajo pendiente. */
const AUSENTES = `p.ausente_desde IS NOT NULL AND p.estado <> 'eliminado'`;

/** Cuántos productos están dados de baja en el origen. Alimenta el aviso del Inicio. */
export async function contarAusentes(ejecutar: Ejecutar): Promise<number> {
  const [fila] = await ejecutar<{ cantidad: number }>(
    `SELECT COUNT(*) AS cantidad FROM productos p WHERE ${AUSENTES}`
  );
  return fila?.cantidad ?? 0;
}

export interface FilaAusente {
  id: number;
  codigo: string;
  nombre: string | null;
  estado: string;
  slug: string | null;
  ausente_desde: string;
}

/**
 * Las bajas, de la más vieja a la más nueva.
 *
 * Al revés que la papelera, que ordena por lo más reciente: allá lo recién eliminado es
 * lo que más chance tiene de haber sido un error. Acá lo que lleva más tiempo dado de
 * baja es lo que más urge sacar del catálogo.
 */
export async function listarAusentes(
  ejecutar: Ejecutar,
  { limite = 200 }: { limite?: number } = {}
): Promise<FilaAusente[]> {
  return ejecutar<FilaAusente>(
    `SELECT p.id, p.codigo, p.nombre, p.estado, p.slug, p.ausente_desde
       FROM productos p
      WHERE ${AUSENTES}
      ORDER BY p.ausente_desde ASC, p.codigo
      LIMIT ?`,
    [limite]
  );
}

/**
 * Saca la marca de baja a mano, sin preguntarle al proveedor.
 *
 * ES LA UNICA SALIDA MANUAL de `ausente_desde`, y existe por un caso real: una corrida
 * de prueba dejo 8 productos marcados que el proveedor efectivamente NO tiene. Volver a
 * barrerlos los marcaba de nuevo —correctamente—, asi que el camino soportado no
 * alcanzaba y hubo que correr un UPDATE a mano sobre D1 de produccion. Una operacion que
 * termina en SQL escrito a mano sobre la base viva es una funcion que falta.
 *
 * VIVE ACA, con `marcar()`, y no en `transiciones.ts` donde estan las otras acciones en
 * lote de la grilla. `ausente_desde` es ORTOGONAL a `estado` —un producto puede estar en
 * el catalogo y dado de baja al mismo tiempo, y la grilla los muestra como dos ejes
 * distintos a proposito—, asi que esto no es una transicion. Lo que si comparte con
 * ellas es el contrato de salida, `ResultadoItem`, porque lo consume el mismo resumen.
 *
 * NO FILTRA POR ESTADO, por el mismo motivo que `candidatosPorIds`: lo que se tilda se
 * opera. Quien decide sobre que producto se pregunta es quien opera, no esta funcion.
 */
export async function desmarcarBaja(
  ejecutar: Ejecutar,
  ids: number[],
  { lote }: Pick<OpcionesTransicion, 'lote'>
): Promise<ResultadoItem[]> {
  if (ids.length === 0) return [];

  const huecos = ids.map(() => '?').join(', ');
  const productos = await ejecutar<{ id: number; codigo: string; ausente_desde: string | null }>(
    `SELECT id, codigo, ausente_desde
       FROM productos
      WHERE id IN (${huecos})
      ORDER BY codigo`,
    ids
  );

  const porId = new Map(productos.map((p) => [p.id, p]));
  const resultados: ResultadoItem[] = [];
  const sentencias: Sentencia[] = [];

  for (const p of productos) {
    if (p.ausente_desde === null) {
      // No habia nada que sacar. `omitido` y no `hecho`: no hay nada que corregir, pero
      // tampoco se escribio nada, y el resumen no puede decir que si.
      resultados.push({
        id: p.id,
        codigo: p.codigo,
        desenlace: 'omitido',
        motivo: 'no estaba marcado como baja',
      });
      continue;
    }

    /**
     * Se limpia `ausente_desde` y NADA MAS. Ni `revisado_en_origen`, que es el registro
     * honesto de que se miro —borrarlo mandaria el producto al frente de la cola del
     * barrido, que es trabajo inventado—, ni `actualizado_en`, por el mismo motivo por
     * el que no lo toca `marcar()`: alimenta el aviso de «hay cambios sin publicar»
     * (§11.3), y esto no cambia nada de lo que el sitio muestra.
     */
    sentencias.push({
      sql: `UPDATE productos SET ausente_desde = NULL WHERE id = ?`,
      params: [p.id],
    });
    resultados.push({ id: p.id, codigo: p.codigo, desenlace: 'hecho' });
  }

  for (const id of ids) {
    if (!porId.has(id)) resultados.push({ id, desenlace: 'fallo', motivo: 'no existe' });
  }

  if (sentencias.length > 0) await lote(sentencias);

  return resultados;
}
