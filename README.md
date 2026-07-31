# YBE Catálogo

Catálogo estático de productos con contacto por WhatsApp. Sin pagos, sin cuentas de usuario, sin stock en vivo.

Especificación técnica completa: [`docs/SPEC.md`](docs/SPEC.md).

---

## Puesta en marcha

```bash
npm install
cp .env.example .env      # y completar (ver abajo)
npm run dev               # http://localhost:4321
```

### Variables de entorno

`.env` no se commitea. Las ocho variables están documentadas en SPEC §9.1.

| Variable | Valor |
|---|---|
| `SITE_URL` | `http://localhost:4321` en local. En producción, la URL del deploy |
| `INDEXABLE` | `false` hasta tener dominio propio |
| `PUBLIC_R2_BASE` | `/img-dev` para desarrollo local, o el dominio público del bucket R2 |
| `PUBLIC_WHATSAPP` | `595981857213` |
| `R2_ACCOUNT_ID`, `R2_BUCKET` | Solo el importador |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Solo el importador. **Secretas** |

> **En Git Bash / MSYS no pasar `PUBLIC_R2_BASE` por línea de comandos.** MSYS traduce
> `/img-dev` a `C:/Program Files/Git/img-dev` y el sitio queda con todas las imágenes
> roscadas. Definirla en `.env`, que lo lee Vite sin pasar por el shell. Si hace falta
> pasarla igual, prefijar con `MSYS_NO_PATHCONV=1`.
> `validarBaseR2()` detecta este caso y rompe el build con el motivo.

### Imágenes en desarrollo

Mientras no haya R2, las derivadas se generan localmente **con la misma estructura de
claves** que usará R2, así que pasar a producción es solo cambiar `PUBLIC_R2_BASE`:

```bash
node scripts/dev/imagenes-locales.mjs    # samples/ -> public/img-dev/
```

---

## Actualizar el catálogo

**Es un proceso manual que se corre cuando vos querés.** No hay nada agendado ni
automático. Los precios se sostienen 2–3 meses (SPEC §7.3), así que en la práctica esto
se hace unas pocas veces al año, o cuando el proveedor carga productos nuevos.

El ciclo completo son cinco pasos:

### 1. Bajar el catálogo del proveedor

```bash
npm run scrape
```

Recorre el sitio del proveedor y escribe `scripts/import/entrada/crudo-{fecha}.json`
más las imágenes originales en `scripts/import/cache/`.

- Respeta el `robots.txt` del proveedor y va a **1 request por segundo**. Un catálogo
  de 1.500 productos tarda ~25 minutos. Está bien: se corre pocas veces al año.
- Tiene caché en disco: una URL ya bajada no se vuelve a pedir.
- Si se corta, `npm run scrape -- --reanudar` sigue donde quedó.
- Para probar sin bajar todo: `npm run scrape -- --limite 20`.

Esta etapa **no toca `src/` ni R2**. Si falla, no deja nada a medio escribir.

### 2. Ver qué falta curar

```bash
npm run import -- --dry-run
```

Escribe un reporte en `scripts/import/reporte-{fecha}.md` sin modificar nada. La sección
importante es **`SIN CURAR`**: los modelos nuevos que el scrape encontró y que todavía no
tienen nombre ni precio.

### 3. Cargar nombres y precios

El sitio del proveedor **no publica nombres ni precios** (SPEC §2.3), así que eso lo
escribís vos en `scripts/import/overlay/chenson.json`, con el código de modelo como clave:

```json
{
  "CG85527": {
    "nombre": "Cartera de fiesta con strass",
    "precio": 195000,
    "descripcion": "Opcional.",
    "destacado": true
  }
}
```

- **Sin `nombre`, el producto entra con `activo: false`** y no se publica. Las imágenes
  quedan igual procesadas y subidas, así que cuando le escribas el nombre se activa sin
  volver a tocar R2.
- **Sin `precio`**, se publica mostrando "Consultar precio". Es válido, pero ese producto
  no lleva structured data de `Product` y pierde el rich result (SPEC §7.3).
- El precio es **tu precio de venta**, en guaraníes, entero. No el costo del proveedor.

### 4. Importar

```bash
npm run import
```

Genera `src/data/productos.json`, sube las imágenes nuevas a R2 y escribe el reporte.

- Es **idempotente**: correrlo dos veces con la misma entrada no cambia nada.
  Verificable con `git diff --exit-code src/data/productos.json`.
- Solo sube imágenes que no estén ya en R2 (dedupe por hash de contenido).
- Nunca pisa tu curaduría: `activo` y `destacado` no se sobreescriben.
- Un producto que ya no está en el catálogo del proveedor **no se borra**: pasa a
  `activo: false`. Borrarlo mataría su URL y su indexación.
- Si un precio cambió más de ±25 %, marca `⚠ REVISAR` y termina con código 2. A esta
  escala eso suele ser un dígito de más tipeado, no un aumento real.

### 5. Revisar y publicar

```bash
npm test
npm run build
npm run preview      # revisar en local antes de publicar
npm run deploy
```

Leé el reporte antes de desplegar: ahí están las altas, las bajas, los cambios de precio
y los avisos.

---

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción a `dist/` |
| `npm run preview` | Sirve `dist/` para revisar antes de publicar |
| `npm run check` | Chequeo de tipos |
| `npm test` | Suite de tests |
| `npm run scrape` | Etapa 1: baja el catálogo del proveedor |
| `npm run import` | Etapa 2: genera `productos.json` y sube a R2 |
| `npm run deploy` | Publica en Cloudflare Workers |

En Astro 7 el servidor de desarrollo corre como daemon: `npx astro dev stop`,
`npx astro dev status`, `npx astro dev logs`.

---

## Qué se edita a mano y qué no

| Archivo | |
|---|---|
| `src/data/productos.json` | **GENERADO.** No editar: la próxima importación lo reescribe |
| `scripts/import/overlay/chenson.json` | **A mano.** Nombres, precios y destacados |
| `scripts/import/mapeo/chenson.json` | **A mano.** Categorías del proveedor → slugs propios, y colores → hex |
| `src/data/categorias.json` | **A mano.** Orden y visibilidad de la navegación |
| `scripts/import/manifest.json` | **GENERADO** y commiteado. Es el estado que da idempotencia |
| `scripts/import/entrada/`, `cache/` | Gitignorados. Insumos regenerables |

---

## Producción

**https://ybe-catalogo.chenson.workers.dev** — Cloudflare Workers, con `noindex`.

```bash
npm run build && npx wrangler deploy
```

`INDEXABLE` se mantiene en `false` mientras el sitio viva en `.workers.dev`: si Google
indexa esa URL, después compite con el dominio propio por las mismas páginas.

## Estado

- **Fase 1** — catálogo navegable. Listo y desplegado, con imágenes locales.
- Pendiente: bucket R2 y token de escritura; etapa 1 del scrape; logo definitivo (SVG y
  variante monocromática); redes sociales; dominio propio.

Puntos abiertos al día: `docs/SPEC.md` §12.
