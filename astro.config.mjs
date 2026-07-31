import { defineConfig, envField } from 'astro/config';
import preact from '@astrojs/preact';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';

// Los archivos .env NO se cargan dentro de los archivos de configuracion de Astro.
// Hay que leerlos explicitamente con loadEnv de Vite. Ver SPEC §9.1.
const { SITE_URL } = loadEnv(process.env.NODE_ENV ?? 'development', process.cwd(), '');

// Sin SITE_URL, Astro.site queda undefined y las URLs canonicas se rompen en
// silencio. Falla ruidosa en vez de sitio mal indexado. Ver SPEC §7.1.
if (!SITE_URL) {
  throw new Error(
    'SITE_URL no esta definida. Copia .env.example a .env y completala.\n' +
      'Sin SITE_URL, Astro.site queda undefined y el canonical se rompe en silencio.'
  );
}

export default defineConfig({
  site: SITE_URL,
  output: 'static',

  // Una sola forma canonica por URL. Con los defaults ('ignore' + 'directory'),
  // /productos/x y /productos/x/ responden ambas y compiten por la indexacion.
  trailingSlash: 'never',
  build: { format: 'file' },

  integrations: [preact()],
  vite: { plugins: [tailwindcss()] },

  env: {
    schema: {
      PUBLIC_R2_BASE: envField.string({ context: 'client', access: 'public' }),
      PUBLIC_WHATSAPP: envField.string({ context: 'client', access: 'public' }),

      // Default false: si alguien olvida configurarlo, el sitio queda fuera del
      // indice. La falla segura es no indexar. Ver SPEC §7.2.
      INDEXABLE: envField.boolean({
        context: 'server',
        access: 'public',
        default: false,
      }),
    },
  },
});
