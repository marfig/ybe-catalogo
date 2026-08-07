/**
 * El envoltorio de `HTMLRewriter` (SPEC-etapa2 §7.2, §7.4).
 *
 * A PROPÓSITO NO TIENE NI UNA DECISIÓN ADENTRO. Cada handler traduce un evento del
 * parser a una llamada del acumulador, y nada más. Todo lo que se puede razonar mal
 * vive en `extractor.ts` y `origen.ts`, que sí tienen tests.
 *
 * `HTMLRewriter` es streaming y nativo del runtime: no carga el DOM ni suma una
 * dependencia de parseo. Tampoco existe en Node, que es exactamente por lo que este
 * archivo es tan delgado.
 */
import { AcumuladorFicha, type FichaExtraida } from './extractor.ts';
import { ORIGEN } from './origen.ts';

/**
 * User-Agent identificable, nunca uno falseado de navegador (`SPEC.md` §6.2).
 *
 * Si al proveedor le molesta el tráfico, tiene que poder identificarlo y bloquearlo.
 * Disfrazarse de Chrome le saca esa posibilidad.
 */
export const USER_AGENT = 'YBECatalogo/1.0 (+https://github.com/marfig/ybe-catalogo; catalogo propio)';

/** Un origen ajeno no se pide: el scrape no es un proxy abierto. */
export function esDelOrigen(url: string): boolean {
  try {
    return new URL(url).origin === new URL(ORIGEN).origin;
  } catch {
    return false;
  }
}

export interface OpcionesFicha {
  /** Inyectable para los tests de los endpoints. */
  buscar?: typeof fetch;
}

/**
 * Baja una ficha y la extrae.
 *
 * Lanza con el motivo en el mensaje: quien llama lo guarda en `scrape_errores` y
 * sigue con la próxima. Una ficha caída no aborta la corrida (§7.4).
 */
export async function extraerFicha(
  url: string,
  { buscar = fetch }: OpcionesFicha = {}
): Promise<FichaExtraida> {
  if (!esDelOrigen(url)) throw new Error(`La URL no es de ${ORIGEN}: ${url}`);

  // El acumulador valida la forma de la URL y lanza si no es una ficha. Va ANTES del
  // fetch: no tiene sentido molestar al proveedor por una URL que no vamos a usar.
  const acumulador = new AcumuladorFicha(url);

  const respuesta = await buscar(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    redirect: 'follow',
  });

  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status} al pedir la ficha.`);

  let titulo = '';

  const reescritor = new HTMLRewriter()
    .on('meta[property]', {
      element(el) {
        acumulador.verMeta(el.getAttribute('property'), el.getAttribute('content'));
      },
    })
    .on('title', {
      // Respaldo de `og:title`. Llega en trozos, así que se junta y se entrega al final.
      text(t) {
        titulo += t.text;
      },
    })
    .on('a[href]', {
      element(el) {
        acumulador.abrirEnlace(el.getAttribute('href'));
        el.onEndTag(() => acumulador.cerrarEnlace());
      },
      /**
       * Acotado a `a` y no a `*`: el presupuesto de CPU es de 10 ms con margen ~5×
       * (§7.3), y el que se lo lleva es `HTMLRewriter` sobre ~57 KB de HTML. Un
       * handler de texto sobre todo el documento gasta el margen para recuperar un
       * dato que el `title` de la miniatura ya trae.
       */
      text(t) {
        acumulador.verTexto(t.text);
      },
    })
    .on('img[src]', {
      element(el) {
        acumulador.verImagen({
          src: el.getAttribute('src'),
          alt: el.getAttribute('alt'),
          title: el.getAttribute('title'),
        });
      },
    });

  // Los handlers no corren hasta que se consume el cuerpo transformado.
  await reescritor.transform(respuesta).arrayBuffer();

  acumulador.verTitulo(titulo);
  return acumulador.resultado();
}
