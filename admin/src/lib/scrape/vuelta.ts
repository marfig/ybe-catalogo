/**
 * La vuelta del barrido: el ancla que hace que «cuánto falta» tenga respuesta.
 *
 * EL BARRIDO ES UNA ROTACIÓN Y LAS ROTACIONES NO TIENEN MEMORIA. Se revisan los 300 más
 * viejos, esos pasan a ser los más nuevos, y el catálogo queda tan barrible como estaba.
 * Cualquier cuenta derivada sólo del estado de `productos` da el mismo número siempre —y
 * ya salió mal dos veces, ver la migración `0009`—. Para que exista una cuenta regresiva
 * tiene que haber un punto de partida, y ese dato no está en los productos: está en
 * cuándo alguien decidió empezar la vuelta.
 *
 * UNA VUELTA NO ES UNA CORRIDA. La corrida son 300 productos y cinco minutos de pestaña
 * abierta; la vuelta es cubrir el catálogo entero y son varias corridas. Por eso viven en
 * tablas distintas: `scrapes` registra recorridos y guarda que no haya dos a la vez,
 * mientras que esto registra el progreso a través de ellos.
 */
import type { Ejecutar } from '../grilla.ts';

export interface Vuelta {
  id: number;
  iniciada_en: string;
  /** NULL mientras esté en curso. */
  terminada_en: string | null;
}

/**
 * La última vuelta, esté abierta o cerrada.
 *
 * DEVUELVE TAMBIÉN LAS CERRADAS a propósito: la pantalla tiene que distinguir «nunca se
 * barrió» —donde lo que corresponde es explicar qué va a pasar— de «la vuelta anterior se
 * completó», que es un logro y merece decirse. Buscar sólo la abierta haría que los dos
 * casos se vieran igual.
 */
export async function vueltaActual(ejecutar: Ejecutar): Promise<Vuelta | null> {
  const [fila] = await ejecutar<Vuelta>(
    `SELECT id, iniciada_en, terminada_en FROM barrido_vueltas ORDER BY id DESC LIMIT 1`
  );
  return fila ?? null;
}

/**
 * Abre la vuelta, o devuelve la que ya está en curso.
 *
 * ES IDEMPOTENTE, y ahí está todo el sentido de esta función. Cada corrida de 300 pasa
 * por `/api/scrape/abrir`, y una vuelta son varias corridas: si abrir empezara una vuelta
 * nueva cada vez, `iniciada_en` se correría al presente en cada corrida, todo el catálogo
 * volvería a estar pendiente y la cuenta regresiva no bajaría nunca. Sería el mismo bug
 * que esta tabla vino a cerrar, escrito de otra manera.
 *
 * La unicidad de la vuelta abierta la garantiza el índice de la migración `0009` y no
 * este `if`: entre el SELECT y el INSERT hay una ventana, y dos pestañas pueden pedir
 * abrir a la vez.
 *
 * PERO EL ÍNDICE SOLO NO ALCANZA. Deja la base bien y convierte la carrera en un 500 para
 * la pestaña que pierde, que es un error sobre algo que salió perfecto: la vuelta existe y
 * es la que esa pestaña quería. Por eso el choque se atrapa y se relee — el índice cuida
 * la base, este `catch` cuida la promesa de idempotencia.
 */
export async function abrirVuelta(
  ejecutar: Ejecutar,
  { ahora }: { ahora: string }
): Promise<Vuelta> {
  const actual = await vueltaActual(ejecutar);
  if (actual && actual.terminada_en === null) return actual;

  try {
    const [fila] = await ejecutar<Vuelta>(
      `INSERT INTO barrido_vueltas (iniciada_en) VALUES (?)
       RETURNING id, iniciada_en, terminada_en`,
      [ahora]
    );
    return fila;
  } catch (error) {
    /**
     * SÓLO el choque del índice se relee. Tragarse cualquier error dejaría una base rota
     * —una tabla que no existe, por ejemplo— pareciendo una carrera resuelta, y el barrido
     * seguiría adelante contando contra una vuelta imaginaria.
     */
    if (!/UNIQUE|constraint/i.test(String(error))) throw error;

    const ganadora = await vueltaActual(ejecutar);
    if (ganadora && ganadora.terminada_en === null) return ganadora;
    throw error;
  }
}

/**
 * Da la vuelta por completada.
 *
 * `WHERE terminada_en IS NULL`: el cierre lo dispara el render de la pantalla, que dos
 * pestañas pueden pedir a la vez sobre la misma vuelta ya terminada. La fecha que queda
 * es la del primer cierre, que es cuando se completó de verdad.
 */
export async function cerrarVuelta(
  ejecutar: Ejecutar,
  id: number,
  { ahora }: { ahora: string }
): Promise<void> {
  await ejecutar(
    `UPDATE barrido_vueltas SET terminada_en = ? WHERE id = ? AND terminada_en IS NULL`,
    [ahora, id]
  );
}

export interface DatosDeVuelta {
  /** La última vuelta, abierta o cerrada. `null` si nunca se barrió. */
  vuelta: Vuelta | null;
  /** Pendientes contados contra la vuelta abierta, o `null` si no hay ninguna abierta. */
  pendientesDeLaAbierta: number | null;
  /** Barribles del catálogo. Es lo pendiente cuando no hay vuelta abierta. */
  total: number;
}

export interface PlanDeVuelta {
  /** Con qué fecha filtrar la cola y el conteo. `undefined` = arranca una vuelta nueva. */
  desde: string | undefined;
  /** Lo que falta para completar la vuelta. Es el número de la cuenta regresiva. */
  pendientes: number;
  /** Id de la vuelta a cerrar en este render, o `null` si no hay ninguna que cerrar. */
  cerrar: number | null;
  /** Si corresponde anunciar que una vuelta se completó. */
  completada: boolean;
}

/**
 * Qué hacer con la vuelta en este render de `/barrido`.
 *
 * VIVE ACÁ Y NO EN LA PÁGINA, y esta vez con motivo documentado. La primera versión de
 * este plan eran seis variables encadenadas en el frontmatter de `barrido.astro`, sin un
 * solo test — exactamente lo que `restoDelBarrido()` denuncia en su comentario y
 * exactamente cómo se colaron los dos bugs anteriores de esta misma pantalla. Una decisión
 * de negocio en el frontmatter de una plantilla es una decisión que nadie puede probar.
 *
 * Es PURA: recibe lo que ya se consultó y devuelve qué hacer. La página ejecuta.
 */
export function planDeVuelta({
  vuelta,
  pendientesDeLaAbierta,
  total,
}: DatosDeVuelta): PlanDeVuelta {
  const abierta = vuelta !== null && vuelta.terminada_en === null ? vuelta : null;

  /**
   * Una vuelta abierta sin pendientes está terminada aunque nadie la haya cerrado todavía.
   * Vale también con el catálogo vacío: si eso no cerrara, la vuelta quedaría abierta para
   * siempre y el día que entre el primer producto se lo contaría como pendiente de una
   * vuelta que arrancó meses antes.
   */
  const seCompleta = abierta !== null && pendientesDeLaAbierta === 0;

  // Cerrada la que estaba, lo que viene es una vuelta nueva sobre el catálogo entero.
  if (abierta === null || seCompleta) {
    return {
      desde: undefined,
      pendientes: total,
      cerrar: seCompleta ? abierta.id : null,
      // Se anuncia el logro tanto al cerrarla acá como al volver a entrar más tarde.
      completada: seCompleta || vuelta !== null,
    };
  }

  return {
    desde: abierta.iniciada_en,
    pendientes: pendientesDeLaAbierta ?? total,
    cerrar: null,
    completada: false,
  };
}
