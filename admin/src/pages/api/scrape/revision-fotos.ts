import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

import { ejecutorD1 } from '../../../lib/d1.ts';
import { cuerpoJson, json, soloPost } from '../../../lib/http.ts';
import { corridaEnCurso, iniciarCorrida } from '../../../lib/scrape/corrida.ts';
import {
  FICHAS_POR_CORRIDA,
  codigosPedidos,
  contarParaRevisar,
  paraRevisarFotos,
} from '../../../lib/scrape/revision-fotos.ts';

/**
 * La lista de fichas a las que hay que volver a mirarles la galería, y la corrida.
 *
 * DEVUELVE LA LISTA Y ABRE LA CORRIDA EN UN SOLO PEDIDO, igual que el relleno de
 * descripciones y la recuperación de fotos faltantes: la lista sale de la base propia, no
 * cuesta tráfico del proveedor, y no hay ninguna decisión humana en el medio.
 *
 * NO SUBE NINGUNA FOTO. El trabajo lo hacen `/api/scrape/ficha` y `traerFotos` desde la
 * pestaña, que son los dos pasos de la importación de todos los días. Es a propósito: la
 * reparación corre por el camino que ya está probado, y no por uno hecho para la ocasión.
 *
 * ES CÓDIGO DE UN SOLO USO. Ver `revision-fotos.ts`.
 */

interface Peticion {
  /** `true` para sólo contar, sin abrir corrida. Es lo que rinde la pantalla al entrar. */
  soloContar?: boolean;
  /**
   * Último código ya revisado, para retomar. Lo manda la pestaña desde su marcador.
   *
   * Un marcador ilegible NO es un error: `paraRevisarFotos` lo trata como «desde el
   * principio». Repetir trabajo idempotente es más barato que abortar la pasada.
   */
  desde?: string;
  /**
   * Un puñado de códigos elegidos a mano, para probar antes de la pasada larga.
   *
   * SE DISTINGUE «AUSENTE» DE «VACÍO» a propósito, y la guarda está en `paraRevisarFotos`:
   * un arreglo vacío devuelve NADA. Si significara «todo», un campo vacío en la pantalla
   * largaría 40 minutos de corrida sobre el catálogo entero.
   */
  codigos?: string[];
}

const ROTULO_PASADA = 'revisión de galerías: fotos adicionales del proveedor';

/** Cuántos códigos entran en el rótulo de una prueba antes de resumirlo. */
const CODIGOS_EN_ROTULO = 8;

/**
 * El rótulo de una prueba, con los códigos adentro.
 *
 * Se acota: `scrapes.url` es lo que lee una persona en el resumen de §10.2, y una prueba con
 * cien códigos pegados dejaría una fila ilegible en vez de informar algo.
 */
function rotuloDePrueba(codigos: string[]): string {
  const cabeza = codigos.slice(0, CODIGOS_EN_ROTULO).join(', ');
  const resto = codigos.length - CODIGOS_EN_ROTULO;
  return `revisión de galerías (prueba): ${cabeza}${resto > 0 ? ` y ${resto} más` : ''}`;
}

export const POST: APIRoute = async ({ request }) => {
  const datos = await cuerpoJson<Peticion>(request);
  const ejecutar = ejecutorD1(env.DB);
  const ahora = new Date().toISOString();

  const esPrueba = Array.isArray(datos?.codigos);
  const pedidos = esPrueba ? codigosPedidos(datos!.codigos!) : [];

  /**
   * El filtro es el mismo para la tajada y para el conteo; lo único que cambia es el tope.
   *
   * LA TAJADA EXISTE POR LA TOLERANCIA. `corridaEnCurso` da por muerta una corrida más
   * vieja que `TOLERANCIA_MINUTOS`, así que un recorrido más largo se queda sin guarda a
   * mitad de camino y una segunda pestaña puede duplicarle el tráfico al proveedor. Ver
   * `FICHAS_POR_CORRIDA`.
   */
  const filtro = esPrueba ? { codigos: datos!.codigos } : { desde: datos?.desde };

  const pendientes = await paraRevisarFotos(ejecutar, { ...filtro, tope: FICHAS_POR_CORRIDA });

  /**
   * Cuántas quedan EN TOTAL, no en esta tajada. La pantalla lo necesita para dos cosas: que
   * la barra mida el trabajo y no la tajada, y que el resumen pueda decir «N de M» — que es
   * lo único que delata un marcador corrupto que salteó un tramo del catálogo.
   */
  const restantes = await contarParaRevisar(ejecutar, filtro);

  if (datos?.soloContar === true) return json({ total: restantes });

  /**
   * Qué código se pidió y no salió. Sin esto, uno mal tipeado se ve igual que uno que ya
   * estaba completo: la pantalla diría «revisado 3 de 3» y nadie notaría el cuarto.
   */
  const encontrados = new Set(pendientes.map((p) => p.codigo.toUpperCase()));
  const noEncontrados = pedidos.filter((c) => !encontrados.has(c));

  if (pendientes.length === 0) {
    return json({ total: 0, restantes: 0, productos: [], noEncontrados });
  }

  /**
   * LA MISMA GUARDA QUE LOS OTROS RECORRIDOS. El paso de 1 pedido por segundo (§7.4) lo
   * marca cada pestaña por su cuenta, así que sin este 409 una revisión y una importación
   * simultáneas le duplican el tráfico al proveedor sin que nadie se entere.
   */
  const abierta = await corridaEnCurso(ejecutar, { ahora });
  if (abierta) {
    return json(
      {
        error:
          'Ya hay un recorrido en curso. Se hace de a uno para no duplicarle el tráfico al proveedor.',
      },
      409
    );
  }

  const scrapeId = await iniciarCorrida(ejecutar, {
    /**
     * Queda dicho qué fue: `scrapes` es de dónde sale el resumen que alguien va a leer
     * dentro de seis meses para entender por qué se visitó el catálogo entero de nuevo. Y
     * la prueba se rotula distinto, para que no se confunda con la pasada de verdad.
     */
    url: esPrueba ? rotuloDePrueba(pendientes.map((p) => p.codigo)) : ROTULO_PASADA,
    tipo: 'importacion',
    paginas: pendientes.length,
    ahora,
  });

  return json({
    scrapeId,
    total: pendientes.length,
    restantes,
    productos: pendientes,
    noEncontrados,
  });
};

export const ALL: APIRoute = () => soloPost();
