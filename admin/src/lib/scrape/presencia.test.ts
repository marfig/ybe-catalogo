import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AcumuladorPresencia, consultarPresencia, urlDeBusqueda } from './presencia.ts';

/**
 * MEDIDO EL 2026-08-11 contra el sitio real, no supuesto. Los dos casos:
 *
 *   /search/?q=cg85527 -> 200, un `href="/producto/70873-cg85527"`, «1 resultado»
 *   /search/?q=cg15510 -> 200, cero enlaces de ficha, «Su búsqueda no ha generado
 *                         resultados.»
 *
 * El status HTTP es 200 EN LOS DOS. El sitio hace soft-404 en todo: una ficha
 * inexistente también responde 200, con `<title>Producto no encontrado.</title>`.
 * Por eso la decisión no puede salir de `respuesta.ok`.
 */

const TITULO = 'Resultados de búsqueda';
/** El `:443` explícito es del sitio real, y es justo lo que rompe comparar strings. */
const ogUrl = (codigo: string) => `https://www.chenson.com.py:443/search/?q=${codigo}`;

/** Una respuesta completa y bien formada, para no repetir los dos metas en cada test. */
function acumulador(codigo: string, { consulta = codigo }: { consulta?: string } = {}) {
  const a = new AcumuladorPresencia(codigo);
  a.verMeta('og:title', TITULO);
  a.verMeta('og:url', ogUrl(consulta));
  return a;
}

test('arma la URL de búsqueda con el código normalizado', () => {
  assert.equal(urlDeBusqueda('cg85527'), 'https://www.chenson.com.py/search/?q=CG85527');
});

test('un enlace de ficha con el código exacto es PRESENTE', () => {
  const a = acumulador('CG85527');
  a.verEnlace('/producto/70873-cg85527');

  const r = a.resultado();
  assert.equal(r.presencia, 'presente');
  assert.equal(r.url, 'https://www.chenson.com.py/producto/70873-cg85527');
});

test('la búsqueda es insensible a mayúsculas en los dos lados', () => {
  // El sitio devuelve la URL en minúscula aunque se busque en mayúscula.
  const a = acumulador('CG85527');
  a.verEnlace('/producto/70873-cg85527');
  assert.equal(a.resultado().presencia, 'presente');
});

test('sin ningún enlace del código, y con la página confirmada, es AUSENTE', () => {
  const r = acumulador('CG15510').resultado();
  assert.equal(r.presencia, 'ausente');
  assert.equal(r.url, null);
});

test('un vecino difuso NO cuenta como presente', () => {
  /**
   * Si el buscador algún día devuelve parecidos —`cg85528` cuando se pidió
   * `cg85527`— contarlos como presencia resucitaría un producto muerto. La
   * comparación es por código EXACTO, nunca «hay resultados».
   */
  const a = acumulador('CG85527');
  a.verEnlace('/producto/70999-cg85528');
  a.verEnlace('/producto/71000-cg8552');

  assert.equal(a.resultado().presencia, 'ausente');
});

test('una página que no es la de resultados es INDETERMINADO, nunca ausente', () => {
  /**
   * LA GUARDA QUE PROTEGE EL CATÁLOGO ENTERO. Un bloqueo, un mantenimiento o una
   * página de error tienen exactamente cero enlaces de ficha, igual que una baja
   * real. Sin este corte, un mal día del proveedor marcaría los 1.500 productos
   * como dados de baja de una sola corrida.
   */
  const a = new AcumuladorPresencia('CG85527');
  a.verMeta('og:title', 'No encontrado');
  a.verMeta('og:url', 'https://www.chenson.com.py:443/search/?q=CG85527');

  const r = a.resultado();
  assert.equal(r.presencia, 'indeterminado');
  assert.match(r.motivo, /no es la página de resultados/i);
});

test('sin los metas de confirmación también es INDETERMINADO', () => {
  const r = new AcumuladorPresencia('CG85527').resultado();
  assert.equal(r.presencia, 'indeterminado');
});

test('una respuesta que corresponde a OTRA consulta es INDETERMINADO', () => {
  /**
   * Prueba que la página que llegó es la del código que se pidió. Un caché mal
   * configurado o un redirect servirían la respuesta de otro producto, y su vacío
   * no dice nada sobre este.
   */
  const a = acumulador('CG85527', { consulta: 'CG99999' });

  const r = a.resultado();
  assert.equal(r.presencia, 'indeterminado');
  assert.match(r.motivo, /otra consulta/i);
});

test('encontrar el producto manda sobre los marcadores', () => {
  /**
   * La evidencia positiva es más fuerte que la confirmación: si la ficha del código
   * está enlazada, la página ES la correcta, diga lo que diga el `og:title`. Los
   * marcadores existen para poder creerle a un VACÍO, que es lo ambiguo.
   */
  const a = new AcumuladorPresencia('CG85527');
  a.verEnlace('/producto/70873-cg85527');
  assert.equal(a.resultado().presencia, 'presente');
});

test('ignora los enlaces que no son fichas de producto', () => {
  const a = acumulador('CG15510');
  for (const href of ['/carrito', '#', '', 'https://facebook.com/chenson', '/lanzamientos/']) {
    a.verEnlace(href);
  }
  assert.equal(a.resultado().presencia, 'ausente');
});

test('un enlace de ficha de OTRO origen no cuenta', () => {
  const a = acumulador('CG85527');
  a.verEnlace('https://otro-sitio.com/producto/70873-cg85527');
  assert.equal(a.resultado().presencia, 'ausente');
});

test('un código inválido no llega a pedirse', async () => {
  await assert.rejects(() => consultarPresencia('CG 855 27'), /espacios/i);
});

test('un status que no es 200 es INDETERMINADO, no una baja', async () => {
  const r = await consultarPresencia('CG85527', {
    buscar: async () => new Response('', { status: 503 }),
  });
  assert.equal(r.presencia, 'indeterminado');
  assert.match(r.motivo, /503/);
});

test('la red caída es INDETERMINADO', async () => {
  const r = await consultarPresencia('CG85527', {
    buscar: async () => {
      throw new Error('conexión rechazada');
    },
  });
  assert.equal(r.presencia, 'indeterminado');
  assert.match(r.motivo, /conexión rechazada/);
});
