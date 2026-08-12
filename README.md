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
| `PUBLIC_R2_BASE` | La URL pública del bucket R2. `/img-dev` solo para trabajar sin red |
| `PUBLIC_WHATSAPP` | `595981857213` |
| `R2_ACCOUNT_ID`, `R2_BUCKET` | Solo el importador |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Solo el importador. **Secretas** |

> **En Git Bash / MSYS no pasar `PUBLIC_R2_BASE` por línea de comandos.** MSYS traduce
> `/img-dev` a `C:/Program Files/Git/img-dev` y el sitio queda con todas las imágenes
> roscadas. Definirla en `.env`, que lo lee Vite sin pasar por el shell. Si hace falta
> pasarla igual, prefijar con `MSYS_NO_PATHCONV=1`.
> `validarBaseR2()` detecta este caso y rompe el build con el motivo.

### Imágenes

**Las imágenes del catálogo viven en R2.** `PUBLIC_R2_BASE` apunta al bucket y el
`Cache-Control` inmutable viaja en cada objeto, puesto al subirlo — R2 no lee
`public/_headers`.

```bash
npm run subir-existentes -- --dry-run   # ver el plan sin escribir nada
npm run subir-existentes                # idempotente: solo sube lo que falta
```

Para trabajar **sin red** se pueden regenerar las derivadas en local, con la misma
estructura de claves, y apuntar `PUBLIC_R2_BASE` a `/img-dev`:

```bash
node scripts/dev/imagenes-locales.mjs    # samples/ -> public/img-dev/ (gitignoreado)
```

> **Ojo: hay dos `/img-dev` y no son lo mismo.** Este es una carpeta de archivos
> estáticos del sitio público. El del admin es un **endpoint** que lee el R2 local de
> miniflare y sólo existe en desarrollo (SPEC-etapa2 §8.1). Mismo nombre porque
> significan lo mismo —«las imágenes, en desarrollo»— pero el mecanismo no tiene nada
> que ver.

---

## Actualizar el catálogo

**Todo se hace desde el admin, sin terminal**: [ybe-admin.chenson.workers.dev](https://ybe-admin.chenson.workers.dev).
Se entra con un PIN de un solo uso al email — Cloudflare Access, sin contraseñas
(SPEC-etapa2 §6).

Es un proceso manual que se corre cuando vos querés. No hay nada agendado: un scrape
automático publicaría sin que nadie mire.

### 1. Importar del proveedor

**Importar desde el proveedor** → pegás la dirección del lanzamiento
(`.../lanzamientos/?lz=2026-07-16`) → **Importar**.

- Va a **1 request por segundo** y respeta el `robots.txt`. Una tanda de ~50 modelos
  son unos minutos, y las fotos son el 75 % de ese tiempo.
- **«Saltear los productos que ya tengo»** viene tildado. Sin eso, reimportar una tanda
  cuesta lo mismo que importarla la primera vez.
- **No cierres la pestaña**: el recorrido corre ahí (§7.1). Si se corta, lo que ya entró
  queda y volver a importar sigue desde donde estaba.
- Los productos entran como **«Por aprobar»**. Nada se publica solo.

### 2. Completar los datos

**Ver productos** → nombre, precio y categoría se editan en la grilla misma. El
proveedor no publica ninguna de las tres (SPEC §2.3), así que las escribís vos.

Hay búsqueda por código o nombre, y acciones en lote: asignar categoría a varios de una
vez, que con 50 productos del mismo tipo es la diferencia entre minutos y horas.

**La descripción llega ya escrita con las medidas** —«Medidas aprox. (alto x largo x
ancho): 21 x 29 x 14 cm»— porque el proveedor sí las publica y son lo primero que
pregunta un cliente. Editala libremente: los saltos de línea que escribas se muestran
como saltos de línea en la ficha.

> **Las medidas se siembran sólo al crear el producto.** Reimportar uno que ya existe no
> vuelve a tocar la descripción, así que lo que escribiste no se pierde nunca. La
> contracara: si el proveedor corrige una medida, en un producto que ya tenés no se
> actualiza sola.

### 3. Aprobar

Aprobar valida que el producto esté completo y **le crea la dirección web, que no
cambia nunca más** (§5.2). Por eso no se aprueba sin mirar: el slug se genera una sola
vez y renombrar el producto después no lo mueve.

### 4. Publicar

Botón **Publicar cambios** en el Inicio. Es una acción de lote, no por producto.

El Inicio avisa **«Hay N cambios sin publicar»** cuando el catálogo difiere del sitio —
incluidas las ediciones de productos que ya estaban publicados, no sólo los aprobados
nuevos.

Publicar dispara GitHub Actions, que vuelca D1 a `productos.json`, corre los tests,
construye, commitea y despliega (§11.2). Tarda unos minutos y **la pantalla se
actualiza sola** mientras tanto. Si falla, el admin lo dice en castellano y sin stack.

### Cargar un producto a mano

**Cargar un producto** → código, nombre, precio, categorías y fotos. Las fotos se
recortan a un cuadrado centrado en el navegador y se suben ya derivadas: no hay
`sharp` en Workers, el motor de imágenes es el `<canvas>` (§8.1).

### Revisar bajas del proveedor

El proveedor discontinúa modelos y no avisa. **Revisar bajas del proveedor** le
pregunta a su buscador, producto por producto, si todavía los publica.

**No borra nada.** Marca los que ya no están, y vos decidís desde la grilla con el
filtro **«Ya no está en el proveedor»** — donde la acción es la misma **Eliminar** de
siempre, con su pantalla de confirmación.

- Va a 1 request por segundo, igual que la importación, y **no cierres la pestaña**.
- Revisa hasta 300 por corrida, empezando por los que hace más tiempo que nadie mira.
  Lo que no entró queda primero en la próxima: apretás de nuevo y sigue por ahí. No
  hace falta acordarse de nada ni elegir un filtro.
- Los cargados a mano no se revisan: el proveedor no los conoce.
- **«No se pudo revisar» no es una baja.** Si el proveedor no contesta lo que se
  espera, el producto queda como estaba y le vuelve a tocar en el próximo barrido. Es
  lo que evita que un mal día del sitio marque el catálogo entero como dado de baja.

Para chequear unos pocos sin barrer todo: tildalos en la grilla y **Verificar en el
proveedor**.

### Eliminar

En la grilla, **Eliminar**. La pantalla siguiente dice qué va a pasar con cada uno,
porque no son lo mismo:

| Estado | Qué pasa |
|---|---|
| Nunca publicado | **Borrado definitivo**, con sus fotos |
| Publicado | Va a la **papelera**. El enlace deja de mostrarlo pero no queda roto, y se puede restaurar |

Un producto que tuvo URL no se borra de verdad: esa dirección puede estar en la
conversación de WhatsApp de un cliente, y ahí un 404 no lo reporta nadie (§12.1).

---

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción a `dist/` |
| `npm run preview` | Sirve `dist/` para revisar antes de publicar |
| `npm run check` | Chequeo de tipos |
| `npm test` | Suite de tests |
| `npm run deploy` | Publica el sitio en Cloudflare Workers |
| `npm run volcar` | Vuelca D1 a `productos.json`. Con `--dry-run` muestra el plan sin escribir |
| `npm run subir-existentes` | Histórico: subió a R2 las imágenes de `samples/` en la fase 2.1. Idempotente |

**Publicar no se hace desde acá.** El botón del admin dispara GitHub Actions, que corre
`volcar`, los tests, el build y el deploy en ese orden (§11.2). `npm run volcar` está
para mirar qué cambiaría, no para publicar a mano.

Los comandos del admin viven en `admin/`: `npm --prefix admin run dev`, `check`,
`deploy`.

En Astro 7 el servidor de desarrollo corre como daemon: `npx astro dev stop`,
`npx astro dev status`, `npx astro dev logs`. **Al agregar un `.ts` nuevo hay que
reiniciarlo**: las entradas del pre-bundler se rastrean al arrancar.

---

## Qué se edita a mano y qué no

**La fuente de verdad del catálogo es D1**, no el repositorio. Los nombres, precios y
categorías se escriben en el admin; acá abajo queda lo que sigue viviendo en git.

| Archivo | |
|---|---|
| `src/data/productos.json` | **GENERADO** por el volcado y commiteado por la Action. No editar: el próximo volcado lo reescribe |
| `src/data/categorias.json` | **A mano.** Orden y visibilidad de la navegación. Una categoría nueva es un commit, no una pantalla: es lo que hace que `reference('categorias')` rompa el build ante un slug inválido (§5.4a) |
| `db/migrations/*.sql` | **A mano**, numeradas. Se aplican con `wrangler d1 migrations apply -c db/wrangler.jsonc` |
| `scripts/volcado/__tests__/fixtures/` | **CONGELADO.** Fixture del ida y vuelta. No es `productos.json`: un test cuyo fixture es un artefacto de build no prueba lo que dice probar |

---

## Producción

**https://ybe-catalogo.chenson.workers.dev** — Cloudflare Workers, con `noindex`.

```bash
npm run build && npx wrangler deploy
```

`INDEXABLE` se mantiene en `false` mientras el sitio viva en `.workers.dev`: si Google
indexa esa URL, después compite con el dominio propio por las mismas páginas.

## Estado

**La etapa 2 está terminada.** El admin vive en `ybe-admin.chenson.workers.dev`,
detrás de Cloudflare Access con login por PIN al email, y publica el sitio apretando
un botón. Las ocho fases cerradas con su criterio de salida verificado.

- **Fase 1** — catálogo navegable. Cerrada.
- **Fase 2.1** — imágenes en R2, servidas con cache inmutable. Cerrada.
- **Fase 2.2** — D1 y volcado, con publicación por GitHub Actions. Cerrada: dos
  volcados seguidos dejan `git diff --exit-code` limpio.
- **Fase 2.3** — admin de lectura y edición. Cerrada: se importó, aprobó y publicó
  desde el navegador, sin terminal, y el producto quedó en el sitio.
- **Fase 2.4** — carga manual con fotos de celular. Cerrada: producto cargado desde
  `/nuevo`, recortado, aprobado, publicado y visible.
- **Fase 2.5** — scrape del proveedor: importación con progreso en vivo, cortesía de
  1 request/segundo e idempotencia. Cerrada.
- **Fase 2.6** — eliminación y papelera: borrado físico de lo que nunca se publicó,
  lógico de lo que sí, restaurar y vaciar. Cerrada.
- **Fase 2.7** — el código del producto, visible en la ficha y en el mensaje de
  WhatsApp. Cerrada.

- **Barrido de bajas** — preguntarle al proveedor qué de lo que tenemos ya no publica,
  marcarlo y dejar la decisión en manos de una persona. Migración `0005`.

Pendiente fuera de la etapa 2: buscador por código o nombre en el sitio público;
el scrape del catálogo **viejo** (otro sitio, migración de una sola vez); logo
definitivo (SVG y variante monocromática); redes sociales; **dominio propio**.

> **El dominio bloquea el lanzamiento, no el desarrollo.** Las fotos se sirven por
> `r2.dev`, que Cloudflare documenta como *development-only* y con rate limit. Todo
> el trabajo de la etapa 2 corre sobre eso sin problema, pero abrir el sitio a
> clientes reales necesita el dominio — y ya no solo por SEO.

Puntos abiertos al día: `docs/SPEC.md` §12.
