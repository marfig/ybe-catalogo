/// <reference types="astro/client" />
/// <reference types="@astrojs/cloudflare" />

/**
 * `identidad` la pone el middleware y NO es opcional a proposito.
 *
 * Si fuera `identidad?`, cada pagina tendria que preguntar si existe y una que se
 * olvidara compilaria igual. Como el middleware corta con 403 antes de llegar a
 * cualquier ruta, dentro de una pagina la identidad siempre esta: el tipo dice la
 * verdad y el compilador ayuda en vez de pedir guardas de mentira.
 */
declare namespace App {
  interface Locals {
    identidad: import('./lib/access.ts').IdentidadAccess;
  }
}
