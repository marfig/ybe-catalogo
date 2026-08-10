/**
 * Estado visible de la publicación (SPEC-etapa2 §11.3).
 *
 * «Un check rojo en GitHub no existe para quien no entra a GitHub.» Esta es la pieza
 * que hace seguro el auto-publish con una persona no técnica: sin ella, publicar es
 * apretar un botón y rezar.
 */
import type { Ejecutar } from './grilla.ts';

/**
 * Después de esto, una publicación en curso se considera colgada.
 *
 * Si la Action muere sin reportar, la fila queda en `corriendo` para siempre y el
 * botón de publicar no vuelve nunca: no habría forma de salir sin tocar la base a
 * mano. Ningún build del catálogo se acerca a una hora.
 */
const VENCIMIENTO_MS = 60 * 60 * 1000;

export interface Publicacion {
  id: number;
  estado: string;
  disparada_por: string;
  disparada_en: string;
  terminada_en: string | null;
  productos: number;
  run_url: string | null;
  commit_sha: string | null;
  error: string | null;
}

export interface Descripcion {
  tono: 'neutro' | 'en-curso' | 'ok' | 'error';
  titulo: string;
  detalle: string;
  /** Link al run, para el rol técnico. Nunca es la explicación de quien opera. */
  runUrl: string | null;
}

const plural = (n: number, singular: string, muchos: string) =>
  `${n} ${n === 1 ? singular : muchos}`;

/**
 * ¿Esta publicación en curso lleva colgada más de lo tolerable?
 *
 * Una sola definición para las dos preguntas que dependen de ella: si el botón vuelve
 * (`hayPublicacionEnCurso`) y qué dice el cartel (`describirPublicacion`). Con dos
 * plazos distintos habría una ventana en la que se contradicen.
 *
 * Ante fechas ilegibles devuelve `false`, o sea «todavía en curso». Es el lado
 * conservador: tratarla como vencida abriría el botón para disparar una segunda
 * publicación mientras la primera quizás sigue corriendo.
 */
function vencida(publicacion: Publicacion, ahora: string): boolean {
  const inicio = new Date(publicacion.disparada_en).getTime();
  const t = new Date(ahora).getTime();
  if (Number.isNaN(inicio) || Number.isNaN(t)) return false;
  return t - inicio >= VENCIMIENTO_MS;
}

/**
 * Tiempo transcurrido, en castellano.
 *
 * Un timestamp ISO no le dice nada a nadie; «hace 2 horas» sí. Los dos bordes están
 * cubiertos a propósito: menos de 10 segundos es «recién» porque «hace 3 segundos»
 * envejece mal en una pantalla que no se auto-refresca, y una fecha FUTURA — que
 * pasa con relojes desfasados — también, porque «hace -5 minutos» es un bug a la
 * vista del usuario.
 */
export function haceCuanto(desde: string, ahora: string): string {
  const t0 = new Date(desde).getTime();
  const t1 = new Date(ahora).getTime();
  if (Number.isNaN(t0) || Number.isNaN(t1)) return 'en un momento indeterminado';

  const segundos = Math.floor((t1 - t0) / 1000);
  if (segundos < 10) return 'recién';
  if (segundos < 60) return `hace ${plural(segundos, 'segundo', 'segundos')}`;

  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `hace ${plural(minutos, 'minuto', 'minutos')}`;

  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${plural(horas, 'hora', 'horas')}`;

  return `hace ${plural(Math.floor(horas / 24), 'día', 'días')}`;
}

/**
 * Un mensaje de error propio del build es útil; un stack no.
 *
 * §11.3 es explícito: el admin no muestra el stack. El caso más probable es un slug
 * de categoría inválido, y para quien opera eso se traduce a «revisá las categorías
 * del producto CG85527», no a un volcado de Zod con rutas de `node_modules`.
 *
 * El criterio: se muestra sólo la primera línea, y sólo si no tiene pinta de stack.
 */
function errorLegible(error: string | null): string | null {
  if (!error) return null;
  const primera = error.split('\n')[0].trim();
  const pareceStack = /node_modules|\bat \w|Error:|\/[\w./-]+:\d+|\bZod\b/i.test(primera);
  return pareceStack || primera === '' ? null : primera;
}

/** El mensaje de §11.3 para el estado actual. `null` si nunca se publicó. */
export function describirPublicacion(
  publicacion: Publicacion | null,
  ahora: string
): Descripcion {
  if (publicacion === null) {
    return {
      tono: 'neutro',
      titulo: 'Todavía no se publicó nada',
      detalle: 'Cuando apruebes productos, publicá para que aparezcan en el sitio.',
      runUrl: null,
    };
  }

  const cuando = haceCuanto(publicacion.disparada_en, ahora);
  const runUrl = publicacion.run_url;

  // `pendiente` y `corriendo` son el mismo momento para quien opera: el trabajo está
  // en curso. La diferencia entre encolado y arrancado es vocabulario de CI.
  if (publicacion.estado === 'pendiente' || publicacion.estado === 'corriendo') {
    /**
     * EL CARTEL TAMBIÉN VENCE, no sólo el bloqueo del botón.
     *
     * `hayPublicacionEnCurso` ya vencía con este mismo plazo, así que el botón volvía.
     * Pero esta rama no vencía: seguía diciendo «Publicando…» para siempre. Pasó dos
     * veces en producción — el sitio ya estaba publicado y el admin decía que seguía
     * trabajando.
     *
     * Y el caso real fue peor que un build lento: la Action falló por falta de
     * credenciales, y el paso que reporta el fallo necesita LAS MISMAS credenciales, así
     * que no pudo escribir que falló. Cuando el camino de error depende del mismo
     * secreto que el camino feliz, este vencimiento del lado del lector es la única red
     * que queda.
     *
     * El plazo es el de `VENCIMIENTO_MS` y no uno propio: dos números distintos darían
     * una ventana donde el botón está libre y el cartel dice que hay algo en curso.
     */
    if (vencida(publicacion, ahora)) {
      return {
        tono: 'error',
        titulo: 'No llegó respuesta de la publicación',
        detalle:
          `Empezó ${cuando} y nunca reportó cómo terminó. Puede que el catálogo se ` +
          'haya publicado igual: mirá el sitio antes de reintentar. Tu trabajo sigue ' +
          'guardado y se puede volver a intentar sin cargar nada de nuevo.',
        runUrl,
      };
    }

    return {
      tono: 'en-curso',
      titulo: 'Publicando…',
      detalle: `Empezó ${cuando}. Suele tardar un par de minutos; podés seguir trabajando.`,
      runUrl,
    };
  }

  if (publicacion.estado === 'error') {
    const pista = errorLegible(publicacion.error);
    return {
      tono: 'error',
      titulo: 'No se pudo publicar',
      detalle:
        (pista ? `${pista}. ` : '') +
        'Ya avisamos al equipo técnico. Tu trabajo sigue guardado: cuando se ' +
        'resuelva se puede volver a intentar sin cargar nada de nuevo.',
      runUrl,
    };
  }

  const terminada = publicacion.terminada_en ?? publicacion.disparada_en;
  return {
    tono: 'ok',
    titulo: `Publicado ${haceCuanto(terminada, ahora)}`,
    detalle: `${plural(publicacion.productos, 'producto', 'productos')} en el catálogo.`,
    runUrl,
  };
}

/** Deja la fila en `pendiente` y devuelve su id, que viaja al dispatch. */
export async function crearPublicacion(
  ejecutar: Ejecutar,
  { email, ahora }: { email: string; ahora: string }
): Promise<number> {
  const filas = await ejecutar<{ id: number }>(
    `INSERT INTO publicaciones (estado, disparada_por, disparada_en)
     VALUES ('pendiente', ?, ?)
     RETURNING id`,
    // `disparada_por` sale del JWT de Access (§6): queda registro de quién publicó qué.
    [email, ahora]
  );
  if (filas.length === 0) throw new Error('No se pudo registrar la publicación.');
  return filas[0].id;
}

/**
 * Cuántos productos cambiaron desde la última publicación EXITOSA.
 *
 * EL HUECO QUE ESTO CIERRA. §10.1 usaba «8 aprobados sin publicar» como llamador a la
 * acción, y ese contador sólo mira `aprobado`. Editar un producto que YA estaba en el
 * catálogo no encendía ninguna señal: se guardaba, el Inicio se quedaba callado, y el
 * sitio quedaba viejo sin que nada lo dijera. Alguien tenía que acordarse de publicar.
 *
 * Es el mismo problema que §11.3 ataca del otro lado — estado invisible — sólo que
 * antes de publicar en vez de después.
 *
 * Se compara contra la última publicación **`ok`** y no contra la última a secas: si
 * la última falló, lo que hay en el sitio es lo de la anterior, y comparar contra el
 * intento fallido diría que no hay nada pendiente justo cuando más importa saberlo.
 *
 * Los `importado` no cuentan: no salen en `productos.json` (§5.2), así que no son un
 * cambio pendiente de publicar sino trabajo pendiente de terminar. Los `eliminado` sí,
 * porque hasta que se publique el producto se sigue viendo en el sitio.
 */
export async function cambiosSinPublicar(ejecutar: Ejecutar): Promise<number> {
  const [ultimaOk] = await ejecutar<{ terminada_en: string | null }>(
    `SELECT terminada_en FROM publicaciones
      WHERE estado = 'ok' AND terminada_en IS NOT NULL
      ORDER BY terminada_en DESC, id DESC
      LIMIT 1`
  );

  // Sin ninguna publicación exitosa, todo lo publicable está pendiente por definición.
  const corte = ultimaOk?.terminada_en ?? '';

  const [fila] = await ejecutar<{ n: number }>(
    `SELECT COUNT(*) AS n FROM productos
      WHERE estado <> 'importado' AND actualizado_en > ?`,
    [corte]
  );

  return fila?.n ?? 0;
}

/** La más reciente, o `null`. */
export async function ultimaPublicacion(ejecutar: Ejecutar): Promise<Publicacion | null> {
  const filas = await ejecutar<Publicacion>(
    `SELECT id, estado, disparada_por, disparada_en, terminada_en, productos,
            run_url, commit_sha, error
       FROM publicaciones
      ORDER BY disparada_en DESC, id DESC
      LIMIT 1`
  );
  return filas[0] ?? null;
}

/**
 * ¿Hay una publicación en curso?
 *
 * Se usa para no disparar dos a la vez: cinco clicks nerviosos crearían cinco filas
 * y el admin mostraría un estado que no se corresponde con ningún run. El workflow
 * ya colapsa los builds con `concurrency` (§11.2); esto es la mitad de arriba.
 *
 * Una en curso vencida NO cuenta, ver `VENCIMIENTO_MS`.
 */
export async function hayPublicacionEnCurso(
  ejecutar: Ejecutar,
  ahora: string = new Date().toISOString()
): Promise<boolean> {
  const ultima = await ultimaPublicacion(ejecutar);
  if (ultima === null) return false;
  if (ultima.estado !== 'pendiente' && ultima.estado !== 'corriendo') return false;

  // La misma pregunta que usa el cartel, para que no puedan contradecirse.
  return !vencida(ultima, ahora);
}
