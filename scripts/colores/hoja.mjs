/**
 * Genera la planilla para repartir en colores las fotos de los productos que la
 * migración del catálogo viejo dejó con un solo color.
 *
 * EL PROBLEMA QUE RESUELVE. 32 productos entraron desde `catalogo-viejo` con todas sus
 * fotos colgando de una única variante «Único», cuando en realidad son varios colores.
 * La lista de colores SÍ se conservó —está en la descripción, y `migracion/parse.ts` la
 * dejó ahí a propósito porque es el único registro que queda— pero **nada ata una foto a
 * un color**: las fotos del catálogo viejo vienen en un arreglo plano a nivel producto.
 *
 * Eso sólo lo puede resolver alguien MIRÁNDOLAS. Esta planilla existe para que mirarlas
 * y etiquetarlas cueste lo menos posible: las fotos a la vista, los colores ya extraídos
 * como botones, y el mapeo listo para copiar al final.
 *
 * DE UNA SOLA VEZ. Del catálogo viejo ya no hay nada que importar, así que esto no es
 * una pantalla del admin: es una herramienta que se usa, se aplica y queda de registro.
 *
 * Uso:
 *   node scripts/colores/hoja.mjs            todos los candidatos
 *   node scripts/colores/hoja.mjs CG34337    sólo ese código
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';

/**
 * De donde salen los datos.
 *
 * `src/data/productos.json` es el ultimo volcado PUBLICADO, que es lo que se quiere.
 * Pero ese archivo se pisa al correr `npm run volcar:local` para probar algo, y ahi
 * pasa a tener la base de la maquina —110 productos en vez de 972— y esta planilla sale
 * vacia sin explicar por que. Por eso se puede apuntar a otro archivo con `--catalogo`.
 */
const CATALOGO_POR_DEFECTO = 'src/data/productos.json';
const SALIDA = 'scripts/colores/planilla.html';

/**
 * Las fotos salen del bucket PÚBLICO de producción, y no hay alternativa: son las
 * únicas copias que existen. El R2 local de miniflare no las tiene y nunca las tuvo.
 */
const R2 = 'https://img.asuncionybe.com';

/**
 * Saca la lista de colores de la descripción.
 *
 * `migracion/parse.ts` conserva el encabezado tal como venía, y viene de dos formas
 * distintas según quién cargó la ficha: «Disponibles en color:» y «Colores disponibles:».
 * Las dos están documentadas en sus tests con productos reales.
 *
 * Después del encabezado vienen los colores, uno por línea. Se corta en la primera línea
 * vacía doble o al final: no hay un cierre explícito, así que se toman las líneas de una
 * o dos palabras, que es la forma que tiene un nombre de color y no una frase.
 */
export function coloresDeDescripcion(descripcion) {
  const texto = descripcion ?? '';
  const m = texto.match(/(?:disponibles?\s+en\s+color(?:es)?|colores?\s+disponibles?)\s*:?/i);
  if (!m) return [];

  return texto
    .slice(m.index + m[0].length)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
    // Un nombre de color son una o dos palabras («Negro», «Marrón claro»). Tres o más
    // ya es una frase que siguió a la lista, no un color.
    .filter((l) => l.split(/\s+/).length <= 2 && !/[.:;]$/.test(l))
    .map((l) => l.replace(/^[-•*\d.)\s]+/, '').trim())
    .filter(Boolean);
}

/** Los productos que quedaron con una sola variante y varias fotos. */
export function candidatos(catalogo) {
  return catalogo.filter((p) => p.variantes.length === 1 && p.variantes[0].imagenes.length > 1);
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function html(productos) {
  const datos = productos.map((p) => ({
    codigo: p.origen.ref,
    slug: p.id,
    nombre: p.nombre,
    sku: p.variantes[0].sku,
    color: p.variantes[0].color,
    colores: coloresDeDescripcion(p.descripcion),
    /**
     * El ancho sale de `anchos`, NO se asume 600.
     *
     * Acá se hardcodeó `w600.webp` y la foto 4 de CG34337 no cargaba: su original medía
     * menos de 600 px, así que sólo existe `w300` (§5.5, «nunca se amplía»). El campo
     * `anchos` está en el catálogo precisamente para esto, y `urlImagen` del sitio
     * revienta si le pedís un ancho que la imagen no tiene — acá, al ser una `<img>`
     * suelta, no reventaba: quedaba un hueco.
     *
     * Es el mismo bug que `lib/imagenes.ts` existe para no repetir: armar la clave a
     * mano en un lugar más.
     */
    fotos: p.variantes[0].imagenes.map((i) => ({
      hash: i.base.replace('catalogo/', ''),
      ancho: Math.max(...i.anchos),
    })),
  }));

  const fichas = datos
    .map(
      (p, iProd) => `
  <section class="producto" data-i="${iProd}">
    <h2>${esc(p.nombre)} <code>${esc(p.codigo)}</code></h2>
    <p class="meta">variante actual: <strong>${esc(p.color)}</strong> · sku <code>${esc(p.sku)}</code> · ${p.fotos.length} fotos</p>
    ${
      p.colores.length > 0
        ? `<p class="meta">colores de la descripción: ${p.colores.map((c) => `<b>${esc(c)}</b>`).join(' · ')}</p>`
        : `<p class="meta aviso">La descripción no lista colores. Escribilos vos en cada foto.</p>`
    }
    <div class="fotos">
      ${p.fotos
        .map(
          (f, iFoto) => `
      <figure>
        <img src="${R2}/catalogo/${f.hash}/w${f.ancho}.webp" alt="" loading="lazy"
             onerror="this.closest('figure').classList.add('rota')" />
        <figcaption>${iFoto + 1}</figcaption>
        <input list="colores-${iProd}" data-prod="${iProd}" data-hash="${f.hash}"
               placeholder="color" autocomplete="off" />
      </figure>`
        )
        .join('')}
    </div>
    <datalist id="colores-${iProd}">${p.colores.map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist>
  </section>`
    )
    .join('\n');

  return `<!doctype html>
<html lang="es-PY"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Repartir fotos en colores</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; padding: 1.5rem; max-width: 1100px; }
  h1 { font-size: 1.3rem; }
  .ayuda { background: color-mix(in srgb, canvas 92%, canvastext); padding: .75rem 1rem; border-radius: 6px; }
  .producto { border-top: 2px solid color-mix(in srgb, canvas 80%, canvastext); padding: 1.25rem 0; }
  h2 { font-size: 1.05rem; margin: 0 0 .25rem; }
  .meta { margin: .15rem 0; font-size: .85rem; opacity: .8; }
  .aviso { color: #b45309; }
  .fotos { display: flex; flex-wrap: wrap; gap: .75rem; margin-top: .75rem; }
  figure { margin: 0; width: 160px; position: relative; }
  img { width: 160px; height: 160px; object-fit: contain; background: color-mix(in srgb, canvas 94%, canvastext); border-radius: 6px; display: block; }
  figcaption { position: absolute; top: 4px; left: 4px; background: #000a; color: #fff; border-radius: 999px; width: 22px; height: 22px; display: grid; place-items: center; font-size: .75rem; }
  input { width: 100%; margin-top: .35rem; padding: .35rem .5rem; font: inherit; border-radius: 4px; border: 1px solid color-mix(in srgb, canvas 70%, canvastext); background: canvas; color: canvastext; }
  input:not(:placeholder-shown) { border-color: #16a34a; }
  /* Una foto que no carga tiene que GRITARLO. Un hueco silencioso se etiqueta a ciegas. */
  .rota img { outline: 3px solid #dc2626; }
  .rota::after { content: "no carga"; position: absolute; top: 4px; right: 4px; background: #dc2626; color: #fff; font-size: .7rem; padding: 1px 6px; border-radius: 999px; }
  #barra { position: sticky; bottom: 0; background: canvas; border-top: 2px solid color-mix(in srgb, canvas 70%, canvastext); padding: .75rem 0; margin-top: 1rem; }
  button { font: inherit; padding: .5rem 1rem; border-radius: 6px; cursor: pointer; }
  textarea { width: 100%; height: 11rem; font: 13px/1.4 ui-monospace, monospace; margin-top: .5rem; }
</style></head><body>
<h1>Repartir fotos en colores</h1>
<div class="ayuda">
  <p><strong>Escribí el color debajo de cada foto.</strong> El campo sugiere los colores que
  dice la descripción, pero podés escribir cualquier otro.</p>
  <p>Una foto <strong>sin color queda fuera</strong>: no se asigna a ninguna variante. Sirve
  para las fotos de detalle que no son de un color en particular.</p>
  <p>Varias fotos pueden llevar el mismo color, y quedan en ese orden.</p>
</div>
${fichas}
<div id="barra">
  <button id="generar" type="button">Generar el mapeo</button>
  <span id="estado"></span>
  <textarea id="salida" readonly placeholder="Acá aparece el mapeo para pasarme."></textarea>
</div>
<script>
  const DATOS = ${JSON.stringify(datos)};
  document.getElementById('generar').addEventListener('click', () => {
    const mapeo = [];
    let sinAsignar = 0;
    DATOS.forEach((p, i) => {
      const porColor = new Map();
      document.querySelectorAll('input[data-prod="' + i + '"]').forEach((el) => {
        const color = el.value.trim();
        if (!color) { sinAsignar++; return; }
        if (!porColor.has(color)) porColor.set(color, []);
        porColor.get(color).push(el.dataset.hash);
      });
      if (porColor.size === 0) return;
      mapeo.push({ codigo: p.codigo, variantes: [...porColor].map(([color, fotos]) => ({ color, fotos })) });
    });
    document.getElementById('salida').value = JSON.stringify(mapeo, null, 2);
    document.getElementById('estado').textContent =
      ' ' + mapeo.length + ' producto(s), ' + sinAsignar + ' foto(s) sin asignar.';
  });
</script>
</body></html>`;
}

const args = process.argv.slice(2);
const iCatalogo = args.indexOf('--catalogo');
const CATALOGO = iCatalogo === -1 ? CATALOGO_POR_DEFECTO : args[iCatalogo + 1];
const filtro = args
  .filter((a, i) => !a.startsWith('--') && i !== iCatalogo + 1)
  .map((s) => s.toUpperCase());

const catalogo = JSON.parse(await readFile(CATALOGO, 'utf8'));
const productos = candidatos(catalogo).filter(
  (p) => filtro.length === 0 || filtro.includes(p.origen.ref.toUpperCase())
);

if (productos.length === 0) {
  console.error(
    `No hay candidatos${filtro.length ? ` para ${filtro.join(', ')}` : ''} en ${CATALOGO} ` +
      `(${catalogo.length} productos).
` +
      'Si ese numero es chico, el archivo tiene un volcado LOCAL y no el catalogo. ' +
      'Pasa el catalogo con --catalogo <ruta>.'
  );
  process.exit(1);
}

console.log(`Catalogo: ${CATALOGO} (${catalogo.length} productos)`);

await mkdir('scripts/colores', { recursive: true });
await writeFile(SALIDA, html(productos));
console.log(`${SALIDA} — ${productos.length} producto(s), ${productos.reduce((n, p) => n + p.variantes[0].imagenes.length, 0)} fotos.`);
