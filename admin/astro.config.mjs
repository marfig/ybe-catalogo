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
});
