# YBE Catálogo — Especificación técnica

**Versión:** 1.0 · **Fecha:** 2026-07-31

---

## 1. Alcance

Catálogo de productos web para un comercio en Paraguay. El objetivo es que el cliente encuentre el producto y contacte por WhatsApp. No hay pagos, no hay cuentas de usuario, no hay stock en vivo.

Un único administrador carga y actualiza el contenido. Los datos se importan masivamente por script desde catálogos de proveedores; no se escriben a mano producto por producto.

### 1.1 Stack

| Pieza | Elección |
|---|---|
| Framework | Astro con `output: 'static'`. Sin SSR, sin adapter de servidor |
| Estilos | Tailwind CSS 4 vía el plugin de Vite `@tailwindcss/vite` |
| Islas interactivas | Preact, solo donde haya interacción real |
| Hosting | Cloudflare Workers con assets estáticos. Config en `wrangler.jsonc` |
| Imágenes de catálogo | Cloudflare R2, pre-procesadas antes de subir |
| Imágenes propias del sitio | `astro:assets` desde `src/assets/` |
| Persistencia | Dos archivos JSON versionados en git. Sin base de datos |

### 1.2 Rutas

Planas, no anidadas por categoría:

| Ruta | Contenido |
|---|---|
| `/` | Home: categorías y pedidos especiales |
| `/pedidos-especiales` | Listado de artículos por cantidad (§4.5) |
| `/pedidos-especiales/[slug]` | Ficha de pedido especial: foto, descripción y consulta por WhatsApp |
| `/productos/[slug]` | Ficha de producto |
| `/categorias/[slug]` | Listado filtrado |

Recategorizar un producto no debe romper su URL ni su indexación. Por eso la categoría no forma parte del path del producto.

### 1.3 Fuente de datos

- `src/data/productos.json` — generado por el script de importación. Nunca se edita a mano.
- `src/data/categorias.json` — escrito a mano. Define orden y visibilidad de la navegación.

Se consumen con Content Collections usando el loader `file()` y schemas Zod. Un producto puede pertenecer a más de una categoría. El campo `activo` oculta productos sin borrarlos.

### 1.4 Dominio y despliegue

El sitio arrancó en un subdominio `.workers.dev` con `noindex`. La URL base sale de la variable de entorno `SITE_URL` y nunca se hardcodea. El paso a dominio propio no requiere cambios de código: solo cambian `SITE_URL` e `INDEXABLE`.

**Cumplido.** El sitio vive en `https://asuncionybe.com` y la migración no tocó una sola línea de código: sólo variables de entorno y configuración de Cloudflare. `www` redirige al apex con un 301 y la ruta `.workers.dev` quedó desactivada, así que hay un único canonical. El admin es la excepción deliberada: se queda en `ybe-admin.chenson.workers.dev` (SPEC-etapa2 §6).

---

## 2. Assets de origen y sus restricciones

El material de origen impone límites que el diseño debe absorber. Esta sección los fija como datos duros; el resto de la spec deriva de ellos.

### 2.1 Logo — `src/assets/logo_plateado.png`

| Propiedad | Valor |
|---|---|
| Dimensiones | 1024 × 1024 (aspect ratio 1:1) |
| Formato | PNG, 8 bits/canal, color type 6 (RGBA), no entrelazado |
| Peso | 945 KB en origen — **~13 KB servidos** en WebP por `astro:assets` |
| Chunks | Solo `IHDR` / `IDAT` / `IEND` — sin metadatos ni manifest C2PA |
| Canal alpha | **Real y funcional.** Esquinas en alpha 0 y 1.7 % del lienzo en alpha parcial, o sea filo antialiaseado de verdad |
| Fondo | **Transparente.** 52.7 % del lienzo es alpha 0 |
| Marca | Medalla circular de metal cepillado, "CHENSON / YBE" |
| BBox visible (alpha > 0) | x 102..941 (840 px) · y 83..916 (834 px) |
| Círculo | ~840 px de diámetro — **82 % del lienzo** |
| Márgenes transparentes | izq 102 · der 82 · arriba 83 · abajo 107 px |

**Hubo una variante dorada (`logo_dorado.png`) que se descartó.** Compartía lienzo, encuadre y bbox al píxel con la plateada; solo cambiaba el tratamiento de metal. Si vuelve a aparecer una variante, la activa se elige en el `import` de `Logo.astro` y los valores de esta tabla siguen sirviendo **solo si el encuadre es idéntico** — verificarlo, no asumirlo.

**La transparencia funciona:** el logo se puede poner sobre cualquier fondo sin caja ni artefactos.

**El umbral del bbox es alpha > 0, no alpha > 128.** El filo antialiaseado se ve, y si el escalado lo deja fuera de la caja el recorte se nota igual. Sobre este archivo los dos umbrales difieren en 1-2 px (0.2 % de escala), pero el criterio correcto es el visible.

**El contenido no está centrado en el lienzo:** el bbox cae 9.5 px a la derecha y 12 px arriba del centro. `src/components/Logo.astro` lo corrige con un `translate`, porque sin eso el escalado empuja la medalla fuera de la caja por arriba y por la derecha y la recorta.

**Cuidado al reemplazar el archivo: el bbox de §2.1 está medido a mano y `Logo.astro` lo usa hardcodeado.** Un reemplazo con otro encuadre o otro lienzo lo invalida y el logo sale mal. Ya pasó dos veces: con el bbox de un archivo de 1024 px sobre un lienzo de 500 la escala quedaba 23 % de más y recortaba; con el bbox de 410 px del archivo de 500 sobre este lienzo de 1024 la escala salía 2.46 y la medalla se dibujaba al doble de la caja, recortada. `Logo.astro` tiene tres guardas que fallan el build — asset no cuadrado, bbox que no cabe en el lienzo, y lienzo distinto al medido — así que esos dos casos ya no pasan en silencio.

**Riesgo conocido que ninguna guarda cubre — y que YA OCURRIÓ:** un reemplazo con el **mismo lienzo y otro encuadre**. Pasó el 2026-08-05: el archivo cambió, el lienzo siguió en 1024, las tres guardas pasaron, y el bbox se había corrido 1 px (`x1` de 942 a 941, `y0` de 82 a 83). No recortó **por suerte**: el bbox hardcodeado quedó más *grande* que el contenido real, así que el logo se dibujó un poco más chico con más margen. Si el corrimiento hubiera sido al revés, recortaba en silencio.

Detectarlo exige volver a medir los píxeles en cada build, y no vale meter `sharp` en el frontmatter de un componente por un parche que se va cuando llegue el logo recortado al trazo. **Al cambiar el archivo hay que remedir el bbox y actualizar esta tabla.** No es un opcional: es la mitad del contrato.

**Limitación menor:** el 18 % de margen transparente hace que la medalla se vea más chica que su caja — a 88 px de caja, el círculo mide ~72 px. `src/components/Logo.astro` lo compensa con un escalado de 1.1993 (gana 20 %) que deja el círculo al 99 % de la caja, verificado a nivel de píxel sin recorte a 64, 88 y 200 px. Está aislado en una constante `MARGEN_SEGURIDAD` y marcado como temporal: cuando llegue un archivo recortado al trazo se pone en `0` y listo.

**Sigue faltando** el SVG vectorial y una variante monocromática del monograma (§12 · Logo definitivo). El PNG tampoco sirve como placeholder de "sin foto" (§5.4).

**Ubicación: `src/assets/`, no `public/`.** En `src/assets/` el archivo pasa por `astro:assets`, que infiere `width`/`height` (evita CLS), genera `srcset` y formatos modernos, y añade hash de contenido para cache inmutable. En `public/` se copiaría tal cual y la optimización quedaría manual. Es el caso que la arquitectura reserva para `astro:assets`: imágenes propias del sitio. Acá se paga solo: el origen de 910 KB se sirve como un WebP de 13 KB.

Requisitos del archivo definitivo en §12 · Logo definitivo.

### 2.2 Imágenes de catálogo — set de origen

Referencia medida sobre las 7 imágenes de `samples/`:

| Archivo | Lienzo | BBox del producto | AR sujeto | Ocupación | Pad sup. |
|---|---|---|---|---|---|
| `11fe5e4a4c…` | 601 × 600 | 348 × 393 | 0.885 | 37.9 % | 83 px |
| `3bc39ebe00…` | 600 × 600 | 353 × 365 | 0.967 | 35.8 % | 111 px |
| `652aee20ea…` | 600 × 600 | 413 × 239 | **1.728** | 27.4 % | 237 px |
| `74bcedecd0…` | 600 × 600 | 399 × 389 | 1.026 | 43.1 % | 87 px |
| `782ab38cbd…` | 600 × 600 | 421 × 409 | 1.029 | 47.8 % | 67 px |
| `96d5e5aaf7…` | 600 × 600 | 547 × 254 | **2.154** | 38.6 % | 222 px |
| `9dadecbc3b…` | 600 × 600 | 457 × 389 | 1.175 | 49.4 % | 87 px |

Características del set:

1. **Lienzo 1:1** en las 7 (AR entre 0.998 y 1.002).
2. **Fondo blanco puro.** Esquinas `255,255,255` en 6 de 7; `253,253,253` en 1. El umbral de blanco del importador **no puede ser `=== 255`**.
3. **600 × 600 es un techo duro**, no una varianza. No hay resolución para ampliar.
4. **La varianza está en el sujeto:** AR de 0.885 a 2.154 (2.4×), ocupación de 27.4 % a 49.4 %, padding superior de 67 a 237 px (3.5×). La grilla y la ficha deben soportar ese rango, no un caso ideal.
5. **Marca de agua `www.chenson.com.py®`** en las 7, en `y ≈ 531–558`, `x ≈ 110–490`.
6. **La marca de agua no es recortable.** En 4 de 7 el producto ocupa esas mismas filas (`782ab38cbd` hasta y≈570, `74bcedecd0` hasta y≈564, `11fe5e4a4c` hasta y≈561). Recortar la banda inferior amputa el producto.
7. **Los nombres de archivo son IDs opacos de 80 hex, no hashes de contenido.** No coinciden con SHA-256, SHA-1 ni MD5 de los bytes. La deduplicación debe hashear el contenido y nunca inferirlo del nombre.

Las 7 son descartables y sirven como fixtures del importador (§6.11).

### 2.3 Sitio de origen — qué expone y qué no

El catálogo se obtiene de `chenson.com.py`. Estructura verificada sobre `/producto/71010-cg85527`:

**URL:** `/producto/{idColor}-{codigoModelo}`. El **código de modelo se comparte entre colores** y el `idColor` cambia por cada uno:

| URL | Color |
|---|---|
| `/producto/71010-cg85527` | `(P) ROSADO` |
| `/producto/70873-cg85527` | `(3) NEGRO` |
| `/producto/70931-cg85527` | `(E) CREMA` |

**Cada ficha lista sus colores hermanos** en un bloque `#other-colors-tbl`, con link, thumbnail y nombre de color. No hay que adivinar la agrupación ni recorrer el catálogo dos veces: una sola ficha revela el modelo completo.

**Nombres de color con prefijo de código:** `(P) ROSADO`, `(3) NEGRO`, `(E) CREMA`. El prefijo `(X)` es código interno del proveedor y se descarta al normalizar.

**Imágenes:** `/Prelude-images/product/{80hex}.jpg`. Los nombres de `samples/` salen de acá, lo que confirma el formato de origen de §2.2.

**Taxonomía de 2 niveles:** `/categoria/{id}-{slug}` y `/categoria/{idPadre}-{slugPadre}/{idHijo}-{slugHijo}`. Once categorías raíz: `cartera`, `mochila`, `billetera`, `bolso`, `valija`, `rinonera`, `portafolio`, `necessaire`, `cartuchera`, `disenos-infantiles`, `porta-traje`. Cada una tiene además una vista `/outlet`.

**Códigos de estado confiables:** un producto inexistente devuelve HTTP 404 real (con cuerpo HTML). El scraper puede confiar en el status y no necesita heurística de soft-404.

**No hay `robots.txt`:** devuelve 404, así que no hay exclusiones declaradas. Las reglas de cortesía de §6.2 (rate limit, User-Agent identificable, caché) se aplican igual.

#### Lo que el origen NO tiene

| Campo del schema | Estado en el origen |
|---|---|
| `nombre` | **No existe.** El `<title>` es `Producto: CG85527 (P) ROSADO`; las tarjetas del listado dicen solo "Ver detalles y colores". Lo único identificatorio es el código de modelo |
| `descripcion` | **No existe.** `og:description` viene vacío |
| `precio` | **No existe.** Sin números con formato de precio, sin la palabra "precio", sin endpoint que los sirva. El sitio tiene `/login` y `/registrarse`: es un portal de revendedores y los precios están detrás de la sesión |

Consecuencia: **el scrape aporta estructura, colores, categorías e imágenes; no aporta nombre, descripción ni precio.** Esos tres tienen que entrar por otra vía (§6.4).

---

## 3. Sistema visual

### 3.1 Paleta

Derivada por muestreo de píxeles del interior de la medalla del logo.

La medalla es metal cepillado: **saturación HLS media 0.068**. Solo el 24.8 % de sus píxeles supera 0.08 de saturación, y todos caen en **hue 30–45°** (bronce cálido). El logo no aporta un color de marca cromático: aporta una familia de neutros cálidos, y la paleta se construye sobre eso.

| Token | Hex | Origen |
|---|---|---|
| `--color-fondo` | `#FAFAF9` | Highlight del metal, `#F8F8F8` (9.026 px muestreados) |
| `--color-superficie` | `#FFFFFF` | Blanco de las fotos de producto; unifica card y foto |
| `--color-texto` | `#2A2622` | Tono más oscuro del relieve, `#332F26` |
| `--color-texto-suave` | `#5F594D` | Bronce medio, `#5F594D` (hue 35°) |
| `--color-primario` | `#5F594D` | El tono con más presencia visual de la medalla |
| `--color-acento` | `#908476` | Bronce claro, `#908476` (hue 30°, chroma 24) |
| `--color-borde` | `#D8D8D0` | Canto claro del metal, `#D8D8D0` |

Contraste WCAG:

| Par | Ratio | Veredicto |
|---|---|---|
| `texto #2A2622` sobre `fondo #FAFAF9` | **14.37 : 1** | AA ✅ · AAA ✅ |
| `texto #2A2622` sobre `superficie #FFFFFF` | 15.01 : 1 | AA ✅ · AAA ✅ |
| `texto-suave #5F594D` sobre `fondo` | 6.65 : 1 | AA ✅ · AAA ❌ (pide 7) |
| Blanco sobre `primario #5F594D` | 6.95 : 1 | AA ✅ — apto para botón con texto blanco |
| `acento #908476` sobre `fondo` | **3.50 : 1** | **Texto normal ❌.** Solo texto ≥24 px, bordes e iconos (piden 3:1) |
| `borde #D8D8D0` sobre `fondo` | 1.37 : 1 | Decorativo. Nunca texto |

Reglas: `--color-acento` no se usa para texto de cuerpo. `--color-borde` no se usa para texto.

### 3.2 Botón de WhatsApp

El botón principal del sitio usa **fondo `--color-primario #5F594D` con texto e icono blancos (6.95:1)**. No usa el verde de WhatsApp `#25D366`: sobre ese verde el blanco da 1.83:1, inaceptable. Si en algún momento se quiere el verde de marca, va con texto `#2A2622` y el ratio se recalcula antes de usarse.

### 3.3 Fotos de producto sobre el fondo del sitio

Las fotos vienen sobre `#FFFFFF` y `--color-fondo` es `#FAFAF9`: el contraste entre ambos es **1.01:1**. Sin intervención, la foto se funde con la página y el producto flota sin límite visible.

**Solución:** el fondo de la card es `--color-superficie #FFFFFF` — igual que la foto, para que el recorte sea invisible — y el límite lo da un borde de 1 px en `--color-borde #D8D8D0` (1.37:1 contra el fondo, suficiente para un borde). No se cambia el color de fondo del sitio.

### 3.4 Header

El logo es 1:1. Escalado a 56 px de alto, el texto curvo "CHENSON" del arco inferior (≈12 % de la altura) queda en ~7 px, ilegible. El header no escala el emblema completo: usa un **lockup horizontal**.

| Breakpoint | Header | Logo | Wordmark |
|---|---|---|---|
| `< 640px` | alto 56 px, sticky | medalla 40 × 40 | oculto |
| `≥ 640px` | alto 64 px, sticky | medalla 48 × 48 | "YBE" en texto real, 20 px, `--color-texto` |

El wordmark es **texto HTML**, no imagen: escala, es seleccionable, no pesa y no depende de la resolución del PNG.

El logo se renderiza con `<Image>` de `astro:assets`, `width={48} height={48}`, `loading="eager"`, `alt=""` — decorativo, porque el nombre ya está en el wordmark de texto adyacente y duplicarlo es ruido para el lector de pantalla.

Fondo del header: `--color-superficie` con `border-bottom: 1px solid --color-borde`.

El logo se renderiza con `Logo.astro`, que compensa el margen transparente del archivo (§2.1). Tamaño de caja: 64 px en móvil, 88 px en desktop.

### 3.5 Variantes derivadas del logo

| Variante | Tamaños | Estado |
|---|---|---|
| `favicon.ico` | 16, 32, 48 | **Viable a 32 y 48.** A 16 px el emblema completo es ilegible: para ese tamaño hace falta la variante monocromática del monograma solo |
| `apple-touch-icon.png` | 180 × 180 | **Viable.** Sobre fondo `--color-superficie`, porque iOS no respeta la transparencia y la compone sobre negro |
| `icon-512.png` | 512 × 512 | **Viable.** Recortado al bbox opaco de §2.1 para no desperdiciar el 14 % de margen |
| `og-image.png` | 1200 × 630 | **Viable.** Composición: fondo `--color-fondo`, medalla escalada a ~500 px de alto centrada, wordmark en texto. **Nunca a sangre**: el origen tiene 1024 px de ancho y estirar un cuadrado a 1200 × 630 lo deforma |

Con la transparencia ya funcionando (§2.1), las tres primeras se pueden generar. Se producen con un script en `scripts/assets/` ejecutado a mano, cuya salida se comitea. **No se generan en cada build.**

---

## 4. Modelo de datos

### 4.1 `src/content.config.ts`

```ts
import { defineCollection, reference, z } from 'astro:content';
import { file } from 'astro/loaders';

const categorias = defineCollection({
  loader: file('src/data/categorias.json'),
  schema: z.object({
    nombre: z.string().min(1),
    orden: z.number().int().nonnegative().default(999),
    activa: z.boolean().default(true),
  }),
});

// Una imagen guarda la clave direccionada por contenido SIN el sufijo de
// tamano, mas los anchos que realmente existen. `anchos` es explicito porque
// segun §5.5 un origen chico genera solo w300: sin este dato el srcset
// apuntaria a un archivo inexistente.
const imagen = z.object({
  base: z.string().regex(/^catalogo\/[0-9a-f]{16}$/),
  anchos: z.array(z.union([z.literal(300), z.literal(600)])).min(1),
});

const variante = z.object({
  sku: z.string().min(1),
  color: z.string().min(1),
  colorHex: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  imagenes: z.array(imagen).default([]),
  activo: z.boolean().default(true),
});

const productos = defineCollection({
  loader: file('src/data/productos.json'),
  schema: z.object({
    nombre: z.string().min(1),
    descripcion: z.string().optional(),
    categorias: z.array(reference('categorias')).min(1),
    precio: z.number().int().positive().nullable(),
    variantes: z.array(variante).min(1),
    activo: z.boolean().default(true),
    actualizado: z.string().date(),
    origen: z.object({
      proveedor: z.string().min(1),
      ref: z.string().min(1),
    }),
  }),
});

export const collections = { productos, categorias };
```

**El `id` es el slug.** El loader `file()` exige un `id` único por objeto y lo expone como `entry.id`. Se aprovecha para no duplicar un campo `slug`. El `id` no va en el schema: el loader lo consume del JSON.

**`reference('categorias')` es deliberado.** Un slug de categoría mal escrito por el importador **rompe el build** en lugar de renderizar una categoría vacía en producción. El costo es que `producto.data.categorias` devuelve objetos `{ collection, id }` y hay que resolverlos con `getEntries()`.

### 4.2 Justificación campo por campo

Regla: si no se usa en ninguna vista, no va.

**Producto**

| Campo | Tipo | Oblig. | Vista que lo consume |
|---|---|---|---|
| `id` (slug) | string | sí (loader) | `/productos/[slug]`, canonical, mensaje de WhatsApp, `key` de la grilla |
| `nombre` | string | sí | Card, `<h1>` de la ficha, `<title>`, OG, JSON-LD, índice de búsqueda, mensaje de WhatsApp |
| `descripcion` | string | no | Ficha, `<meta description>`, JSON-LD. Opcional: los catálogos de proveedor suelen no traerla |
| `categorias` | ref[] ≥1 | sí | Navegación, `/categorias/[slug]`, breadcrumb, filtro. `min(1)` porque un producto sin categoría es inalcanzable |
| `precio` | int \| null | sí (nullable) | Card, ficha, `offers.price`, orden y filtro por precio. `null` explícito = "Consultar precio" (§7.3). Entero: el guaraní no tiene decimales |
| `variantes` | Variante[] ≥1 | sí | Selector de color, galería, mensaje de WhatsApp. `min(1)` porque un producto sin variante no tiene imagen ni SKU |
| `activo` | bool | sí (def. `true`) | Filtro global: oculta sin borrar |
| `actualizado` | date ISO | sí | Orden "novedades"; el importador lo usa para detectar deriva (§6.5) |
| `origen` | objeto | sí | **No se renderiza.** Es la clave de idempotencia del importador (§6.7). Único campo no visual de la spec, y su justificación es esa |

**Variante**

| Campo | Tipo | Oblig. | Vista que lo consume |
|---|---|---|---|
| `sku` | string | sí | Clave estable del selector, `sku` de JSON-LD, mensaje de WhatsApp, dedupe del importador |
| `color` | string | sí | Etiqueta del selector, `alt` de la imagen, mensaje de WhatsApp |
| `colorHex` | string | no | Muestra de color del selector. Sin él, el selector cae a botón con texto |
| `imagenes` | string[] | sí (def. `[]`) | Galería y card. Array vacío ⇒ placeholder (§5.4) |
| `activo` | bool | sí (def. `true`) | Oculta un color discontinuado sin romper el producto |

**Campos descartados:** `stock` (no hay stock en vivo), `peso` y `dimensiones` (ninguna vista los muestra), `precioAnterior` (no hay lógica de descuentos), `imagenPrincipal` (redundante: es `variantes[0].imagenes[0]`), `slug` propio (es el `id`).

**`marca` no es un campo: es una constante del sitio.** El catálogo es de una sola marca, así que un campo `marca` tendría el mismo valor en todos los productos y no discrimina nada. Vive en `src/lib/sitio.ts` y alimenta el `brand` del JSON-LD (§7.5). No entra al índice de búsqueda ni existe filtro por marca (§9.4).

**`precio` vive a nivel producto, no de variante.** Todas las variantes de color de un producto comparten precio. Consecuencias: la card muestra un monto fijo (no un rango), el filtro por precio opera sobre un único valor por producto, y el JSON-LD emite un solo `Product` con un `Offer` (§7.5).

### 4.3 `src/data/categorias.json`

Derivado de las 11 categorías raíz del origen (§2.3), con nombres reescritos para lectura de cliente final:

```json
[
  { "id": "mochilas",    "nombre": "Mochilas",            "orden": 10 },
  { "id": "carteras",    "nombre": "Carteras",            "orden": 20 },
  { "id": "bolsos",      "nombre": "Bolsos",              "orden": 30 },
  { "id": "rinoneras",   "nombre": "Riñoneras",           "orden": 40 },
  { "id": "valijas",     "nombre": "Valijas",             "orden": 50 },
  { "id": "billeteras",  "nombre": "Billeteras",          "orden": 60 },
  { "id": "portafolios", "nombre": "Portafolios",         "orden": 70 },
  { "id": "cartucheras", "nombre": "Cartucheras",         "orden": 80 },
  { "id": "necessaires", "nombre": "Necessaires",         "orden": 90 },
  { "id": "porta-traje", "nombre": "Porta traje",         "orden": 100 },
  { "id": "infantil",    "nombre": "Diseños infantiles",  "orden": 110 },
  { "id": "notebook",    "nombre": "Para notebook",       "orden": 200 },
  { "id": "dama",        "nombre": "Para dama",           "orden": 210 },
  { "id": "escolar",     "nombre": "Vuelta a clases",     "orden": 220 },
  { "id": "fiesta",      "nombre": "Fiesta y noche",      "orden": 230 }
]
```

`orden` y `activa` se omiten cuando el default alcanza. El `id` va sin tildes ni eñes: es segmento de URL.

**Las categorías son planas y ortogonales, sin jerarquía.** Conviven dos ejes en la misma lista: **tipo** (`mochilas`, `carteras`, `bolsos`…, `orden` 10–110) y **uso** (`notebook`, `dama`, `escolar`, `fiesta`, `orden` 200+). Un producto pertenece a las que corresponda de cualquiera de los dos ejes a la vez, y aparece en todos esos listados sin duplicarse.

**El origen tiene 2 niveles y acá se aplana.** `mapeo/chenson.json` traduce cada par padre/hijo del proveedor a uno o más slugs propios, y ahí es donde ocurre el achatamiento:

| Categoría del origen | Slugs propios |
|---|---|
| `MOCHILA` › `PORTA NOTEBOOK` | `mochilas`, `notebook` |
| `MOCHILA` › `PARA DAMA` | `mochilas`, `dama` |
| `CARTERA` › `DE FIESTA` | `carteras`, `fiesta` |
| `CARTERA` › `PARA TABLET` | `carteras` |
| `DISEÑOS INFANTILES` › `BARBIE` | `infantil`, `escolar` |

Un árbol propio sería menos expresivo: forzaría un único camino, y una mochila porta-notebook para dama tendría que elegir entre colgar de `dama` o de `notebook`. Aplanado pertenece a las tres.

Las sub-categorías del origen que no aportan un eje nuevo (`CARTERA` › `CARTERA`, `VALIJA` › `VALIJA`) colapsan al padre. Las vistas `/outlet` del origen se ignoran: son un filtro comercial del proveedor, no una categoría.

Consecuencias:

- `categorias.json` no tiene campo `padre` y no hay validación de ciclos.
- La navegación es **una sola fila de chips**, ordenada por `orden`, filtrando `activa: false`. Sin desplegables.
- **El breadcrumb usa `categorias[0]`**: `Home › {categoria[0].nombre} › {producto.nombre}`. El orden del array lo fija el importador desde `mapeo/{proveedor}.json`, así que la categoría principal de cada producto es una decisión de curaduría, no del azar.

### 4.4 `src/data/productos.json`

```json
[
  {
    "id": "cartera-de-fiesta-con-strass",
    "nombre": "Cartera de fiesta con strass",
    "descripcion": "Cartera de mano rígida con aplicación de strass y cadena desmontable.",
    "categorias": ["carteras", "fiesta"],
    "precio": 195000,
    "variantes": [
      {
        "sku": "CG85527-E",
        "color": "Crema",
        "colorHex": "#EFE3CE",
        "imagenes": ["catalogo/88f2fdd905e2010e/w600.webp"]
      },
      {
        "sku": "CG85527-3",
        "color": "Negro",
        "colorHex": "#1A1A1A",
        "imagenes": ["catalogo/c791d42bad0d298b/w600.webp"]
      },
      {
        "sku": "CG85527-P",
        "color": "Rosado",
        "colorHex": "#E8A0A8",
        "imagenes": [
          "catalogo/9dadecbc3b4c69f4/w600.webp",
          "catalogo/295134cac99c4701/w600.webp"
        ]
      }
    ],
    "actualizado": "2026-07-31",
    "origen": { "proveedor": "chenson", "ref": "CG85527" }
  },
  {
    "id": "mochila-urbana-lisa-18",
    "nombre": "Mochila urbana lisa 18\"",
    "categorias": ["mochilas", "notebook", "escolar"],
    "precio": 285000,
    "variantes": [
      {
        "sku": "CG84102-A",
        "color": "Azul marino",
        "colorHex": "#2E3560",
        "imagenes": ["catalogo/11fe5e4a4cf0d8f0/w600.webp"]
      }
    ],
    "actualizado": "2026-07-31",
    "origen": { "proveedor": "chenson", "ref": "CG84102" }
  },
  {
    "id": "rinonera-deportiva-juvenil",
    "nombre": "Riñonera deportiva juvenil",
    "categorias": ["rinoneras"],
    "precio": null,
    "variantes": [
      {
        "sku": "CG83550-R",
        "color": "Rosa",
        "imagenes": []
      }
    ],
    "actualizado": "2026-07-31",
    "origen": { "proveedor": "chenson", "ref": "CG83550" }
  },
  {
    "id": "cg85900",
    "nombre": "CG85900",
    "categorias": ["bolsos"],
    "precio": null,
    "variantes": [
      {
        "sku": "CG85900-3",
        "color": "Negro",
        "colorHex": "#1A1A1A",
        "imagenes": ["catalogo/74bcedecd0bbaf7a/w600.webp"]
      }
    ],
    "activo": false,
    "actualizado": "2026-07-31",
    "origen": { "proveedor": "chenson", "ref": "CG85900" }
  }
]
```

Los cuatro casos son intencionales:

1. **`CG85527`** — el modelo completo del origen, con sus 3 colores en orden alfabético (`Crema`, `Negro`, `Rosado`) y una variante con 2 imágenes.
2. **`CG84102`** — un solo color, y 3 categorías por el aplanado de §4.3.
3. **`CG83550`** — `precio: null`, `imagenes: []` y variante sin `colorHex`: ejercita las tres rutas de fallback (§5.4, §7.3, §4.2).
4. **`CG85900`** — sin entrada en el overlay: `activo: false`, `nombre` igual al código como marcador. Imágenes ya procesadas y subidas, esperando curaduría (§6.6).

### 4.5 `src/data/pedidos-especiales.json`

Artículos que se venden **por cantidad**, con precio negociado caso por caso: pedidos de colegios, instituciones y empresas.

```json
[
  {
    "id": "mochilas-escolares-por-cantidad",
    "nombre": "Mochilas escolares por cantidad",
    "descripcion": "Cantidad mínima: 12 unidades.
Surtido de modelos y colores a elección.",
    "imagen": { "base": "catalogo/e5469209224bdfb3", "anchos": [300, 600] },
    "orden": 10
  }
]
```

| Campo | Obligatorio | Por qué |
|---|---|---|
| `nombre` | sí | Título de la tarjeta y de la ficha |
| `descripcion` | **sí** | Es el contenido de la ficha. Ver la asimetría abajo |
| `imagen` | sí | Una sola: no hay colores que elegir |
| `orden` | no (def. `999`) | Curaduría, mismo criterio que `categorias.json` (§4.3) |

**No hay `activo`, al revés que en un producto.** Lo que está cargado está publicado. Son unas pocas fichas manejadas a mano y la que no va se borra: no hay volumen que justifique una papelera ni un estado intermedio, y un flag para un caso que no existe es una condición que arrastran todas las consultas y todas las pantallas.

#### Por qué es una colección aparte y no un flag sobre `productos`

El diseño anterior era un booleano `destacado` en el producto, y la home mostraba los marcados. Se reemplazó por tres motivos, en orden de peso:

1. **La forma no entra.** Un producto exige `variantes` con `sku` y `color` (`min(1)`, §4.1), y el volcado corta si faltan. Un artículo por cantidad no tiene ninguno de los dos: meterlo en `productos` obliga a inventar un SKU y un color falsos por cada entrada.
2. **No tiene precio de lista.** Es lo que define a la sección, y `precio` es un campo del producto que la ficha renderiza.
3. **La curaduría dependía del inventario.** Un `destacado` sobre un producto que se desactiva o que el proveedor deja de publicar desaparece de la portada sin aviso. Se comprobó en producción: 3 de 7 destacados estaban marcados con `activo: false`, o sea marcados e invisibles.

#### `descripcion` es obligatoria acá y opcional en `productos`

La asimetría es deliberada. Una ficha de producto se sostiene sin descripción: tiene precio, código, colores, marca y migas. Acá no hay nada de eso — **la descripción ES la ficha**. Sin ella, entrar al detalle es un clic hacia la misma foto que ya estaba en la tarjeta.

`z.string().min(1)` lo corta en `astro build` nombrando la entrada, en vez de dejarlo a la memoria de quien carga.

#### Texto libre y no campos estructurados

`descripcion` absorbe cantidad mínima, plazos, materiales y condiciones, con saltos de línea (se renderiza con `whitespace-pre-line`, igual que la ficha de producto). **No** hay un `cantidadMinima: number`: la primera entrada real dice «12 unidades por color» o «a partir de media docena», y ningún entero aguanta eso. Se estructura después de cargar unas cuantas y ver qué se repite.

#### Se carga desde el admin

Nació mantenido a mano como `categorias.json` (§4.3), y desde la migración `0006` sale del volcado igual que `productos.json` (§4.4): vive en la tabla `pedidos_especiales` de D1 y se edita en `/pedidos-especiales` del admin (SPEC-etapa2 §10.6). El motivo del cambio es que el admin corre en Cloudflare y no tiene filesystem, así que no puede editar un archivo del repo. Las imágenes usan el mismo pipeline que las de producto y se referencian por su clave direccionada por contenido (§5.1).

#### La columna `destacado` de D1 queda congelada

**No se bajó con una migración** — es irreversible y el dato no molesta. Lo que se sacó es la **ruta de escritura** entera: el checkbox de la grilla, el `UPDATE` de `guardar.ts`, el alta manual, el regex de campos de fila y el `SELECT` del volcado.

Sacar la escritura y no sólo el control es lo que la congela de verdad. Ocultar el checkbox dejándolo en el formulario habría hecho lo contrario: un checkbox que no se rinde no viaja en el POST, la página traduce esa ausencia a `false` (es el mecanismo que permitía **bajar** un producto de la portada), y el primer guardado de la grilla habría apagado en silencio todo lo marcado. Hay tests que defienden esto en `guardar.test.ts`, `grilla.test.ts` y `registrar.test.ts`.

---

## 5. Contrato de imágenes

### 5.1 Convención de nombres en R2

Direccionado por contenido:

```
catalogo/{hash16}/w{ancho}.webp
```

- `hash16` = primeros 16 hex del SHA-256 del **archivo original**.
- `ancho` ∈ `{300, 600}`.

Ejemplo: `catalogo/9f2a1c4be7d80315/w300.webp`

Motivos:

1. **Dedupe gratis.** Los proveedores repiten la misma foto en varios SKU. Mismo contenido ⇒ misma clave ⇒ una sola subida.
2. **Inmutable.** La clave nunca cambia de contenido: se sirve con `Cache-Control: public, max-age=31536000, immutable`.
3. **Recategorizar o renombrar un producto no toca ninguna imagen.** Coherente con las rutas planas.

Los productos referencian la clave completa. La URL final es `${PUBLIC_R2_BASE}/${clave}`.

### 5.2 Variantes de tamaño

El origen es 600 × 600 (§2.2-3). **Todo tamaño por encima de 600 es upscaling y no se genera.**

| Nombre | Píxeles | Uso | Display CSS |
|---|---|---|---|
| `w300` | 300 × 300 | Card de grilla, thumbnails de galería | 150–300 px |
| `w600` | 600 × 600 | Imagen principal de la ficha | hasta 600 px |

`srcset` de la card: `w300 300w, w600 600w` con `sizes="(min-width:1024px) 280px, (min-width:640px) 45vw, 90vw"`. Da 2× real en la card.

**La ficha se sirve a 1× y no tiene zoom.** 600 px es el techo del origen. Se documenta como limitación en vez de disimularse con un lightbox que ampliaría una imagen blanda.

Formato `.webp`, calidad 82, generado **antes** de subir. `astro:assets` no interviene: las imágenes de R2 se renderizan con `<img>` plano, sin `image.domains` ni `image.remotePatterns`.

### 5.3 Aspect ratio unificado: 1:1

El set de origen ya es 1:1 de lienzo (§2.2-1), así que 1:1 no cuesta nada. Un 4:5 o 3:2 obligaría a recortar o a poner barras, sin ganancia.

- Contenedor: `aspect-ratio: 1/1`, fondo `--color-superficie #FFFFFF`.
- `object-fit: contain`. **No `cover`:** con sujetos de AR 0.885 a 2.154, `cover` recortaría los lados de la riñonera (2.154) y de la cartera de mano (1.728).
- `<img>` con `width="600" height="600"` explícitos para reservar el espacio y evitar CLS.

**Origen que no sea 1:1:** el importador lo lleva a 1:1 **añadiendo relleno blanco `#FFFFFF`**, nunca recortando (§6.10). Blanco porque coincide con el fondo real de las fotos y con `--color-superficie`: el relleno es invisible.

**Varianza que 1:1 no resuelve — y que se acepta.** La ocupación del sujeto va de 27.4 % a 49.4 %: en la grilla, la cartera de mano se ve notablemente más chica que la mochila aunque el lienzo sea idéntico.

Corregirlo requeriría recortar el blanco y re-encuadrar al sujeto, y eso **está descartado**: el recorte al bbox quitaría la marca de agua en los productos de sujeto bajo y la dejaría en los de sujeto alto (§2.2-6), produciendo un catálogo más inconsistente que el actual. Como la marca de agua se publica tal cual (§5.6), el re-encuadre no es una opción.

La card queda uniforme; lo que varía es el tamaño aparente del producto dentro de ella. Es el aspecto normal de un catálogo armado sobre fotos de proveedor, y no se disimula.

### 5.4 Producto sin foto

`variantes[].imagenes` vacío ⇒ **nunca un `<img>` roto**.

Se renderiza `<SinFoto />`: `div` con `aspect-ratio: 1/1`, fondo `--color-fondo`, borde `1px dashed --color-borde`, y centrado el monograma del logo en SVG monocromo al 32 % del ancho con `opacity: .25`, más el texto "Sin imagen" en `--color-texto-suave` (6.65:1, AA ✅).

- El SVG es **local** (`src/assets/`), no de R2: el fallback no debe depender de la red para dibujarse.
- `role="img"` con `aria-label="Producto sin imagen disponible"`.
- Hasta que exista el SVG monocromático, `<SinFoto />` muestra solo el texto. **No se usa el PNG del logo:** 910 KB en origen para un placeholder es peor que nada, y el monograma solo no se puede aislar de un PNG.
- El producto **sigue visible y contactable**. Que no haya foto no lo saca del catálogo.

### 5.5 Resolución insuficiente

La regla se ancla en **nunca ampliar**: un tamaño se genera solo si el origen lo soporta.

| Lado mayor del origen | Se genera | Efecto en el sitio |
|---|---|---|
| ≥ 600 px | `w300` + `w600` | Caso normal. Card a 2×, ficha a 1× |
| 300–599 px | **solo `w300`** | La ficha cae a `w300`. Se ve blanda pero se ve |
| < 300 px | **nada** ⇒ `imagenes: []` | Placeholder (§5.4). Ningún tamaño se sostiene sin ampliar |

Ampliar un `w300` desde un origen de 200 px sería inventar píxeles, así que por debajo de 300 el placeholder es más honesto que una foto reventada.

El importador emite aviso por consola y una línea en el reporte (§6.5) con el SKU y las dimensiones halladas. **No falla el build:** un producto con foto mala es peor que un producto sin foto, pero mucho mejor que un deploy bloqueado.

`srcSetR2()` (§8, `src/lib/imagenes.ts`) emite en el `srcset` únicamente los tamaños que existen, así que un origen de 400 px no produce un `<img>` apuntando a un `w600` inexistente.

Con el set de origen actual este caso no se da: las 7 son 600 × 600.

### 5.6 Marca de agua

Las fotos de origen traen impreso `www.chenson.com.py®` (§2.2-5) y **se publican tal cual**.

- El importador **no** tiene etapa de marca de agua: no la borra, no la tapa, no la reemplaza.
- No se recorta la banda inferior: en 4 de 7 el producto ocupa esas filas y recortarla lo amputa (§2.2-6).
- Tampoco se re-encuadra al bbox del sujeto, por la misma razón (§5.3).

Consecuencia asumida: cada foto del catálogo muestra el dominio del proveedor. Es una decisión tomada, no un pendiente.

---

## 6. Ingesta de datos

Pieza **separada del sitio**. No corre en el build, no se despliega, no comparte código de runtime con `src/`. Se ejecuta a mano.

### 6.1 Dos etapas, dos binarios

El catálogo se obtiene raspando el sitio del proveedor. Esa operación es de red, frágil y no determinista; la generación de `productos.json` tiene que ser determinista e idempotente (§6.7). **Son responsabilidades opuestas y no comparten proceso.**

```
# Etapa 1 — red. Toca internet, no toca src/
node scripts/scrape/index.mjs --proveedor chenson [--limite N] [--reanudar]

# Etapa 2 — transformación. Toca src/ y R2, no toca el sitio del proveedor
node scripts/import/index.mjs --proveedor chenson [--crudo <ruta>] [--dry-run] [--solo-json]
```

**`--crudo` es opcional: por defecto toma el `crudo-*.json` más reciente de `entrada/`.**
El flujo normal es scrape → import, así que obligar a tipear la fecha del archivo en cada
corrida es fricción sin ganancia. Se pasa explícito solo para reprocesar una captura vieja.
Si `entrada/` está vacío, el importador aborta indicando que hay que correr la etapa 1.

| | Etapa 1 · `scrape` | Etapa 2 · `import` |
|---|---|---|
| Entrada | El sitio del proveedor | `crudo-{fecha}.json` + caché de imágenes |
| Salida | `crudo-{fecha}.json` + imágenes en caché local | `productos.json`, objetos en R2, `manifest.json`, reporte |
| Red | Sí, al proveedor | Solo subida a R2 |
| Determinista | No | **Sí** |
| Escribe en `src/` | Nunca | Sí |

Lo que gana esta separación:

1. **Re-correr el import no vuelve a golpear el sitio del proveedor.** Se itera sobre el mapeo y la normalización todas las veces que haga falta, gratis y offline.
2. **Un scrape fallido nunca deja `productos.json` a medio escribir.** Si la etapa 1 se corta, no hay etapa 2.
3. **El test de idempotencia corre offline** contra un `crudo-*.json` fijo como fixture.
4. **El scrape es auditable.** Queda el archivo exacto del que salió cada build.

### 6.2 Etapa 1 — `scrape`

Salida: `scripts/import/entrada/crudo-{fecha}.json`, más las imágenes originales en `scripts/import/cache/{hash16}.{ext}`.

Reglas de operación:

- **Consultar `robots.txt` del proveedor antes de empezar** y respetar sus exclusiones. Si una ruta está excluida, no se raspa.
- **Rate limit de 1 request por segundo**, secuencial, sin concurrencia. Un catálogo de 1.500 productos tarda ~25 minutos y eso está bien: se corre una vez cada dos o tres meses (§7.3).
- **User-Agent identificable**, no uno falseado de navegador.
- **Caché en disco por URL.** Una imagen ya descargada no se vuelve a pedir. Con `--reanudar`, un scrape cortado sigue donde quedó en vez de empezar de cero.
- **Fallo tolerante:** un producto que no se pudo leer se registra en el `crudo` con `error` y no aborta la corrida. La etapa 2 lo saltea y lo lista en el reporte.
- `--limite N` corta a N productos, para probar sin bajar el catálogo entero.

`entrada/` y `cache/` están gitignorados: son insumos regenerables, no fuente de verdad. La reproducibilidad la dan `productos.json` y `manifest.json`, que sí se comitean.

### 6.3 Formato intermedio — `crudo-{fecha}.json`

Contrato entre las dos etapas. Refleja lo que el sitio de origen ofrece, **sin normalizar**: ningún slug, ninguna categoría traducida, ningún prefijo de color descartado. Eso es trabajo de la etapa 2.

La unidad del `crudo` es el **modelo**, no la página: la etapa 1 ya resuelve los colores hermanos leyendo el bloque `#other-colors-tbl` de una sola ficha (§2.3).

```json
{
  "proveedor": "chenson",
  "capturadoEn": "2026-07-31T14:02:11Z",
  "base": "https://www.chenson.com.py",
  "modelos": [
    {
      "codigo": "CG85527",
      "categoriaOrigen": { "padre": "CARTERA", "hijo": "DE FIESTA" },
      "colores": [
        {
          "idColor": "71010",
          "url": "/producto/71010-cg85527",
          "colorOrigen": "(P) ROSADO",
          "imagenes": ["9dadecbc3b4c69f4….jpg", "295134cac99c4701….jpg"]
        },
        {
          "idColor": "70873",
          "url": "/producto/70873-cg85527",
          "colorOrigen": "(3) NEGRO",
          "imagenes": ["c791d42bad0d298b….jpg"]
        },
        {
          "idColor": "70931",
          "url": "/producto/70931-cg85527",
          "colorOrigen": "(E) CREMA",
          "imagenes": ["88f2fdd905e2010e….jpg"]
        }
      ]
    }
  ],
  "errores": [
    { "url": "/producto/70999-cg85999", "motivo": "HTTP 404" }
  ]
}
```

- `codigo` es el identificador estable del modelo y alimenta `origen.ref` (§6.7). Sale del segmento de URL, que es lo más estable que expone el sitio.
- **No hay `titulo`, `descripcion` ni `precioTexto`**: el origen no los tiene (§2.3). Entran por el overlay (§6.6).
- `imagenes` son nombres de archivo dentro de `cache/`, no URLs: la etapa 2 no sale a internet a buscar imágenes.
- `colorOrigen` va literal, con el prefijo `(X)`. La etapa 2 lo descarta.
- El orden de `colores` es el del sitio y **no se toma como curaduría**: la etapa 2 lo fija con la columna `orden`, que no se vuelve a pisar (§6.6).

### 6.4 Etapa 2 — entradas

| Entrada | Origen | Nota |
|---|---|---|
| `crudo-{fecha}.json` | Etapa 1 | Estructura, colores, categorías e imágenes. Contrato de §6.3 |
| `cache/{hash16}.{ext}` | Etapa 1 | Imágenes originales |
| **`overlay/{proveedor}.json`** | **Escrito a mano** | **`nombre`, `precio` y `descripcion` por código de modelo (§6.6)** |
| `mapeo/{proveedor}.json` | Escrito a mano | Traduce categorías del proveedor a slugs propios, y diccionario de colores → hex |
| `manifest.json` | Corridas previas | Estado para idempotencia y dedupe |
| `src/data/productos.json` | Corrida anterior | Se lee para hacer merge, no se sobreescribe a ciegas |

### 6.5 Salidas

| Salida | Descripción |
|---|---|
| `src/data/productos.json` | Reescrito completo, claves ordenadas alfabéticamente, productos ordenados por `id`. **Determinista**: misma entrada ⇒ byte-idéntico, para que el diff de git sea legible |
| Objetos en R2 | `catalogo/{hash16}/w{300,600}.webp`, solo lo nuevo |
| `scripts/import/manifest.json` | `{ hashOriginal: { claves, subidoEn, ancho, alto } }` + `{ "{proveedor}:{ref}": "id" }` |
| `scripts/import/reporte-{fecha}.md` | Altas, bajas, cambios de precio, imágenes reusadas, avisos de resolución, **productos huérfanos**, **`SIN CURAR`** (modelos sin overlay, §6.6), colores sin hex, categorías sin mapear, y aviso si la corrida anterior tiene más de 90 días (§7.3) |

`--dry-run` produce el reporte y nada más: no escribe JSON ni sube a R2.

### 6.6 Join con el overlay

El origen aporta estructura; el overlay aporta lo comercial (§2.3). La etapa 2 los une por **código de modelo**.

#### `overlay/chenson.json`

Escrito a mano. Es el único archivo que se edita producto por producto, y es la cola de trabajo del administrador.

```json
{
  "CG85527": {
    "nombre": "Cartera de fiesta con strass",
    "precio": 195000,
    "descripcion": "Cartera de mano rígida con aplicación de strass y cadena desmontable."
  },
  "CG84102": {
    "nombre": "Mochila urbana lisa 18\"",
    "precio": 285000
  },
  "CG83550": {
    "nombre": "Riñonera deportiva juvenil"
  }
}
```

La clave es el código de modelo porque **nombre y precio son del modelo, no del color**: las variantes comparten precio (§4.2) y comparten nombre por definición.

| Campo del overlay | Obligatorio | Efecto |
|---|---|---|
| `nombre` | **Sí** | Sin él el producto no se publica (ver abajo) |
| `precio` | No | Ausente ⇒ `precio: null` ⇒ "Consultar precio" y sin bloque `offers` (§7.3) |
| `descripcion` | No | Ausente ⇒ el campo se omite |

#### Regla de publicación

**Un modelo sin entrada en el overlay, o con entrada sin `nombre`, se importa con `activo: false`.**

- Entra a `productos.json` con todos sus colores e imágenes ya procesados y subidos a R2: el trabajo mecánico queda hecho.
- No se renderiza en ninguna vista, no entra al sitemap, no entra al índice de búsqueda.
- El reporte lo lista bajo `SIN CURAR`, con el código y la categoría de origen, para que el administrador sepa exactamente qué le falta escribir.
- En cuanto se le agrega `nombre` al overlay, la siguiente corrida lo activa sin volver a tocar imágenes ni R2.

Así el catálogo público solo muestra productos curados, y el trabajo pendiente es visible y acotado en vez de silencioso.

`activo` sigue sin ser sobreescrito cuando ya vale `false` por decisión manual (§6.9): el importador solo lo baja por falta de curaduría, nunca lo sube pisando una ocultación deliberada.

#### Normalización de colores — `mapeo/chenson.json`

```json
{
  "colores": {
    "(P) ROSADO": { "nombre": "Rosado",     "hex": "#E8A0A8" },
    "(3) NEGRO":  { "nombre": "Negro",      "hex": "#1A1A1A" },
    "(E) CREMA":  { "nombre": "Crema",      "hex": "#EFE3CE" },
    "(A) AZUL":   { "nombre": "Azul marino","hex": "#2E3560" }
  },
  "categorias": {
    "MOCHILA|PORTA NOTEBOOK":     ["mochilas", "notebook"],
    "MOCHILA|PARA DAMA":          ["mochilas", "dama"],
    "CARTERA|DE FIESTA":          ["carteras", "fiesta"],
    "CARTERA|CARTERA":            ["carteras"],
    "DISEÑOS INFANTILES|BARBIE":  ["infantil", "escolar"]
  }
}
```

**Reglas duras:**

- **`sku` = `{codigo}-{codigoColor}`**, tomando el `codigoColor` del prefijo `(X)` del origen: `CG85527-P`, `CG85527-3`, `CG85527-E`. Es estable y semántico. Si un color viene sin prefijo, el `sku` cae a `{codigo}-{slug(color)}`. **Nunca un índice posicional:** si el proveedor agrega un color, los SKU existentes no se mueven.
- **No se usa el `idColor`** (`71010`) en el `sku`: es un autoincremental de la base del proveedor y puede cambiar si recrean el registro.
- **El orden de las variantes lo fija una columna `orden` que es curaduría**, no el del sitio, y el `color` normalizado sirve solo de desempate. Lo que la idempotencia (§6.7) necesita es que el orden sea **estable**, y una columna guardada lo es; lo inestable era el orden en que el proveedor devuelve los colores. **Esta regla la reemplazó `SPEC-etapa2.md` §5.5:** antes era alfabético puro, y eso hacía que el color mostrado por defecto en cada ficha lo decidiera el abecedario en vez de una decisión comercial.
- **`orden` entra en la lista de campos que la importación NUNCA sobreescribe**, con `activo` (§6.4). Si un re-scrape lo pisara con el orden del proveedor, los colores se moverían solos y volvería justo la inestabilidad que la regla alfabética evitaba.
- Un `colorOrigen` que no esté en el diccionario genera la variante con el nombre limpiado del prefijo y **sin** `colorHex`: el selector cae a botón con texto (§4.2) y el reporte lo lista. **No inventa un hex.**
- Un par `padre|hijo` que no esté en `categorias` cae al slug del padre si existe; si tampoco, el modelo queda `activo: false` y se lista en el reporte. Un producto sin categoría es inalcanzable (§4.2), así que no se publica a medias.

### 6.7 Idempotencia

Correrlo dos veces con la misma entrada **no produce ningún cambio**. Verificable con `git diff --exit-code src/data/productos.json`.

1. **Identidad del producto = `origen.proveedor` + `origen.ref`.** No el nombre (cambia), no el slug (se deriva del nombre), no el precio.
2. `manifest.json` mapea `{proveedor}:{ref}` → `id` ya asignado. Un producto ya visto **reusa su `id`** aunque el proveedor le haya cambiado el nombre: la URL sobrevive.
3. El `id` se genera solo en el alta: slug del nombre, sin tildes ni eñes; ante colisión, sufijo `-2`, `-3`.
4. Salida ordenada y estable (claves y arrays) para que no haya diff espurio.
5. Las subidas a R2 se saltean si el `hash16` ya está en el manifest.

### 6.8 Deduplicación de imágenes

1. Descargar o leer el original.
2. **SHA-256 del byte stream original.** `hash16` = primeros 16 hex.
3. Si `hash16` está en el manifest ⇒ no se procesa ni se sube; se reusan las claves existentes.
4. Si no está ⇒ generar `w300` y `w600`, subir, registrar en el manifest.

El hash se calcula sobre los bytes, nunca se infiere del nombre de archivo (§2.2-7).

**Limitación:** deduplica archivos **byte-idénticos**. Dos JPEG visualmente iguales recomprimidos distinto dan hashes distintos y se suben dos veces. Un hash perceptual lo resolvería; queda fuera de alcance (§10) porque el costo de R2 no lo justifica en este volumen.

### 6.9 Producto existente que cambió de precio

El precio **se actualiza sin preguntar**, y queda registrado:

1. Se compara el `precio` nuevo contra el del `productos.json` actual.
2. Si difiere: se escribe el nuevo, `actualizado` pasa a la fecha de la corrida, y el reporte suma la línea `SKU · nombre · 285.000 → 310.000 (+8.8 %)`.
3. Si la variación supera el **±25 %**, se marca `⚠ REVISAR` y el proceso **termina con exit code 2**. No bloquea la escritura, pero rompe cualquier automatización que lo encadene: a esta escala un salto así suele ser un dígito de más tipeado en el overlay, no un aumento real.
4. Si el precio desaparece del overlay y antes había uno válido: **se conserva el anterior** y se avisa. Borrar una línea del overlay por accidente no debe vaciar un precio en producción.

Otros campos, todos provenientes del overlay (§6.6): `nombre` y `descripcion` se sobreescriben. `categorias` vienen del mapeo y se sobreescriben **solo si** resuelve todas; si alguna no resuelve, se conservan las anteriores y se avisa. `activo` **nunca se sube pisando una ocultación manual**: el importador solo lo baja por falta de curaduría (§6.6).

**Producto huérfano** (ya no está en el catálogo del proveedor): no se borra. Pasa a `activo: false` y se lista en el reporte. Borrar mata la URL y su indexación.

### 6.10 Normalización de aspect ratio

Una sola operación cubre todos los casos: **encajar dentro del cuadrado rellenando con blanco**, nunca recortando (§5.3).

```js
sharp(origen)
  .resize(lado, lado, {
    fit: 'contain',              // encaja dentro, NO recorta
    background: '#ffffff',       // el relleno coincide con el fondo real
    withoutEnlargement: true,    // nunca amplía
  })
  .webp({ quality: 82 })
```

- Un origen 1:1 (las 7 muestras) simplemente se redimensiona: el relleno es de 0 px.
- El de 601 × 600 sale 600 × 600 con 1 px de relleno, imperceptible y sobre blanco.
- Un origen 300 × 600 sale con barras blancas laterales. Invisibles: coinciden con `--color-superficie` y con el fondo de la foto.
- `withoutEnlargement` es lo que hace cumplir la tabla de §5.5 sin lógica aparte.

No hay dos ramas según el aspect ratio: `fit: 'contain'` ya es el caso general, y tratar el 1:1 como excepción sería complejidad sin ganancia.

Eso es todo: **no hay etapa de recorte ni de re-encuadre.** El importador redimensiona y, si hace falta, rellena. Nunca quita píxeles. La varianza de ocupación del sujeto se acepta (§5.3) porque cualquier recorte alteraría la marca de agua de forma inconsistente entre productos (§5.6).

El bbox del sujeto **sí se calcula** — umbral de tinta `cualquier canal < 235`, con el umbral por debajo de 255 para tolerar los fondos a `253,253,253` (§2.2-2) — pero solo para el reporte: sirve para detectar fotos donde el producto es anormalmente chico y revisarlas a mano. No modifica la imagen.

### 6.11 Fixtures

`samples/` es el set de fixtures. Los 7 archivos cubren:

| Caso | Fixture |
|---|---|
| Lienzo no cuadrado por 1 px | `11fe5e4a4c…` (601 × 600) → debe salir 600 × 600 sin relleno |
| Sujeto muy ancho | `96d5e5aaf7…` (AR 2.154) → `contain` sin recorte |
| Sujeto casi cuadrado | `74bcedecd0…` (AR 1.026) |
| Ocupación mínima | `652aee20ea…` (27.4 %) |
| Ocupación máxima | `9dadecbc3b…` (49.4 %) |
| Fondo no exactamente blanco | `9dadecbc3b…` (esquinas `253,253,253`) |
| Marca de agua sobre el producto | `782ab38cbd…` (producto hasta y≈570) |

- **Dedupe:** duplicar un fixture con otro nombre ⇒ una sola subida.
- **Idempotencia:** dos corridas seguidas ⇒ `git diff --exit-code` limpio.

Son descartables: cuando llegue el catálogo real se reemplazan y los tests se re-anclan.

---

## 7. SEO

### 7.1 Canonical

`trailingSlash: 'never'` y `build.format: 'file'`, para que haya **una sola** forma canónica de cada URL. Con los defaults (`'ignore'` + `'directory'`), `/productos/x` y `/productos/x/` responden ambas y compiten por la indexación.

**El canonical NO se construye con `Astro.url.pathname` directo.** Con `build.format: 'file'`, `Astro.url.pathname` devuelve el path del **archivo generado**, no la URL pública:

| Ruta | `Astro.url.pathname` en build | Canónica correcta |
|---|---|---|
| Home | `/index.html` | `/` |
| Ficha | `/productos/x.html` | `/productos/x` |
| Listado pág. 2 | `/categorias/mochilas/2.html` | `/categorias/mochilas/2` |

El patrón `new URL(Astro.url.pathname, Astro.site)` que aparece en la documentación de Astro asume `build.format: 'directory'`. Con `'file'` publicaría `…/index.html` como canónica de la home.

Se normaliza en `src/lib/seo.ts`:

```ts
export function rutaCanonica(pathname: string): string {
  let ruta = pathname.replace(/\.html$/, '');   // ancla $: no toca "mochila-18.5"
  ruta = ruta.replace(/\/index$/, '');          // barra previa: no toca "indexado"
  if (ruta.length > 1 && ruta.endsWith('/')) ruta = ruta.slice(0, -1);
  return ruta === '' ? '/' : ruta;
}

export function urlCanonica(pathname: string, site: URL | undefined): URL {
  if (!site) throw new Error('Astro.site es undefined…');
  return new URL(rutaCanonica(pathname), site);
}
```

En dev el pathname ya viene sin extensión, así que la función es **idempotente** y da el mismo resultado en ambos modos. Sin eso, el canonical diferiría entre `astro dev` y el sitio desplegado.

Los dos anclajes de las regex son deliberados y están cubiertos por test: `\.html$` no toca un punto interno del slug (`mochila-18.5`), y `\/index$` exige la barra previa para no comerse un slug que empiece con `index` (`indexado`, `index-glass`).

`Astro.site` es `URL | undefined` y sale de `site` en la config, que viene de `SITE_URL`. Si `SITE_URL` falta, `Astro.site` queda `undefined` y el canonical se rompe en silencio: **la config lanza excepción si `SITE_URL` no está definida** (§9.1). `urlCanonica` vuelve a chequearlo, porque a esa altura un `undefined` solo puede venir de un error de programación.

Las variantes **no** generan URL propia. Un `?variante=` no cambia el canonical: siempre apunta a `/productos/[slug]` limpio.

Los listados paginados llevan **canonical propio por página** (§9.5): la página 2 no canonicaliza a la 1.

### 7.2 `noindex`, controlado por flag

Nació para tapar el `.workers.dev`. **Hoy `INDEXABLE` está en `true`** en producción, porque el sitio ya vive en el dominio propio (§1.4); lo que sigue describe el mecanismo, que no cambió y sigue gobernando el `noindex` en cualquier despliegue que no sea el de producción.

Controlado por un flag **explícito**, no inferido del hostname:

```astro
{ !INDEXABLE && <meta name="robots" content="noindex, nofollow" /> }
```

`INDEXABLE` es `envField.boolean({ context:'server', access:'public', default:false })`. **El default es `false`**: si alguien olvida configurarlo, el sitio queda fuera del índice. La falla segura es no indexar, no indexar por accidente un subdominio de pruebas.

`src/pages/robots.txt.ts` emite `Disallow: /` mientras `INDEXABLE` sea falso; `Allow: /` más la línea `Sitemap:` cuando sea verdadero.

### 7.3 Precios: se publican

Google exige al menos uno de `review`, `aggregateRating` u `offers` en `Product`. Este negocio no tiene reseñas ni ratings — no hay cuentas de usuario — así que `offers` es la única vía a un `Product` válido, y `offers` exige `price`. **Sin precio no se pierde la línea del precio en el resultado: se pierde el rich result completo.**

El objetivo del sitio apunta en la misma dirección: se busca que el cliente contacte con intención. Sin precio, la mayoría de los mensajes será "¿cuánto sale?", y eso vacía de sentido el mensaje pre-armado.

Riesgos aceptados y sus mitigaciones:

| Riesgo | Mitigación |
|---|---|
| El sitio es estático: el precio solo cambia al rebuild | Rebuild y deploy tras cada edición del overlay. El precio lo controlás vos, no el proveedor, así que el disparador es tu propia revisión de márgenes |
| Precio desactualizado indexado | `priceValidUntil` a 90 días de `actualizado` (ver abajo), y en la ficha la leyenda "Precio de referencia — confirmalo por WhatsApp" junto al monto |
| La competencia scrapea los precios de un JSON estático | Aceptado. En un catálogo público el precio es público por definición; ofuscarlo solo rompe el SEO que se busca |

**`priceValidUntil` = `actualizado` + 90 días.** Los precios del catálogo se sostienen entre 2 y 3 meses, y el valor tiene que **cubrir** ese intervalo, no quedar por debajo: un `priceValidUntil` ya vencido hace que Google descarte el precio del rich result aunque el monto siga siendo correcto. Poner 30 días lo dejaría expirado durante la mayor parte de la vida útil del precio.

El importador emite un aviso en el reporte si `productos.json` tiene más de 90 días sin correr: llegado ese punto, los `priceValidUntil` empiezan a vencer y hay que re-importar aunque el proveedor no haya mandado lista nueva.

No hace falta un estado "precio a confirmar" separado de `precio: null`: con esta cadencia, un precio escrito es un precio firme.

**El precio no viene del origen.** El sitio del proveedor no publica precios (§2.3), así que el único aporte es el overlay (§6.6). La cobertura de rich results es entonces exactamente la cobertura de precios del overlay: conviene priorizar la carga de `precio` en los productos que interesa posicionar, antes que completar el overlay de forma pareja.

**Producto con `precio: null`:** se renderiza "Consultar precio" y **se omite el bloque `offers` por completo**. Sin `offers`, ese producto no lleva JSON-LD de `Product`, solo `BreadcrumbList`. Es el comportamiento correcto: mejor sin structured data que con un precio inventado. Un `price: 0` sería una mentira que Google interpreta como producto gratis.

### 7.4 Open Graph

En el `<head>` de todas las páginas: `og:type` (`website` en `/` y listados, `product` en la ficha), `og:title`, `og:description`, `og:url` (= canonical), `og:image`, `og:locale` `es_PY`, `og:site_name`. `twitter:card` = `summary_large_image`.

**`og:image` y las URLs de `image` del JSON-LD tienen que ser ABSOLUTAS.** WhatsApp, Facebook y Twitter no resuelven rutas relativas: una `og:image` relativa deja la vista previa sin imagen, que es exactamente lo que no puede fallar en un sitio cuyo objetivo es que compartan productos.

No alcanza con `urlImagen()`: con `PUBLIC_R2_BASE` relativo (`/img-dev` mientras no haya R2) devuelve una ruta relativa. Se usa `urlImagenAbsoluta()`, que resuelve contra `Astro.site` y deja intacta una base que ya sea absoluta. Cuando R2 esté configurado será un no-op, pero el contrato no puede depender de eso.

| Página | `og:image` |
|---|---|
| Ficha de producto | `urlImagenAbsoluta(variantes[0].imagenes[0], w600)`, con `og:image:width/height` `600`/`600` |
| Ficha sin foto | `og-image.png` genérico |
| Home y categorías | `og-image.png` genérico |

**Limitación:** las fotos de producto son 600 × 600 y el óptimo de OG es 1200 × 630. WhatsApp y Facebook las muestran más chicas, en cuadrado. Generar un 1200 × 630 por producto (foto centrada sobre fondo blanco, clave `catalogo/{hash16}/og.png`) es viable y va en Fase 2 como mejora, no como bloqueo.

### 7.5 JSON-LD

Una etiqueta `<script type="application/ld+json">` por página.

**Ficha de producto** (solo si `precio !== null`):

```json
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Mochila urbana lisa 18\"",
  "description": "Mochila de poliéster con bolsillo frontal…",
  "sku": "CH-MU18-AZU",
  "brand": { "@type": "Brand", "name": "Chenson" },
  "image": ["https://cdn.ejemplo/catalogo/9f2a1c4be7d80315/w600.webp"],
  "offers": {
    "@type": "Offer",
    "url": "https://ejemplo/productos/mochila-urbana-lisa-18",
    "priceCurrency": "PYG",
    "price": 285000,
    "priceValidUntil": "2026-10-26",
    "availability": "https://schema.org/InStoreOnly",
    "seller": { "@type": "Organization", "name": "YBE" }
  }
}
```

**`availability: InStoreOnly` es deliberado.** No hay stock en vivo, así que `InStock` sería una afirmación insostenible. `InStoreOnly` — "disponible solo en ubicaciones físicas" — describe exactamente este negocio: se compra por WhatsApp o en el local, no online.

`brand.name` sale de la constante `MARCA` de `src/lib/sitio.ts`, no de un campo del producto (§4.2). `seller.name` sale de `COMERCIO` en el mismo archivo.

`image` lleva la primera imagen de cada variante activa, en orden.

**Modelo de variantes: un solo `Product`.** Como todas las variantes comparten precio (§4.2), no hace falta `ProductGroup` + `hasVariant`: un único `Product` con el `sku` de la primera variante activa y un único `Offer` describe la oferta completa. Las demás variantes aportan sus imágenes al array `image`.

**Todas las páginas:** `BreadcrumbList` de dos o tres niveles según la ruta, siguiendo la regla de `categorias[0]` de §4.3:

| Ruta | Breadcrumb |
|---|---|
| `/` | — (no se emite) |
| `/categorias/[slug]` | Home › {categoria.nombre} |
| `/productos/[slug]` | Home › {categorias[0].nombre} › {producto.nombre} |

**Home:** `Organization` con `name` (= `COMERCIO`), `url`, `logo` y `sameAs`.

### 7.6 Sitemap

`@astrojs/sitemap`, condicionado a `INDEXABLE`. Excluye productos con `activo: false` y categorías con `activa: false`. Fase 2, junto con el dominio real.

---

## 8. Árbol de archivos

```
YBECatalogo/
├── astro.config.mjs                    Config: site desde SITE_URL, integración Preact, plugin @tailwindcss/vite, schema de astro:env
├── wrangler.jsonc                      Deploy a Cloudflare Workers: binding assets → ./dist, not_found_handling
├── package.json                        Dependencias y scripts (dev, build, import, deploy)
├── tsconfig.json                       Extiende astro/tsconfigs/strict; jsx react-jsx con jsxImportSource preact
├── .env.example                        Las 8 variables de §9.1; valores reales en las no secretas, R2_*_KEY en blanco
├── .gitignore                          dist, node_modules, .env, .astro, scripts/import/{entrada,cache}
├── README.md                           Cómo correr, importar y desplegar
│
├── docs/
│   └── SPEC.md                         Este documento
│
├── samples/                            7 JPEG de origen sin procesar; fixtures del importador. DESCARTABLES
│
├── public/
│   ├── favicon.ico                     Fase 2 — bloqueado por el logo (§3.5)
│   ├── apple-touch-icon.png            Fase 2 — bloqueado por el logo (§3.5)
│   └── og-image.png                    1200×630 genérico para home y páginas sin foto (§3.5)
│
├── scripts/
│   ├── assets/
│   │   └── generar-iconos.mjs          Deriva favicon/apple-touch/og desde el logo definitivo. Manual, no en build
│   │
│   ├── scrape/                         ETAPA 1 — red. Nunca escribe en src/ (§6.2)
│   │   ├── index.mjs                   Orquestador: recorre el catálogo, rate limit 1 req/s, --reanudar, --limite
│   │   ├── robots.mjs                  Lee y respeta el robots.txt del proveedor antes de pedir cualquier ruta
│   │   ├── fetch-cache.mjs             GET con caché en disco por URL; una URL ya bajada no se vuelve a pedir
│   │   ├── extraer.mjs                 Selectores del origen → codigo, colores hermanos (#other-colors-tbl), categoría, imágenes
│   │   └── salida.mjs                  Escribe entrada/crudo-{fecha}.json con el contrato de §6.3
│   │
│   └── import/                         ETAPA 2 — transformación determinista (§6.4)
│       ├── index.mjs                   Orquestador: parsea flags, encadena etapas, escribe reporte, fija exit code
│       ├── mapear.mjs                  Aplica mapeo/{proveedor}.json: categorías del proveedor → slugs propios
│       ├── overlay.mjs                 Join por código de modelo: nombre, precio, descripcion (§6.6)
│       ├── normalizar.mjs              Limpia prefijos (X) de color, arma sku, slugs, orden alfabético de variantes
│       ├── imagenes.mjs                Hash SHA-256, dedupe, resize a w300/w600, relleno a 1:1, avisos de resolución
│       ├── r2.mjs                      Cliente S3 de R2: subida condicional y Cache-Control immutable
│       ├── merge.mjs                   Fusiona con productos.json existente: reusa id, preserva curaduría, detecta huérfanos
│       ├── reporte.mjs                 Emite reporte-{fecha}.md: altas, bajas, deltas de precio, avisos
│       ├── manifest.json               Estado: hash → claves R2; proveedor:ref → id. COMITEADO
│       ├── overlay/
│       │   └── chenson.json            ESCRITO A MANO. nombre, precio y descripcion por código. COMITEADO
│       ├── mapeo/
│       │   └── chenson.json            Categorías del origen → slugs propios, y colores → nombre + hex
│       ├── entrada/                    crudo-{fecha}.json de la etapa 1. GITIGNORADO
│       ├── cache/                      Imágenes originales bajadas por la etapa 1. GITIGNORADO
│       └── __tests__/
│           ├── idempotencia.test.mjs   Dos corridas sobre el mismo crudo ⇒ productos.json byte-idéntico
│           ├── overlay.test.mjs        Modelo sin overlay ⇒ activo:false; con nombre ⇒ activo:true
│           ├── variantes.test.mjs      3 colores ⇒ sku CG85527-{P,3,E}, orden alfabético estable
│           ├── dedupe.test.mjs         Fixture duplicado ⇒ una sola subida
│           └── imagenes.test.mjs       Las 7 muestras ⇒ 600×600, sin recorte, avisos correctos
│
└── src/
    ├── content.config.ts               defineCollection de productos y categorias con loader file() y schemas Zod
    │
    ├── data/
    │   ├── productos.json              GENERADO por el importador. Nunca a mano
    │   └── categorias.json             ESCRITO A MANO. Orden y visibilidad de la navegación
    │
    ├── assets/
    │   ├── logo_plateado.png           1024×1024 RGBA. Alpha real, 910 KB. bbox medido -> Logo.astro (§2.1)
    │   └── monograma.svg               Fase 2 — monograma monocromo para el placeholder y el favicon. FALTA
    │
    ├── styles/
    │   └── global.css                  @import "tailwindcss" + @theme con los tokens de §3.1
    │
    ├── lib/
    │   ├── sitio.ts                    Constantes del comercio: COMERCIO ("YBE"), MARCA ("Chenson"), redes
    │   ├── precio.ts                   formatearGs() con Intl.NumberFormat('es-PY'); ejecuta en BUILD (§9.3)
    │   ├── whatsapp.ts                 construirEnlaceWa(): arma wa.me con nombre + URL canónica + variante
    │   ├── imagenes.ts                 urlR2(clave, ancho) y srcSetR2(clave); única fuente de las URLs de R2
    │   ├── productos.ts                Consultas: activos(), porCategoria(), resolverCategorias()
    │   ├── pedidos-especiales.ts       Consulta: pedidosEspeciales() sobre la colección homónima (§4.5)
    │   └── seo.ts                      Construye canonical, tags OG y los objetos JSON-LD
    │
    ├── layouts/
    │   └── Base.astro                  html/head/body, canonical, OG, noindex condicional, JSON-LD, importa global.css
    │
    ├── components/
    │   ├── Header.astro                Logo + wordmark de texto + nav de categorías (§3.4)
    │   ├── Footer.astro                Contacto, redes, aviso de precios de referencia
    │   ├── TarjetaProducto.astro       Card de grilla: caja 1:1, contain, nombre, precio, borde
    │   ├── GrillaProductos.astro       Grid responsive; recibe un array ya filtrado
    │   ├── ImagenProducto.astro        <img> a R2 con srcset y width/height; delega a SinFoto si no hay imagen
    │   ├── SinFoto.astro               Placeholder accesible para imagenes: [] (§5.4)
    │   ├── Precio.astro                Monto formateado, o "Consultar precio" si es null
    │   ├── BotonWhatsapp.astro         Enlace wa.me; el mensaje SIEMPRE lleva nombre + URL canónica
    │   ├── ChipCategoria.astro         Enlace a /categorias/[slug]
    │   └── islas/
    │       ├── SelectorVariante.tsx    Preact. Cambia color: imagen, SKU y mensaje de WhatsApp. client:visible
    │       └── Buscador.tsx            Preact. Fase 3. Consume /indice.json. client:idle
    │
    └── pages/
        ├── index.astro                 Home: categorías activas + pedidos especiales
        ├── productos/
        │   └── [slug].astro            Ficha. getStaticPaths desde la colección. Galería, selector, WhatsApp, JSON-LD
        ├── categorias/
        │   └── [slug]/
        │       └── [...page].astro     Listado paginado, 60 por página. Rest param: página 1 = ruta limpia (§9.5)
        ├── indice.json.ts              Fase 3. Endpoint estático con el índice de búsqueda (§9.4)
        ├── robots.txt.ts               robots.txt condicionado a INDEXABLE (§7.2)
        └── 404.astro                   No encontrado; enlaza a home y categorías
```

---

## 9. Configuración e implementación

### 9.1 `astro.config.mjs`

```js
import { defineConfig, envField } from 'astro/config';
import preact from '@astrojs/preact';
import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';

// Los archivos .env no se cargan en los archivos de config: hay que usar loadEnv o process.env.
const { SITE_URL } = loadEnv(process.env.NODE_ENV ?? 'development', process.cwd(), '');

if (!SITE_URL) {
  throw new Error('SITE_URL no está definida. Astro.site quedaría undefined y el canonical se rompe.');
}

export default defineConfig({
  site: SITE_URL,
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [preact()],
  vite: { plugins: [tailwindcss()] },
  env: {
    schema: {
      PUBLIC_R2_BASE:  envField.string({ context: 'client', access: 'public' }),
      PUBLIC_WHATSAPP: envField.string({ context: 'client', access: 'public' }),
      INDEXABLE:       envField.boolean({ context: 'server', access: 'public', default: false }),
    },
  },
});
```

`SITE_URL` no va en el schema de `astro:env`: `astro:env` es un módulo virtual que no se puede usar dentro de los archivos de config, y acá se necesita justamente ahí. Se consume por `Astro.site` / `import.meta.env.SITE`, que Astro deriva de `site`.

`PUBLIC_WHATSAPP` es `client` porque la isla del selector de variante reconstruye el enlace en el navegador.

#### Variables de entorno

Dos grupos con reglas distintas. **El sitio no tiene secretos; el importador sí.**

| Variable | Usada por | Valor | Secreta |
|---|---|---|---|
| `SITE_URL` | `astro.config.mjs` vía `loadEnv` | `https://asuncionybe.com` | No |
| `INDEXABLE` | Build, vía `astro:env/server` | `true` desde el dominio propio (§7.2) | No |
| `PUBLIC_R2_BASE` | Build y cliente | `https://img.asuncionybe.com`, custom domain del bucket R2 | No |
| `PUBLIC_WHATSAPP` | Build y cliente | `595981857213` | No |
| `R2_ACCOUNT_ID` | **Solo el importador** | Cuenta de Cloudflare | No |
| `R2_BUCKET` | **Solo el importador** | Nombre del bucket | No |
| `R2_ACCESS_KEY_ID` | **Solo el importador** | Token de API de R2 | **Sí** |
| `R2_SECRET_ACCESS_KEY` | **Solo el importador** | Token de API de R2 | **Sí** |

Las cuatro `R2_*` **no entran al schema de `astro:env`** y no se leen nunca desde `src/`. `scripts/import/r2.mjs` corre en Node fuera de Astro y las toma de `process.env`. Motivo: una credencial de escritura declarada en el schema de Astro es una credencial a un `import` de distancia de terminar en el bundle del cliente. El sitio es estático y de solo lectura; no necesita ni debe poder escribir en R2.

`.env` está gitignorado. `.env.example` documenta las ocho: completas las que tienen valor conocido (`SITE_URL` local, `INDEXABLE`, `PUBLIC_WHATSAPP`, `R2_BUCKET`), y en blanco las que dependen de la cuenta de Cloudflare (`PUBLIC_R2_BASE`, `R2_ACCOUNT_ID`) más las dos secretas.

**`SITE_URL` no se puede completar antes del primer deploy:** el subdominio de Workers tiene la forma `https://ybe-catalogo.{subdominio-de-cuenta}.workers.dev` y recién se conoce al desplegar. El orden es: build con `SITE_URL=http://localhost:4321`, primer `wrangler deploy`, leer la URL asignada, ponerla en `.env`, y volver a desplegar para que los canonical queden bien.

### 9.2 `wrangler.jsonc`

```jsonc
{
  "name": "ybe-catalogo",
  "compatibility_date": "2026-07-01",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "404-page"
  }
}
```

Sin `main` y sin adapter: con `output: 'static'` el sitio es puramente estático y `@astrojs/cloudflare` no hace falta.

#### `public/_headers` — cache de los assets

Cloudflare sirve los assets con `Cache-Control: public, max-age=0, must-revalidate` por defecto. Para el HTML es correcto: no lleva hash y cambia en cada importación. Para los assets con hash de contenido es un desperdicio, porque su URL cambia si cambia el contenido y no hay nada que revalidar.

Se corrige con un `_headers` en `public/`, que Workers parsea y no sirve:

```
/_astro/*
  Cache-Control: public, max-age=31536000, immutable

/img-dev/catalogo/:hash/*
  Cache-Control: public, max-age=31536000, immutable

/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
```

**Dos comportamientos verificados en producción que no son evidentes:**

1. **Cloudflare SUMA las cabeceras de todas las reglas que matchean, no las reemplaza.** Con un `Cache-Control` en el catch-all `/*`, el asset inmutable recibía `max-age=0, must-revalidate, public, max-age=31536000, immutable` — y el navegador lee el primero, anulando el cache. Por eso `/*` **no define `Cache-Control`**: el default de Cloudflare ya es el que corresponde al HTML.
2. **Un splat simple no cruza niveles de ruta.** `/img-dev/*` no matchea `/img-dev/catalogo/{hash}/w600.webp`, que está tres niveles abajo. Hay que usar un placeholder para el segmento intermedio: `/img-dev/catalogo/:hash/*`.

Al verificar, tener en cuenta que **el borde puede servir cabeceras viejas**: un asset pedido antes del cambio devuelve `cf-cache-status: HIT` con las cabeceras del deploy anterior hasta que se refresque. Conviene comprobar sobre una ruta que no se haya pedido nunca.

Cuando las imágenes pasen a R2, la política inmutable la aplica el bucket (§5.1) y la regla `/img-dev/*` deja de hacer falta.

### 9.3 Formato de precios

```ts
const formateador = new Intl.NumberFormat('es-PY', {
  style: 'currency',
  currency: 'PYG',
  maximumFractionDigits: 0,   // el guaraní no tiene decimales
});
export const formatearGs = (n: number) => formateador.format(n);
```

**Se ejecuta en build (Node), no en el cliente.** El resultado queda en el HTML estático. El símbolo y el espaciado que produce `Intl` dependen de la versión de ICU del runtime: formatear en el navegador daría salidas distintas entre Chrome, Safari y WebViews viejos de Android. En build hay una sola ICU y el resultado es estable por deploy.

**Criterio de aceptación:** la salida esperada es `Gs. 285.000`. Si la ICU del entorno emite `PYG 285.000`, el fallback es `style: 'decimal'` con el prefijo literal `Gs. `.

El precio se renderiza dentro de `<span data-precio={n}>` para que el filtro por precio del buscador (Fase 3) lea el número crudo y no tenga que parsear el texto formateado.

### 9.4 Búsqueda y filtros del lado del cliente

Entrada del índice:

```json
{"i":"mochila-urbana-lisa-18","n":"Mochila urbana lisa 18\"","p":285000,"c":["mochilas","escolar"],"t":"9f2a1c4be7d80315"}
```

122 bytes crudos para esa entrada, ≈ 54 con Brotli (la repetición de claves y slugs comprime muy bien).

| Productos | Crudo | Brotli | Veredicto |
|---|---|---|---|
| 500 | ~60 KB | ~26 KB | Sin problema |
| 1.000 | ~119 KB | ~52 KB | Cómodo |
| **1.500** | ~179 KB | ~79 KB | **Techo recomendado** |
| 2.000 | ~238 KB | ~105 KB | Límite; medir antes de aceptar |
| 3.000 | ~357 KB | ~157 KB | Perceptible en 3G/4G lento |
| 5.000 | ~596 KB | ~262 KB | Inaceptable en móvil |

**Volumen objetivo: 300 a 1.500 productos.** Cae dentro del techo, así que **se manda el índice completo** en `/indice.json`, cargado con `client:idle` para que no compita con el render inicial. En el peor caso del rango (1.500) son ~79 KB con Brotli, aceptable incluso en móvil con datos medidos.

El plan B queda **especificado pero no construido**: se activa solo si el catálogo pasa el techo.

**Campos del índice:** `i` (slug), `n` (nombre), `p` (precio), `c` (slugs de categoría), `t` (hash de la imagen de la primera variante).

No incluye `descripcion`: es el campo más pesado y el que menos aporta a una búsqueda por nombre. No incluye marca: el catálogo es de una sola (§4.2), así que no discrimina y no existe filtro por marca.

Búsqueda por `nombre`; filtros por categoría y rango de precio.

**Construido el 2026-08-10 — y los filtros quedaron DESCARTADOS, no pendientes.**

Lo que se hizo: búsqueda por **nombre y código**. El código no estaba en esta sección;
lo agregó `SPEC-etapa2` §5.3 con el campo `k`, y termina siendo el caso principal — un
cliente pregunta por WhatsApp citando el código, así que el código gana sobre el nombre
en el orden de resultados.

Lo que **no** se hace, por decisión del 2026-08-10:

- **Filtro por categoría.** Ya existe la navegación por categorías: están en el header
  y cada una tiene su listado paginado (§9.5). Un filtro dentro del buscador sería un
  segundo camino para lo mismo, y un camino paralelo es donde se cometen los errores.
- **Filtro por rango de precio.** Con 300 a 1.500 productos de una sola marca, el rango
  no discrimina lo suficiente para pagar la interfaz. Y una parte del catálogo se
  publica con «Consultar precio» (§7.3), así que el filtro dejaría afuera productos por
  no tener el dato — que es lo contrario de ayudar a encontrarlos.

Los campos `p` y `c` del índice **se conservan igual**: la lista de resultados muestra
el precio, y `c` no cuesta nada y deja la puerta abierta sin construir nada.

**Plan B, si se supera el techo de 1.500:**

1. **Shards por categoría** — `/indice/{categoria}.json`. La búsqueda global pasa a ser búsqueda dentro de una categoría, con el shard cargado al entrar. Es el paso más chico y no agrega dependencias: el listado por categoría ya es la vista principal.
2. **Índice fragmentado tipo Pagefind** — construye el índice en build y el cliente descarga solo los fragmentos que la consulta necesita. Es la solución correcta para búsqueda global a escala en un sitio estático. Requiere validar la integración con Astro antes de comprometerla.

Lo que **no** se hace: montar un endpoint de búsqueda. Rompería `output: 'static'`.

### 9.5 Paginación de los listados por categoría

Con 300 a 1.500 productos, una categoría puede juntar cientos de items. Los listados se paginan **desde la Fase 1**, no como mejora posterior.

**Ruta: `src/pages/categorias/[slug]/[...page].astro`** — rest param, no `[page]`.

Con `[page].astro` la primera página quedaría en `/categorias/mochilas/1`, y la URL limpia `/categorias/mochilas` no existiría. Con `[...page]` el rest param matchea vacío y la página 1 **es** `/categorias/mochilas`; el resto queda en `/categorias/mochilas/2`, `/3`. Eso preserva la ruta canónica de §1.2.

```ts
export const getStaticPaths = (async ({ paginate }) => {
  const cats = await getCollection('categorias', c => c.data.activa);
  return cats.flatMap(cat =>
    paginate(productosDeCategoria(cat.id), {
      params: { slug: cat.id },
      pageSize: 60,
    })
  );
}) satisfies GetStaticPaths;
```

- **`pageSize: 60`.** Con la card a 1:1 y grilla de 4 columnas en desktop son 15 filas: suficiente para no obligar a paginar en catálogos chicos, y acotado para no mandar 1.500 nodos en una sola página.
- **Cada página lleva su propio canonical**, apuntando a sí misma. La página 2 no canonicaliza a la 1: son inventarios distintos y colapsarlas esconde productos del índice.
- Navegación con `page.url.prev` / `page.url.next`, y `page.currentPage` / `page.lastPage` para el indicador. Sin `rel=prev/next` en el `<head>`: Google ya no lo usa.
- El orden dentro de la categoría es estable (por `actualizado` descendente, luego por `id`) para que un producto no salte de página entre builds.

**Criterios de aceptación de la ruta**, a validar en el primer build:

1. `/categorias/mochilas` existe y es la página 1 (no redirige ni 404ea).
2. `page.url.next` de la página 1 apunta a `/categorias/mochilas/2` sin doble barra.
3. `page.url.prev` de la página 2 apunta a `/categorias/mochilas` **sin** barra final, coherente con `trailingSlash: 'never'`.

Los tres se comprueban porque la combinación de rest param anidado con `trailingSlash: 'never'` y `build.format: 'file'` es donde históricamente aparecen barras de más o de menos.

### 9.6 Selección de variante

Con `output: 'static'` la página está prerenderizada, así que `Astro.url.searchParams` no tiene valor en build. Consecuencias:

- La página se renderiza con **`variantes[0]` activa** en el HTML. Sin JS, el producto es legible, tiene foto, precio y botón de WhatsApp funcional.
- `SelectorVariante.tsx` (`client:visible`) lee `?variante=<sku>` al montar, y al cambiar de color actualiza imagen, SKU visible, el `href` del botón de WhatsApp y la URL con `history.replaceState`.
- El canonical no cambia (§7.1).
- Todas las variantes se serializan en el HTML como `<script type="application/json">` para que la isla no haga fetch.

### 9.7 Enlace de WhatsApp

```ts
export function construirEnlaceWa({ telefono, nombre, url, color }: Args) {
  const texto = color
    ? `Hola! Me interesa este producto:\n\n${nombre} — ${color}\n${url}`
    : `Hola! Me interesa este producto:\n\n${nombre}\n${url}`;
  return `https://wa.me/${telefono}?text=${encodeURIComponent(texto)}`;
}
```

`nombre` y `url` (canónica, absoluta) son **obligatorios**. `url` se construye con `new URL(..., Astro.site)`: nunca hardcodeada.

**Número: `595981857213`** (`PUBLIC_WHATSAPP`).

Formato: código de país, **sin `+`, sin ceros iniciales, sin espacios, guiones ni paréntesis**. Es lo que pide `wa.me`. El número local `0971 878 090` pierde el `0` inicial y toma el `595` de Paraguay. Un `+` en la URL suele tolerarse, pero no es la forma canónica y no se usa.

El valor vive en `PUBLIC_WHATSAPP` y **nunca se hardcodea en un componente**: el mismo número aparece en la ficha, en el footer y en el "checkout" del carrito de Fase 5, y tres copias divergen a la primera vez que cambia.

---

## 10. Fuera de alcance

Nada de esto se implementa, y ninguna decisión de la spec asume que existe.

| Tema | Nota |
|---|---|
| Carrito y checkout | Fase 5. El modelo lo soporta sin refactor |
| Pagos en línea | Nunca. El objetivo es contacto por WhatsApp |
| Cuentas de usuario, login, favoritos en servidor | Nunca en este alcance |
| Stock en vivo | No hay fuente de datos. De ahí `availability: InStoreOnly` (§7.5) |
| Panel de administración | El admin es un desarrollador: edita JSON y corre el importador |
| SSR, adapter de servidor, endpoints dinámicos | Contradice `output: 'static'` |
| Base de datos | Contradice el JSON versionado en git |
| Multi-idioma / i18n | Solo `es-PY` |
| Reseñas y ratings | Sin cuentas de usuario no hay fuente. Consecuencia directa en §7.3 |
| Optimización de imágenes en build | Las de catálogo van pre-procesadas antes de subir |
| Zoom / lightbox de producto | El origen es 600 px (§5.2): no hay resolución para ampliar |
| Eliminación o reemplazo de marcas de agua | Se publican tal cual (§5.6) |
| Recorte del blanco y re-encuadre del sujeto | Alteraría la marca de agua de forma inconsistente (§5.3) |
| Hash perceptual para dedupe | El dedupe es por bytes (§6.8). El volumen no justifica el costo |
| Analytics, pixel, cookie banner | No definido. Si entra, cambia obligaciones legales |
| Búsqueda en servidor | Rompería `output: 'static'` (§9.4) |
| Envíos, cálculo de flete | No es un e-commerce |
| Blog / contenido editorial | No pedido |

---

## 11. Fases de implementación

Cada fase es entregable y desplegable por sí sola.

### Fase 0 — Prerrequisitos (no desplegable)

1. `git init` y commit inicial. El JSON versionado en git es la única persistencia del proyecto.
2. `npm create astro@latest` con `output: 'static'` y TypeScript strict.
3. `npx astro add preact` y `npx astro add tailwind` (instala `@tailwindcss/vite`).
4. Crear bucket de R2 y su dominio público → `PUBLIC_R2_BASE`.
5. Generar el token de API de R2 con permiso de escritura → `R2_ACCESS_KEY_ID` y `R2_SECRET_ACCESS_KEY` (§9.1).
6. Copiar `.env.example` a `.env` y completar las ocho variables.

### Fase 1 — Catálogo mínimo útil (desplegable)

Lo mínimo que le sirve a un cliente real: entra, encuentra el producto, ve el precio, escribe por WhatsApp.

- `content.config.ts` con las dos colecciones y `reference()`.
- `categorias.json` y `overlay/chenson.json` a mano; `productos.json` generado por la ingesta.
- **Etapa 1 (`scrape`) v1:** robots.txt, rate limit, caché en disco, `--reanudar`, salida al contrato de §6.3.
- **Etapa 2 (`import`) v1:** join con el overlay, mapear categorías, normalizar colores y SKU, hash y dedupe, resize a `w300`/`w600`, subir a R2, merge idempotente, reporte. Con los tests de `__tests__/`.
- `Base.astro` con `noindex` (default `INDEXABLE=false`), canonical y los tokens de la paleta.
- `Header` y `Footer`.
- `/` con categorías activas y pedidos especiales.
- `/categorias/[slug]/[...page]` con la grilla paginada a 60 por página (§9.5).
- `/productos/[slug]` con galería, `SelectorVariante`, precio y `BotonWhatsapp`.
- `ImagenProducto` y `SinFoto` (§5.4), `Precio` con "Consultar precio".
- `404.astro`.
- `wrangler.jsonc` y deploy a `.workers.dev`.

**Criterio de salida**, verificado sobre datos reales del origen:

1. `CG85527` publicado con sus 3 colores, cambiando de color sin recargar y con el mensaje de WhatsApp reflejando el color elegido.
2. Un producto con `precio: null` mostrando "Consultar precio" y **sin** bloque `offers` en el JSON-LD.
3. Un producto con `imagenes: []` mostrando el placeholder, no un `<img>` roto.
4. Un modelo sin entrada en el overlay **ausente de toda vista**, y listado como `SIN CURAR` en el reporte.
5. Dos corridas seguidas de la etapa 2 sobre el mismo `crudo`: `git diff --exit-code src/data/productos.json` limpio.
6. Todo lo anterior alcanzable y contactable desde un teléfono, con `noindex` activo.

### Fase 2 — SEO y assets de marca (desplegable)

- Logo definitivo (§12 · Logo definitivo) → favicon, apple-touch, `icon-512`, `og-image`.
- `monograma.svg` → `SinFoto` con el monograma.
- Tags OG completos y `twitter:card`.
- JSON-LD: `Product` + `Offer`, `BreadcrumbList`, `Organization`.
- `robots.txt.ts` y `@astrojs/sitemap` condicionados a `INDEXABLE`.
- Dominio real → `SITE_URL`, `INDEXABLE=true`. Recién acá el sitio entra al índice.
- `og.png` por producto (1200 × 630) en el importador.

### Fase 3 — Búsqueda y filtros (desplegable)

- `indice.json.ts` (§9.4).
- Isla `Buscador.tsx` con `client:idle`: búsqueda por nombre, filtro por categoría y rango de precio.
- Medir el peso real del índice contra la tabla de §9.4 y confirmar que el catálogo sigue bajo el techo de 1.500.

### Fase 4 — Robustez del importador (desplegable)

- Umbral de deriva de precio ±25 % con exit code 2.
- Cálculo del bbox del sujeto para el reporte, sin modificar la imagen (§6.10).
- Detección y reporte de huérfanos.
- Avisos de resolución insuficiente.
- Reporte en Markdown comiteado por corrida.

### Fase 5 — Carrito (desplegable)

El modelo ya lo soporta: `sku` único por variante es la clave del ítem y no hay que tocar el schema.

- `npm i nanostores @nanostores/persistent`.
- ```ts
  export const $carrito = persistentAtom<ItemCarrito[]>('ybe:carrito', [], {
    encode: JSON.stringify, decode: JSON.parse,
  });
  ```
  `ItemCarrito` = `{ sku, id, nombre, color, precio, cantidad }`. Denormalizado a propósito: el carrito debe sobrevivir a que el producto desaparezca del catálogo.
- Islas: `BotonAgregar` en la ficha, `ContadorCarrito` en el header, `PanelCarrito`.
- El "checkout" arma un único mensaje de WhatsApp con los ítems, cantidades, subtotal y las URLs canónicas. Sin pagos.
- Verificar el límite práctico de longitud de `wa.me?text=`: un carrito largo puede pasarse. Si ocurre, se manda un resumen con las URLs y no el detalle completo.

---

## 12. Puntos pendientes

Se identifican por nombre, no por número: al resolverse se integran al cuerpo de la spec y se borran de esta lista, sin renumerar el resto.

**Logo definitivo** — parcialmente resuelto
El PNG ya tiene **alpha real** (§2.1), lo que desbloquea favicon, apple-touch e icon-512. Falta: el **SVG vectorial** (para nitidez en cualquier tamaño y para el lockup del header) y una **variante monocromática del monograma solo**, que es lo que necesitan el favicon de 16 px y el placeholder de "sin foto" (§5.4). Un archivo recortado al trazo además permitiría desactivar el parche de `Logo.astro`.

**Redes sociales** — ¿cuáles existen?
Para `sameAs` de `Organization` y los enlaces del footer.

**Buscador en el sitio público** — pedido el 2026-08-06, sin resolver
Buscar por **código o nombre**. El código es lo que el cliente tiene a mano cuando pregunta por un producto por WhatsApp — el mismo argumento de `SPEC-etapa2.md` §5.3 que justificó el buscador del admin, pero del lado de afuera.

La restricción que manda: **el sitio es estático** (§1.1), así que no hay servidor donde consultar. Las tres salidas son un índice JSON que el navegador filtra, un servicio externo, o romper `output: 'static'` — y la tercera está descartada por §4.1. Con 300 a 1.500 productos (§9.4) el índice pesa unos pocos KB, así que la primera es la que hay que evaluar primero, cuidando que **no se descargue en cada visita** sino recién al usar el buscador: el catálogo se navega desde el teléfono y con datos móviles.

Dos cosas que ya están resueltas y conviene reusar: el criterio de qué se busca (código o nombre) y el aviso de que `LIKE`/comparación ASCII no distingue acentos, los dos documentados en la grilla del admin (`SPEC-etapa2.md` §10.3). Del lado público conviene normalizar los acentos al indexar, porque nadie escribe «Riñonera» con la eñe en un buscador.

---

## 13. Referencias

- [Content Collections](https://docs.astro.build/en/guides/content-collections/) — `src/content.config.ts`, `defineCollection`, `reference()`, `getCollection`, `getEntry`
- [Content Loader Reference](https://docs.astro.build/en/reference/content-loader-reference/) — `file()` desde `astro/loaders`, requisito de `id` único
- [Routing Reference](https://docs.astro.build/en/reference/routing-reference/) — `getStaticPaths()`, `paginate()` y la forma de `page`
- [Routing · Paginación](https://docs.astro.build/en/guides/routing/#pagination) — patrón de nombre de archivo; `[page]` numera desde 1, `[...page]` deja la página 1 en la ruta limpia
- [Endpoints](https://docs.astro.build/en/guides/endpoints/) — endpoints estáticos `.json.ts` con `export function GET`
- [Environment Variables](https://docs.astro.build/en/guides/environment-variables/) — `astro:env`, `envField`, y `loadEnv` para los archivos de config
- [Configuration Reference](https://docs.astro.build/en/reference/configuration-reference/) — `site`, `output`, `trailingSlash`, `build.format`, `image.domains`
- [Images](https://docs.astro.build/en/guides/images/) — `src/assets` vs `public/`, `<Image>`, imágenes remotas y `<img>` plano
- [API Reference](https://docs.astro.build/en/reference/api-reference/) — `Astro.site` (`URL | undefined`), patrón de canonical
- [Deploy a Cloudflare](https://docs.astro.build/en/guides/deploy/cloudflare/) — `wrangler.jsonc` con `assets`; adapter no requerido en `static`
- [Styling / Tailwind](https://docs.astro.build/en/guides/styling/) — `@tailwindcss/vite`
- [Integración Preact](https://docs.astro.build/en/guides/integrations-guide/preact/) — `npx astro add preact`, `tsconfig`
- [@nanostores/persistent](https://github.com/nanostores/persistent) — `persistentAtom` con `encode`/`decode`
- [Google · Product structured data](https://developers.google.com/search/docs/appearance/structured-data/product-snippet) — se exige uno de `review`/`aggregateRating`/`offers`; `price` obligatorio en `Offer`; enum de `availability`
