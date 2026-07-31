/**
 * Normaliza un pathname a su forma canonica publica.
 *
 * Con `build.format: 'file'` (SPEC §7.1), `Astro.url.pathname` devuelve el path
 * del archivo generado, no la URL que ve el visitante:
 *
 *   /index.html              -> /
 *   /productos/x.html        -> /productos/x
 *   /categorias/mochilas/2.html -> /categorias/mochilas/2
 *
 * En dev el pathname ya viene sin extension, asi que la funcion es idempotente
 * y da el mismo resultado en ambos modos. Sin esto, el canonical de la home
 * apuntaria a /index.html y el de cada ficha a /productos/x.html.
 */
export function rutaCanonica(pathname: string): string {
  // 1. Sacar la extension del archivo generado. El ancla `$` evita tocar un
  //    punto interno del slug (mochila-18.5).
  let ruta = pathname.replace(/\.html$/, '');

  // 2. Un index colapsa a su directorio. `\/index$` exige la barra previa, asi
  //    que un slug como "indexado" o "index-glass" no se toca.
  ruta = ruta.replace(/\/index$/, '');

  // 3. Sin barra final, coherente con `trailingSlash: 'never'`.
  if (ruta.length > 1 && ruta.endsWith('/')) {
    ruta = ruta.slice(0, -1);
  }

  return ruta === '' ? '/' : ruta;
}

/**
 * URL canonica absoluta de la pagina actual.
 *
 * `site` sale de `Astro.site`, que Astro deriva de SITE_URL. Es `URL | undefined`:
 * si SITE_URL falta, `astro.config.mjs` ya aborta el build (SPEC §9.1), por lo
 * que aca `undefined` solo puede darse por un error de programacion.
 */
export function urlCanonica(pathname: string, site: URL | undefined): URL {
  if (!site) {
    throw new Error(
      'Astro.site es undefined: no se puede construir una URL canonica. ' +
        'Verificar que SITE_URL este definida.'
    );
  }
  return new URL(rutaCanonica(pathname), site);
}
