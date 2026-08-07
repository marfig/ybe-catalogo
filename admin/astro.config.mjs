// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

/**
 * Admin: Worker SSR con bindings a D1 y R2 (SPEC-etapa2 §4.1).
 *
 * Es un proyecto APARTE del sitio publico a proposito. Si compartieran Worker
 * compartirian bindings, y el catalogo — que es de solo lectura — quedaria con
 * permiso de escritura sobre D1 y R2 sin necesitarlo. Ademas los assets del sitio
 * publico dejarian de ser gratis al meter SSR en el mismo Worker.
 *
 * `output: 'server'` sin prerender: cada pagina del admin lee de D1 y no hay nada
 * que valga la pena servir estatico.
 *
 * OJO CON LA VERSION DEL ADAPTER: `@astrojs/cloudflare` 13.x declara peer
 * `astro ^6` y este proyecto va con Astro 7, asi que la instalacion falla con
 * ERESOLVE. La linea 14.x es la que declara peer `astro ^7`. Si aparece un
 * conflicto de peers al instalar, es esto y no hace falta `--legacy-peer-deps`.
 */
export default defineConfig({
  output: 'server',

  adapter: cloudflare({
    /**
     * El admin no transforma imagenes: las miniaturas de la grilla salen de R2 por
     * URL, ya derivadas por el pipeline (§8). Sin esto el adapter usa
     * `cloudflare-binding` por defecto y AGREGA un binding `IMAGES` al
     * wrangler.json que genera, que se auto-provisiona en el deploy. Infra que
     * nadie pidio y nadie usa.
     *
     * NO se declara `platformProxy`: existia en el adapter 13.x y en la linea 14.x
     * ya no. Los bindings en `astro dev` los levanta el plugin de Vite de
     * Cloudflare corriendo el Worker en workerd de verdad, que es mejor que el
     * proxy anterior. Dejarlo puesto no da error: se ignora en silencio.
     */
    imageService: 'passthrough',
  }),

  /**
   * SESIONES: el adapter agrega un KV `SESSION` al wrangler.json generado y lo
   * auto-provisiona en el deploy, salvo que se declare un `session.driver` propio.
   *
   * Se ACEPTA el default en vez de suprimirlo con un driver de mentira. El admin no
   * usa sesiones — la autenticacion la resuelve Access — asi que el namespace queda
   * sin uso, pero entra en el free tier y pelearle al framework con un driver falso
   * se rompe el dia que el admin quiera un mensaje de "guardado" entre redirects.
   * Queda anotado como recurso auto-provisionado en §13.
   */

  /**
   * NO se declara `env` con astro:env.
   *
   * En Workers la configuracion llega del entorno del Worker, que se importa con
   * `import { env } from 'cloudflare:workers'`. Declarar las mismas variables
   * tambien en `astro:env` invita a leer la que no es y a que un valor ausente
   * parezca presente. Se lee con `leerConfigAccess(env)`, que falla con la lista
   * de lo que falta.
   *
   * OJO: `Astro.locals.runtime.env` YA NO EXISTE — se removio en Astro 6 y el
   * sintoma es un 500 en el primer acceso, con el motivo en el overlay.
   */
  devToolbar: { enabled: false },

  /**
   * CSRF: se rechaza todo POST de formulario que venga de otro origen.
   *
   * Hace falta de verdad y no es paranoia. Cloudflare Access autentica con la cookie
   * `CF_Authorization` e inyecta el header con el JWT, asi que un formulario alojado
   * en OTRO sitio que apunte al admin mandaria la cookie, Access lo dejaria pasar, y
   * el request llegaria autenticado. La validacion del JWT no protege de esto: el
   * token es legitimo, lo que no es legitimo es quien disparo el request.
   *
   * Astro lo implementa comparando el header `origin` contra el origen del sitio
   * (`core/app/origin-check.js`). Va EXPLICITO aunque el default sea `true`: es un
   * control de seguridad, y depender de un default es depender de que nadie lo
   * cambie en una version futura.
   */
  security: { checkOrigin: true },

  /**
   * ============================================================================
   * EL 500 DEL OPTIMIZADOR DE DEPS — resuelto, y por qué
   * ============================================================================
   *
   * Síntoma: en `astro dev`, cada tanto, un 500 con
   *
   *   The file does not exist at ".vite/deps_ssr/<algo>.js?v=094fef51" which is in
   *   the optimize deps directory.
   *
   * CAUSA. El entorno `ssr` que arma `@cloudflare/vite-plugin` corre con
   * `resolve.noExternal: true` —en Workers nada puede quedar externo— y con
   * `optimizeDeps.noDiscovery: false`, así que toda dependencia entra al optimizador.
   * Sus entradas de rastreo son:
   *
   *   ['@astrojs/cloudflare/entrypoints/server',
   *    'src/**\/*.{jsx,tsx,vue,svelte,html,astro}']
   *
   * y los `.ts` NO están en ese glob. Los módulos de `src/lib/` y `src/scripts/`
   * quedaban sin rastrear al arrancar y se descubrían recién cuando una ruta los
   * importaba, en pleno request: ahí el optimizador encontraba dependencias nuevas,
   * volvía a empaquetar, el cache cambiaba de `?v=`, y la referencia en vuelo
   * apuntaba al hash viejo. En SSR eso no se recupera con un reload: es el 500.
   *
   * Por eso empeoraba con el tiempo: cada módulo nuevo en `lib/` sumaba una mina.
   *
   * VERIFICADO CON UN A/B, no deducido. Con los `.ts` en las entradas, el
   * `browserHash` de `deps_ssr/_metadata.json` queda igual después de recorrer todas
   * las rutas. Sin ellos, pasa de `551f147d` a `094fef51` — que es exactamente el
   * hash del error reportado.
   *
   * LO QUE SE PROBÓ ANTES Y NO SIRVE, para no repetirlo:
   *   - `vite.optimizeDeps.exclude` y `vite.ssr.optimizeDeps.exclude`: son la rama
   *     legada y no llegan al entorno del plugin. Hay que usar `environments.ssr`.
   *   - `markdown.syntaxHighlight: false` para achicar el grafo: medido, seguía en
   *     1561 archivos. Prism no entra por la config de markdown.
   *   - Borrar `node_modules/.vite`: arregla por un rato porque fuerza un arranque
   *     limpio, pero el 500 vuelve solo al tocar una ruta no rastreada.
   */
  vite: {
    environments: {
      ssr: {
        optimizeDeps: {
          /**
           * Esta lista REEMPLAZA la del plugin, no se suma: por eso hay que repetir
           * la entrada del adapter. Si un día aparece otra extensión en `src/`,
           * agregarla acá o el 500 vuelve.
           */
          entries: [
            '@astrojs/cloudflare/entrypoints/server',
            'src/**/*.{js,ts,jsx,tsx,vue,svelte,html,astro}',
          ],
        },
      },
    },
  },
});
