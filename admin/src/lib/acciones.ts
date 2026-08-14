/**
 * Qué hace cada botón de la grilla, y en qué ORDEN (SPEC-etapa2 §10.3).
 *
 * Existe por un bug, y el bug vale contarlo porque es el que justifica el módulo.
 *
 * El POST de la grilla era una cadena `if / else if`: o guardaba, o aprobaba, o
 * asignaba categorías. Nunca dos cosas. Así que quien tipeaba nombre y precio en un
 * producto recién scrapeado, tildaba su casilla y apretaba **Aprobar** obtenía esto:
 *
 *  1. `guardarFilas` no corría y lo tipeado se descartaba.
 *  2. `aprobar` leía nombre y precio DE LA BASE, donde seguían vacíos.
 *  3. La validación respondía «falta nombre» sobre un nombre que estaba a la vista.
 *  4. El redirect 303 recargaba desde la base y lo tipeado desaparecía.
 *
 * Te acusa de no haber hecho lo que acabás de hacer, y borra la prueba.
 *
 * **La regla, entonces: toda acción que escribe guarda PRIMERO lo que hay en pantalla.**
 * La grilla es una tabla editable; el estado de verdad es el formulario, no la fila que
 * quedó en la base la última vez.
 *
 * Y esto vive acá y no en la plantilla porque el orden ES la regla. En un `.astro` no se
 * puede probar; acá se prueba contra la migración real igual que todo lo demás.
 */
import type { Ejecutar } from './grilla.ts';
import { guardarFilas, type CambioFila, type OpcionesGuardado, type ResultadoFila } from './guardar.ts';
import { aprobar, asignarCategorias, type ResultadoItem } from './transiciones.ts';

/** Las acciones que esta pantalla resuelve por sí misma. */
export const ACCIONES = ['guardar', 'aprobar', 'aprobar-completos', 'categorias'] as const;

export type Accion = (typeof ACCIONES)[number];

/**
 * Si un valor del formulario es una acción conocida.
 *
 * `unknown` y no `string`: lo que sale de `FormData.get` es `string | File | null`, y
 * una guarda que exige `string` obliga a castear justo en el borde donde el cast es más
 * peligroso. Acá entra cualquier cosa y sale una `Accion` o un rechazo.
 */
export function esAccion(valor: unknown): valor is Accion {
  return typeof valor === 'string' && (ACCIONES as readonly string[]).includes(valor);
}

/**
 * Si la acción opera sobre las casillas tildadas.
 *
 * `guardar` no, porque guarda la página entera. `aprobar-completos` tampoco, y su caso
 * es el que hace falta nombrar: su razón de ser es NO tener que tildar nada. Sin esta
 * distinción, el aviso de «no seleccionaste ningún producto» saltaría justo en la acción
 * diseñada para no seleccionar ninguno.
 */
export function necesitaSeleccion(accion: Accion): boolean {
  return accion === 'aprobar' || accion === 'categorias';
}

export interface EntradaAccion {
  accion: Accion;
  /** TODAS las filas que la página rindió, ya parseadas. No sólo las tildadas. */
  cambios: CambioFila[];
  /** Los ids tildados, para las acciones en lote. */
  seleccionados: number[];
  /** Las categorías del lote. Sólo para `categorias`. */
  secundarias?: string[];
  /** Confirmación explícita de aprobar sin foto (§5.2-3). */
  permitirSinFoto?: boolean;
}

/** Lo que devuelve una acción: el resumen de la pantalla acepta las dos formas. */
export type ResultadoAccion = ResultadoFila | ResultadoItem;

/**
 * Guarda lo tipeado y después hace lo que se pidió.
 *
 * Lanza sólo lo que ya lanzaba `asignarCategorias`: una elección en lote inválida, que
 * no puede quedar aplicada a medias. Para todo lo demás el resultado es POR PRODUCTO,
 * porque una fila con problemas no puede hacer perder las otras 49.
 */
export async function ejecutarAccion(
  ejecutar: Ejecutar,
  { accion, cambios, seleccionados, secundarias = [], permitirSinFoto = false }: EntradaAccion,
  opciones: OpcionesGuardado
): Promise<ResultadoAccion[]> {
  const guardado = await guardarFilas(ejecutar, cambios, opciones);

  /**
   * Con «Guardar» el guardado ES la acción, así que se reporta completo: los aciertos
   * son la respuesta a lo que se pidió.
   *
   * Con las otras dos es una PRECONDICIÓN, y ahí sólo se reportan los fallos. Contar
   * «50 productos actualizados» cuando se apretó «Aprobar» ahogaría el único dato que
   * se estaba esperando, que es cuántos se aprobaron.
   */
  if (accion === 'guardar') return guardado;

  const fallosAlGuardar = guardado.filter((r) => !r.ok);

  /**
   * Una fila que no se pudo guardar queda AFUERA del lote.
   *
   * Si entrara, la transición se decidiría sobre los datos viejos de la base mientras la
   * pantalla muestra otros. Y el resumen diría dos cosas del mismo producto: que falló
   * al guardar y que se aprobó. Es la clase de contradicción que hace desconfiar de
   * toda la pantalla.
   */
  const rechazadas = new Set(fallosAlGuardar.map((r) => r.id));
  const aptos = seleccionados.filter((id) => !rechazadas.has(id));

  if (accion === 'aprobar') {
    return [...fallosAlGuardar, ...(await aprobar(ejecutar, aptos, { ...opciones, permitirSinFoto }))];
  }

  /**
   * «Aprobar los completos»: sin selección, sobre TODA la página.
   *
   * Los candidatos son las filas que la página rindió —`cambios`, no `seleccionados`—
   * porque el punto de la acción es no tener que tildar nada. Y como corre DESPUÉS del
   * guardado, la validación decide sobre lo que se acaba de tipear: se completan diez
   * filas, se aprieta un botón, y las diez entran. Una preselección en el navegador no
   * puede hacer eso, porque tildaría según la validación que el servidor ya rindió.
   *
   * `saltearIncompletos` es lo que evita que las 38 filas que todavía no están listas se
   * reporten como fallos que nadie provocó. Ver `OpcionesTransicion`.
   *
   * El alcance es LA PÁGINA y no el filtro entero a propósito: `aprobar` hace un UPDATE
   * por producto y Cloudflare corta en 1000 subrequests. Sobre 1.500 productos la
   * operación moriría a mitad de camino, dejando media tanda aprobada y sin forma de
   * saber dónde se cortó. Con 50 por página entra de sobra, y de paso ya respeta el
   * filtro y la búsqueda vigentes.
   */
  if (accion === 'aprobar-completos') {
    const deLaPagina = cambios.map((c) => c.id).filter((id) => !rechazadas.has(id));
    return [
      ...fallosAlGuardar,
      ...(await aprobar(ejecutar, deLaPagina, {
        ...opciones,
        permitirSinFoto,
        saltearIncompletos: true,
      })),
    ];
  }

  return [...fallosAlGuardar, ...(await asignarCategorias(ejecutar, aptos, secundarias, opciones))];
}
