/**
 * SPIKE DESCARTABLE — Fase 2.0 de docs/SPEC-etapa2.md.
 *
 * Pregunta que responde: parsear una ficha del proveedor y hashear sus imagenes,
 * ¿entra en los 10 ms de CPU por invocacion del plan Free?
 *
 * COMO SE MIDE, y por que no hay `Date.now()` en este archivo:
 * en Workers el reloj esta congelado durante la ejecucion sincronica — devuelve
 * la hora de la ultima operacion de E/S, como mitigacion de ataques tipo Spectre.
 * Dos `Date.now()` alrededor del parseo darian 0 ms siempre. La medicion real es
 * binaria: si se pasa de 10 ms, el runtime mata la invocacion y devuelve error.
 * Se despliega en el plan Free, se le pega, y la respuesta es "vive" o "muere".
 * El numero fino sale de las metricas de CPU del dashboard.
 *
 * Uso:
 *   GET /?url=https://www.chenson.com.py/producto/71803-cg86003
 *   GET /?url=...&imagenes=0     -> parsea sin hashear: aisla parseo de hash
 *
 * El flag `imagenes=0` existe para poder bisecar. Si con todo junto se pasa del
 * limite, hay que saber si el culpable es el parseo o el hash antes de elegir la
 * granularidad de SPEC-etapa2 §7.3.
 */

/** Solo el proveedor. Sin esto el spike seria un proxy de fetch abierto. */
const ORIGEN_PERMITIDO = 'https://www.chenson.com.py';
const PREFIJO_FICHA = `${ORIGEN_PERMITIDO}/producto/`;

/** SPEC §6.2: User-Agent identificable, nunca uno falseado de navegador. */
const USER_AGENT = 'YBECatalogoBot/0.1 (+catalogo interno; contacto por WhatsApp)';

/** Ruta de las imagenes de producto en el origen (SPEC §2.3). */
const RUTA_IMAGENES = '/Prelude-images/product/';

/**
 * HALLAZGO DEL SPIKE: el sitio etiqueta sus fotos de galeria con este `alt`, y
 * las del carrusel de recomendados con el CODIGO del otro producto (`CG85401`).
 * Es la unica marca semantica que distingue "foto de este producto" de "foto de
 * otro producto que el sitio esta promocionando".
 */
const ALT_GALERIA = 'product-thumb';

/**
 * Tope del texto acumulado.
 *
 * Empezo en 32 KB y ESO CORTABA LAS MEDIDAS: el bloque "Medidas aprox. (alto x
 * largo x ancho): ..." esta al final de la pagina, y el contexto quedaba
 * truncado justo antes de los numeros. Parecia un problema del regex y era el
 * tope. La Fase 2.5 no necesita este acumulador: apunta a un selector concreto.
 */
const MAX_TEXTO = 4 * 1024 * 1024;

interface Hermano {
  url: string;
  /** Texto interno del <a>. Puede venir vacio: ver `atributos`. */
  texto: string;
  /** alt/title/aria-label del <a> y de sus <img>. Ahi suele estar el color. */
  atributos: Record<string, string>;
  /** Miniaturas del selector de color. NO son fotos del producto. */
  miniaturas: string[];
}

interface ImagenHasheada {
  url: string;
  hash16: string;
  bytes: number;
}

interface Extraccion {
  codigo: string;
  hermanos: Hermano[];
  /** Fotos del producto: TODA img que no sea miniatura de otro color. */
  galeria: string[];
  /** Miniaturas de selector, agregadas. Se excluyen de la galeria. */
  miniaturas: string[];
  /** Recomendados del carrusel rotativo. Se excluyen de la galeria. */
  relacionadas: string[];
  /** Temporal del spike: atributos crudos de las img candidatas a galeria. */
  diagnostico: { src: string; atributos: Record<string, string> }[];
  medidas: string | null;
  /** Diagnostico temporal del spike: cada aparicion de "Medidas" con contexto. */
  medidasContexto: string[];
  textoLargo: number;
  coloresEnTexto: string[];
}

/**
 * El codigo de modelo sale del ultimo segmento de la URL: `/producto/{idColor}-{codigo}`.
 *
 * SPEC §6.3 ya establece que el segmento de URL es "lo mas estable que expone el
 * sitio", asi que la identidad no depende de ningun selector de markup.
 */
function codigoDesdeUrl(url: string): string | null {
  const m = new URL(url).pathname.match(/\/producto\/\d+-([a-z0-9]+)\/?$/i);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Extrae los datos de la ficha con HTMLRewriter (streaming, nativo del runtime:
 * no carga el DOM completo ni suma dependencia de parseo).
 *
 * Los colores hermanos se detectan POR PATRON DE URL, no por `id` ni clase.
 * SPEC §2.3 especifica `#other-colors-tbl`, pero sobre una ficha alcanzada desde
 * lanzamientos ese id no se pudo confirmar: el bloque aparece rotulado "Colores
 * Disponibles". La agrupacion vive en la URL, que sobrevive a un rediseño.
 */
async function extraer(respuesta: Response, url: string): Promise<Extraccion> {
  const codigo = codigoDesdeUrl(url);
  if (!codigo) throw new Error(`La URL no tiene forma de ficha: ${url}`);

  /** Por URL, para colapsar el mismo hermano enlazado desde varios <a>. */
  const porUrl = new Map<string, Hermano>();
  const galeria = new Set<string>();
  const miniaturas = new Set<string>();
  /** Recomendados del carrusel rotativo. Se reportan solo para verificar. */
  const relacionadas = new Set<string>();
  /** Temporal del spike: atributos crudos de cada img candidata a galeria. */
  const diagnostico: { src: string; atributos: Record<string, string> }[] = [];
  let texto = '';

  // Un <a> es hermano si apunta al MISMO codigo con otro idColor.
  const esHermano = (href: string): boolean => {
    const m = href.match(/\/producto\/(\d+)-([a-z0-9]+)/i);
    return Boolean(m && m[2].toUpperCase() === codigo);
  };

  const guardarAtributo = (h: Hermano, clave: string, valor: string | null) => {
    if (valor && valor.trim()) h.atributos[clave] = valor.trim();
  };

  // Banderas de contexto, puestas al entrar a un <a> y limpiadas en su cierre.
  // Los <a> no anidan, asi que una asignacion simple alcanza.
  let dentroDeHermano: Hermano | null = null;

  const reescritor = new HTMLRewriter()
    .on('a[href]', {
      element(el) {
        const href = el.getAttribute('href');
        if (!href || !href.includes('/producto/')) return;

        const absoluta = new URL(href, ORIGEN_PERMITIDO).href;
        // La ficha se enlaza a si misma en el selector de color: no es hermano
        // ni es otro producto.
        if (absoluta === url) return;

        // HALLAZGO DEL SPIKE: la ficha trae un carrusel de recomendados que ROTA
        // EN CADA REQUEST. Medido sobre 3 corridas de /producto/71803-cg86003:
        // 1 imagen estable y 4 distintas cada vez. Barrerlas como fotos del
        // producto rompe la idempotencia sin producir ningun error.
        //
        // Un recomendado siempre cuelga de un <a> a OTRO producto, asi que la
        // misma regla estructural que separa las miniaturas de color los separa.
        if (!esHermano(href)) return;

        let h = porUrl.get(absoluta);
        if (!h) {
          h = { url: absoluta, texto: '', atributos: {}, miniaturas: [] };
          porUrl.set(absoluta, h);
        }
        guardarAtributo(h, 'a.title', el.getAttribute('title'));
        guardarAtributo(h, 'a.aria-label', el.getAttribute('aria-label'));

        dentroDeHermano = h;
        el.onEndTag(() => {
          dentroDeHermano = null;
        });
      },
    })
    .on('*', {
      // Gateado por la bandera: acumula el texto interno del <a> hermano, que
      // puede estar a cualquier profundidad.
      text(t) {
        if (dentroDeHermano) dentroDeHermano.texto += t.text;
      },
    })
    .on('img[src]', {
      element(el) {
        const src = el.getAttribute('src');
        if (!src || !src.includes(RUTA_IMAGENES)) return;
        const absoluta = new URL(src, ORIGEN_PERMITIDO).href;

        // HALLAZGO DEL SPIKE: la ficha lista tambien las miniaturas de los otros
        // colores. Asignarlas a esta variante le colgaria la foto del color
        // equivocado — un bug silencioso que llega hasta el cliente. Una img
        // dentro de un <a> hermano es miniatura de selector, no foto de galeria.
        if (dentroDeHermano) {
          miniaturas.add(absoluta);
          dentroDeHermano.miniaturas.push(absoluta);
          // Aca vive el nombre del color: img.title == "(A) VERDE OSCURO".
          guardarAtributo(dentroDeHermano, 'img.alt', el.getAttribute('alt'));
          guardarAtributo(dentroDeHermano, 'img.title', el.getAttribute('title'));
          return;
        }

        const alt = (el.getAttribute('alt') ?? '').trim();

        // El carrusel de recomendados ROTA EN CADA REQUEST: medido sobre 3
        // corridas, 1 imagen estable y 4 distintas cada vez. Importarlas rompe la
        // idempotencia sin producir ningun error.
        //
        // Se probo antes la hipotesis "un recomendado cuelga de un <a> a otro
        // producto" y SE MIDIO FALSA. Lo que si los distingue es el `alt`.
        if (alt !== ALT_GALERIA) {
          relacionadas.add(absoluta);
          diagnostico.push({
            src: absoluta.split('/').pop()!.slice(0, 16),
            atributos: Object.fromEntries([...el.attributes]),
          });
          return;
        }

        galeria.add(absoluta);
      },
    })
    .on('body', {
      // Amplio a proposito: el spike todavia no sabe en que elemento vive
      // "Medidas" ni el nombre del color. La Fase 2.5 acota el selector con el
      // markup real, que es justamente lo que este spike sirve para descubrir.
      text(t) {
        if (texto.length < MAX_TEXTO) texto += t.text;
      },
    });

  // Los handlers no corren hasta que se consume el body transformado.
  await reescritor.transform(respuesta).arrayBuffer();

  // El primer punto esta en "aprox.", asi que [^.]* cortaba la frase entera.
  // Se ancla al cierre real de la medida.
  const medidas = texto.match(/Medidas[\s\S]{0,160}?cm\.?/i);

  // Diagnostico del spike: TODAS las apariciones de "Medidas", no solo la
  // primera. La hipotesis del tope de 32 KB no explico el truncado, asi que
  // puede haber un rotulo vacio en un template antes del real.
  const medidasContexto = [...texto.matchAll(/Medidas/gi)].map((m) =>
    texto.slice(m.index!, m.index! + 120).replace(/\s+/g, ' ')
  );

  const coloresEnTexto = [...texto.matchAll(/\(([0-9A-Z])\)\s*([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ ]{2,})/g)]
    .map((m) => `(${m[1]}) ${m[2].trim()}`)
    .filter((v, i, a) => a.indexOf(v) === i);

  return {
    codigo,
    hermanos: [...porUrl.values()].map((h) => ({
      ...h,
      texto: h.texto.replace(/\s+/g, ' ').trim(),
    })),
    // Una miniatura o un recomendado pueden aparecer ademas fuera de un <a>:
    // se restan siempre, no solo cuando el contexto los marco.
    galeria: [...galeria].filter((u) => !miniaturas.has(u) && !relacionadas.has(u)),
    miniaturas: [...miniaturas],
    relacionadas: [...relacionadas],
    diagnostico,
    medidas: medidas ? medidas[0].replace(/\s+/g, ' ').trim() : null,
    medidasContexto,
    textoLargo: texto.length,
    coloresEnTexto,
  };
}

/**
 * SHA-256 de los BYTES ORIGINALES, en el Worker (SPEC-etapa2 §8.1).
 *
 * Nunca del WebP que produce el navegador: los encoders varian entre navegadores
 * y versiones, asi que hashear la salida daria hashes distintos por maquina y
 * romperia el dedupe y la idempotencia en silencio.
 */
async function hashear(url: string): Promise<ImagenHasheada> {
  const r = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!r.ok) throw new Error(`HTTP ${r.status} al bajar ${url}`);

  const buf = await r.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const hash16 = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);

  // Las dimensiones NO se miden aca. El navegador ya las conoce via
  // naturalWidth/naturalHeight cuando normaliza con canvas (§8), asi que
  // decodificar el JPEG en el Worker seria CPU gastada dos veces.
  return { url, hash16, bytes: buf.byteLength };
}

export default {
  async fetch(peticion: Request): Promise<Response> {
    const entrada = new URL(peticion.url);
    const objetivo = entrada.searchParams.get('url');
    const conImagenes = entrada.searchParams.get('imagenes') !== '0';

    /**
     * Cuantas veces repetir la extraccion sobre el MISMO html ya bajado.
     *
     * "Entra en 10 ms" no dice con cuanto margen entra, y el margen es lo que
     * decide la granularidad de SPEC-etapa2 §7.3. Repetir el parseo N veces sin
     * volver a pedir la pagina multiplica solo el CPU: el N mas alto que
     * sobrevive ES el margen, medido en multiplos del caso real.
     *
     * Sirve tambien para saber si la cuenta esta en Free (10 ms) o Paid (30 s):
     * en Paid ningun N razonable muere.
     */
    const repetir = Math.max(1, Math.min(2000, Number(entrada.searchParams.get('repetir') ?? 1)));

    const json = (cuerpo: unknown, status = 200) =>
      new Response(JSON.stringify(cuerpo, null, 2), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });

    if (!objetivo) {
      return json(
        {
          uso: '/?url=https://www.chenson.com.py/producto/71803-cg86003[&imagenes=0]',
          mide: 'si el parseo + hash de una ficha entra en 10 ms de CPU del plan Free',
        },
        400
      );
    }

    if (!objetivo.startsWith(PREFIJO_FICHA)) {
      return json({ error: `Solo se permiten fichas de ${PREFIJO_FICHA}` }, 403);
    }

    let subrequests = 0;

    try {
      subrequests++;
      const respuesta = await fetch(objetivo, {
        headers: { 'user-agent': USER_AGENT },
        // Cortesia con el proveedor (SPEC §6.2) mientras se itera la medicion:
        // repetir la prueba 30 veces no debe golpear 30 veces su servidor. Y de
        // paso saca la varianza de red del numero de CPU.
        cf: { cacheEverything: true, cacheTtl: 600 },
      });
      if (!respuesta.ok) {
        return json({ error: `HTTP ${respuesta.status} al pedir la ficha`, subrequests }, 502);
      }

      // Se materializa una vez y se reparsea desde memoria: N no agrega red.
      const html = await respuesta.text();
      let extraido!: Extraccion;
      for (let i = 0; i < repetir; i++) {
        extraido = await extraer(new Response(html), objetivo);
      }

      const hasheadas: ImagenHasheada[] = [];
      if (conImagenes) {
        // Solo la galeria. Las miniaturas de otros colores ya se subieron (o se
        // van a subir) al procesar la ficha de SU color, asi que hashearlas aca
        // seria trabajo y subrequests al doble.
        //
        // Secuencial, no en paralelo: replica la cortesia de SPEC §6.2 y hace que
        // el costo de CPU medido sea el del caso real, no el de un burst.
        for (const url of extraido.galeria) {
          subrequests++;
          hasheadas.push(await hashear(url));
        }
      }

      return json({
        ok: true,
        url: objetivo,
        codigo: extraido.codigo,
        medidas: extraido.medidas,
        medidasContexto: extraido.medidasContexto,
        textoLargo: extraido.textoLargo,
        coloresEnTexto: extraido.coloresEnTexto,
        hermanos: extraido.hermanos,
        galeria: conImagenes ? hasheadas : extraido.galeria,
        descartadas: {
          miniaturasDeColor: extraido.miniaturas,
          recomendadosRotativos: extraido.relacionadas,
        },
        diagnostico: extraido.diagnostico,
        conteos: {
          hermanos: extraido.hermanos.length,
          galeria: extraido.galeria.length,
          miniaturas: extraido.miniaturas.length,
          relacionadas: extraido.relacionadas.length,
          subrequests,
          limiteSubrequestsFree: 50,
          parseosEjecutados: repetir,
          htmlBytes: html.length,
        },
        nota: conImagenes
          ? 'Si esta respuesta llegó, parseo + hash entran en 10 ms.'
          : 'Solo parseo, sin hash. Compará con la corrida completa para bisecar.',
      });
    } catch (e) {
      // Un error de CPU excedido NO llega hasta aca: el runtime mata la
      // invocacion antes. Que esto se vea significa que el problema es otro.
      return json(
        {
          error: e instanceof Error ? e.message : String(e),
          subrequests,
          nota: 'Excederse de CPU no produce este error: el runtime corta la invocacion.',
        },
        500
      );
    }
  },
};
// Sin `satisfies ExportedHandler` a proposito: el spike no instala
// @cloudflare/workers-types y no se typechequea. wrangler lo empaqueta con
// esbuild, que borra los tipos sin validarlos.
