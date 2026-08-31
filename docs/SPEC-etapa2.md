# YBE Catálogo — Especificación técnica de la etapa 2

**Versión:** 2.0-borrador · **Fecha:** 2026-08-03 · **Estado:** pendiente de aprobación

Documento delta sobre `docs/SPEC.md` (v1.0). No lo reemplaza: lo corrige en las
secciones que la etapa 2 invalida. Al aprobarse, §2 de este documento indica qué
partes de `SPEC.md` hay que reescribir y este archivo se integra al cuerpo
principal.

---

## 1. Alcance de la etapa 2

Cinco entregables, tomados del pedido original:

1. **R2 real.** Bucket creado, imágenes subidas, `PUBLIC_R2_BASE` apuntando al
   dominio público del bucket. Hoy las imágenes se sirven desde `/img-dev` local.
2. **Área de administrador.** Aplicación web con autenticación, operada por una
   persona no técnica.
3. **El código de producto como campo de primera clase.** Visible en la ficha,
   buscable, y clave de las operaciones del admin.
4. **Ingesta masiva por scrape.** Se pega una URL de listado del proveedor, el
   sistema recorre todas sus páginas y fichas, trae todas las imágenes y todos
   los datos disponibles, y los deja en una grilla editable. Desde ahí se
   completa categoría, título, detalle y precio, y se aprueba para publicar.
5. **Eliminación de productos**, identificados por código.

Agregado durante el análisis:

6. **Carga manual de un producto único.** El scrape solo cubre a este proveedor;
   sin formulario manual no hay ninguna puerta de entrada para un producto de
   otro origen.

### 1.1 El cambio de premisa que ordena todo lo demás

`SPEC.md` §1 asume **un único administrador que además es el desarrollador**, y
§10 lo declara explícitamente fuera de alcance: *«El admin es un desarrollador:
edita JSON y corre el importador»*.

Eso ya no es cierto. Los productos los va a cargar **una persona no técnica**, y
el rol técnico queda separado. Esta única diferencia es la que justifica casi
todas las decisiones de este documento: no alcanza con que el sistema sea
correcto, tiene que ser **operable sin terminal y legible sin contexto técnico**,
y cada falla tiene que ser visible en pantalla en lugar de en un log.

---

## 2. Qué invalida de `SPEC.md`

| Sección | Dice hoy | Qué pasa |
|---|---|---|
| §1 «Un solo administrador (yo, desarrollador)» | Premisa del documento | **Se reescribe.** Dos roles: quien carga (no técnico) y quien mantiene (técnico) |
| §1.3 «Sin base de datos. Los JSON son la persistencia» | Fuente de verdad | **Se corrige.** D1 es la fuente de verdad; `productos.json` pasa a ser un artefacto generado y comiteado |
| §6.1–6.6 Ingesta en dos binarios + `overlay/{proveedor}.json` | Diseño de la ingesta | **Se reemplaza.** El admin ocupa el lugar del overlay a mano y de la cola `SIN CURAR` |
| §6.3 `crudo` con `categoriaOrigen: { padre, hijo }` | Contrato entre etapas | **Es incorrecto.** Verificado: el origen no expone la categoría en la ficha ni en el listado (§5.4b). El campo no se puede llenar |
| §6.6 `mapeo/chenson.json` → tabla de categorías | Normalización | **Queda sin objeto** por lo anterior. La parte de colores → `nombre` + `hex` sí sigue vigente |
| §2.3 «`descripcion` no existe en el origen» | Assets de origen | **Confirmado.** El rótulo «Medidas aprox.» existe en la plantilla pero su celda de valor viene vacía (§7.2) |
| §6.6 Regla de publicación por presencia de `nombre` | Curaduría | **Se reemplaza** por la máquina de estados de §5.2 |
| §6.7 `manifest.json` como estado de idempotencia | Idempotencia | **Se reemplaza.** El estado vive en D1, con las restricciones `UNIQUE` haciendo el trabajo |
| §10 «Panel de administración» fuera de alcance | Alcance | **Se elimina de la lista.** Es el entregable central de esta etapa |
| §10 «SSR, adapter de servidor, endpoints dinámicos» fuera de alcance | Alcance | **Se acota.** Sigue prohibido en el sitio público; el admin es un Worker aparte |
| §10 «Base de datos» fuera de alcance | Alcance | **Se elimina de la lista** |
| §4.2 `origen` «no se renderiza» | Modelo de datos | **Se corrige.** El código pasa a ser visible y buscable (§5.3) |
| §6.9 Borrado: nunca, solo `activo: false` | Borrado | **Se matiza.** Depende de si el producto llegó a publicarse (§12) |

**Lo que NO cambia**, y conviene decirlo explícitamente porque es la mayor parte
del proyecto: todo `src/` sigue igual. Los schemas Zod, `reference('categorias')`
rompiendo el build ante un slug inválido, las rutas planas, la paginación con
rest param, el canonical, el contrato de imágenes, el enlace de WhatsApp y la
decisión de publicar precios siguen vigentes tal como están escritos.

---

## 3. Límites del free tier — verificados

Medidos contra la documentación oficial el **2026-08-03**. Las fuentes están en
§17. Cloudflare mueve estos números: la fecha es parte del dato.

| Servicio | Límite gratuito | Consumo estimado del proyecto |
|---|---|---|
| **Workers — requests** | 100.000 / día | Admin usado por 1–2 personas: cientos por mes |
| **Workers — assets estáticos** | **Gratis e ilimitados**, no cuentan contra los 100.000 | Todo el catálogo público, con el tráfico que tenga |
| **Workers — CPU** | **10 ms por invocación** | **La restricción real.** Ver §7.3 |
| **Workers — subrequests** | **50 por request** | Ver §7.3 |
| **Workers — cuerpo del request** | 100 MB | Una foto normalizada pesa ~50 KB |
| **D1 — almacenamiento** | 5 GB | ~600 bytes por producto ⇒ millones |
| **D1 — filas leídas** | 5.000.000 / día | El sitio público no lee D1. Solo el admin y el build |
| **D1 — filas escritas** | 100.000 / día | Un scrape de 1.500 modelos escribe ~8.000 filas |
| **R2 — almacenamiento** | 10 GB-mes | ~200.000 imágenes de 50 KB |
| **R2 — Class A (PutObject)** | 1.000.000 / mes | Una subida por imagen nueva |
| **R2 — Class B (GetObject)** | 10.000.000 / mes | El sitio sirve imágenes vía dominio público del bucket |
| **R2 — egress** | **Gratis, siempre** | — |
| **R2 — DeleteObject** | **Gratis** (no es Class A ni B) | Abarata la purga de §12.3 |
| **Queues** | 10.000 ops / día (gratis desde 2026-02-04) | No se usa en v1. Salida de escape de §7.1 |
| **Cloudflare Access** | Hasta 50 usuarios | 1–3 usuarios |

**Conclusión: la etapa 2 corre en $0/mes.** El único gasto real del proyecto
sigue siendo el dominio, que no lo trae esta etapa y hoy no existe.

Los minutos gratuitos de GitHub Actions en repositorio privado **quedan sin
verificar** (§16).

### 3.1 Los dos límites que sí duelen

De toda la tabla, dos cifras condicionan el diseño y ninguna se resuelve con
dinero:

- **10 ms de CPU por invocación.** No es tiempo total: la E/S de red no cuenta,
  solo el cómputo. Pero parsear HTML y hashear bytes sí cuenta. Es la razón de la
  granularidad de §7.3.
- **`sharp` no corre en Workers.** Es un binario nativo y el runtime de Workers
  no ejecuta binarios nativos. No hay plan que lo habilite. Es la razón de §8.

---

## 4. Arquitectura

### 4.1 Dos Workers, no uno

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  ybe-catalogo.workers.dev   │        │  ybe-admin.workers.dev       │
│  Sitio público              │        │  Admin                       │
│  output: 'static'           │        │  SSR (adapter cloudflare)    │
│  Sin bindings               │        │  Bindings: D1 + R2 (RW)      │
│  Solo assets                │        │  Protegido por Access        │
└─────────────────────────────┘        └──────────────────────────────┘
              ▲                                       │
              │ deploy                                │ lee / escribe
              │                                       ▼
     ┌────────────────────┐                  ┌──────────────────┐
     │  GitHub Actions    │◀── dispatch ─────│  D1  +  R2       │
     │  dump → build →    │                  │  fuente de verdad│
     │  commit → deploy   │─── lee D1 ──────▶│                  │
     └────────────────────┘                  └──────────────────┘
```

El sitio público **no tiene bindings**. No puede leer ni escribir D1 ni R2, ni
por error de programación ni por un `import` mal puesto.

Esto extiende el razonamiento que `SPEC.md` §9.1 ya aplicó a las credenciales de
R2 — *«una credencial de escritura declarada en el schema de Astro es una
credencial a un `import` de distancia de terminar en el bundle del cliente»* — un
nivel más arriba. Si admin y sitio comparten Worker, comparten bindings, y un
sitio de solo lectura queda con permiso de escritura que no necesita.

Beneficios adicionales:

- El sitio público **no necesita `@astrojs/cloudflare`**. `wrangler.jsonc` queda
  como está: sin `main`, solo `assets`. Se preserva la decisión de §9.2.
- Un bug en el admin no puede tumbar el catálogo: son deploys independientes.
- Los assets del sitio siguen siendo gratis e ilimitados (§3). Meter SSR en el
  mismo Worker con `run_worker_first` los pasaría a facturables.

### 4.2 Por qué el sitio público NO lee D1

El catálogo cambia al ritmo de quien lo carga: semanal, o mensual. Se lee cientos
de veces por día. Renderizar por request desde D1 pagaría cómputo y lecturas por
contenido que no cambió, y perdería el cache trivial, el SEO y la resiliencia que
`output: 'static'` da gratis.

El volcado invierte la relación: **D1 es el upstream de `productos.json`, no un
reemplazo de las páginas**. Todo `src/` sigue consumiendo Content Collections sin
enterarse de que existe una base de datos.

### 4.3 El volcado devuelve git como historial

Como `productos.json` se comitea en cada publicación:

- **Historial legible.** El diff de git muestra qué cambió en cada publicación,
  incluidos los cambios de precio. `SPEC.md` §6.5 pedía salida determinista
  justamente para eso; sigue en pie (claves ordenadas, productos ordenados por
  `id`).
- **Backup de D1 sin infraestructura.** Si D1 se corrompe o se borra, el catálogo
  publicado está íntegro en git y es reconstruible.
- **Revisión posterior.** El rol técnico puede auditar qué se publicó sin entrar
  al admin.

---

## 5. Modelo de datos en D1

### 5.1 Esquema

Es el esquema **acumulado**: `db/migrations/0001` más lo que agregaron `0002` y `0003`,
anotado en cada caso. La fuente de verdad son los archivos de migración; esto es su
lectura en limpio.

```sql
-- Un producto. La unidad de curaduría y de publicación.
CREATE TABLE productos (
  id            INTEGER PRIMARY KEY,
  codigo        TEXT    NOT NULL UNIQUE,   -- CG85527. Identidad de negocio (§5.3)
  proveedor     TEXT    NOT NULL,          -- 'chenson' | 'manual'
  slug          TEXT             UNIQUE,   -- NULL hasta aprobar (§5.2). Es el id publico
  nombre        TEXT,                      -- NULL al importar; obligatorio para aprobar
  descripcion   TEXT,
  precio        INTEGER,                   -- guaranies, sin decimales. NULL = "Consultar"
  destacado     INTEGER NOT NULL DEFAULT 0,  -- CONGELADA: sin lectores ni escritores (SPEC.md §4.5)
  estado        TEXT    NOT NULL DEFAULT 'importado'
                CHECK (estado IN ('importado','aprobado','publicado','eliminado')),
  categoria_origen TEXT,                   -- NULL por el camino de lanzamientos: el
                                           -- origen no la expone (§5.4b). Se conserva
                                           -- para un scrape futuro por categoria
  url_origen    TEXT,                      -- ficha del proveedor. Auditoria
  scrape_id     INTEGER REFERENCES scrapes(id),
  creado_en     TEXT    NOT NULL,
  actualizado_en TEXT   NOT NULL,
  publicado_en  TEXT,                      -- primera publicacion. NULL = nunca fue publico
  cambio_en_origen TEXT                    -- migracion 0003. El aviso que pide §7.5:
                                           -- el proveedor sumo un color y hay que
                                           -- mirarlo. FECHA y no booleano, para poder
                                           -- ordenar la revision por antiguedad.
                                           -- NULL = sin novedad
);

CREATE INDEX idx_productos_estado ON productos(estado);
CREATE INDEX idx_productos_proveedor ON productos(proveedor);

-- Migracion 0002. El UNIQUE de arriba NO garantizaba la unicidad: la collation por
-- defecto es BINARY, asi que 'cg85527' y 'CG85527' pasaban como dos productos.
CREATE UNIQUE INDEX idx_productos_codigo_nocase ON productos(upper(codigo));

-- Migracion 0003. Parcial: solo indexa las filas con aviso, que son pocas. La
-- consulta del admin es "cuales tienen novedad", nunca "cual es la fecha de este".
CREATE INDEX idx_productos_cambio_en_origen
  ON productos(cambio_en_origen) WHERE cambio_en_origen IS NOT NULL;

-- Un color del producto. Comparte nombre y precio con el producto (SPEC §4.2).
CREATE TABLE variantes (
  id           INTEGER PRIMARY KEY,
  producto_id  INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  sku          TEXT    NOT NULL UNIQUE,    -- CG85527-P
  color        TEXT    NOT NULL,           -- normalizado, sin el prefijo (X)
  color_origen TEXT,                       -- '(P) ROSADO' literal. Auditoria
  color_hex    TEXT,                       -- #rrggbb o NULL. Nunca se inventa
  activo       INTEGER NOT NULL DEFAULT 1,
  orden        INTEGER NOT NULL DEFAULT 0
);

-- Una imagen. hash16 es la identidad: mismo contenido, una sola copia en R2.
CREATE TABLE imagenes (
  id          INTEGER PRIMARY KEY,
  hash16      TEXT    NOT NULL,            -- sha256(bytes originales)[:16]
  anchos      TEXT    NOT NULL,            -- JSON: '[300,600]' o '[300]'
  ancho_origen  INTEGER NOT NULL,
  alto_origen   INTEGER NOT NULL,
  bytes_origen  INTEGER NOT NULL,
  creado_en   TEXT    NOT NULL,
  UNIQUE(hash16)
);

-- Muchas a muchas: la misma foto puede pertenecer a variantes de distintos
-- productos. Es exactamente el caso de dedupe de SPEC §6.8.
CREATE TABLE variante_imagenes (
  variante_id INTEGER NOT NULL REFERENCES variantes(id) ON DELETE CASCADE,
  imagen_id   INTEGER NOT NULL REFERENCES imagenes(id),
  orden       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (variante_id, imagen_id)
);

-- Categorias del producto. El orden importa: categorias[0] define el breadcrumb
-- (SPEC §4.3). Los slugs se validan contra categorias.json, no contra una tabla.
CREATE TABLE producto_categorias (
  producto_id     INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  categoria_slug  TEXT    NOT NULL,
  orden           INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (producto_id, categoria_slug)
);

-- Una corrida de scrape. Reemplaza el crudo-{fecha}.json de SPEC §6.3 como
-- registro auditable de "de dónde salió cada producto".
CREATE TABLE scrapes (
  id           INTEGER PRIMARY KEY,
  url          TEXT    NOT NULL,
  estado       TEXT    NOT NULL
               CHECK (estado IN ('corriendo','terminado','abortado')),
  paginas      INTEGER NOT NULL DEFAULT 0,
  hallados     INTEGER NOT NULL DEFAULT 0,
  nuevos       INTEGER NOT NULL DEFAULT 0,
  repetidos    INTEGER NOT NULL DEFAULT 0,
  iniciado_en  TEXT    NOT NULL,
  terminado_en TEXT
);

-- Una ficha que falló. No aborta el scrape (SPEC §6.2, "fallo tolerante").
CREATE TABLE scrape_errores (
  id        INTEGER PRIMARY KEY,
  scrape_id INTEGER NOT NULL REFERENCES scrapes(id) ON DELETE CASCADE,
  url       TEXT    NOT NULL,
  motivo    TEXT    NOT NULL,
  creado_en TEXT    NOT NULL
);

-- Una publicación. Es lo que alimenta el estado visible en el admin (§11.3).
CREATE TABLE publicaciones (
  id            INTEGER PRIMARY KEY,
  estado        TEXT    NOT NULL
                CHECK (estado IN ('pendiente','corriendo','ok','error')),
  disparada_por TEXT    NOT NULL,          -- email de Access
  disparada_en  TEXT    NOT NULL,
  terminada_en  TEXT,
  productos     INTEGER NOT NULL DEFAULT 0,
  run_url       TEXT,                      -- URL del run de GitHub Actions
  commit_sha    TEXT,
  error         TEXT                       -- mensaje en castellano para el admin
);
```

### 5.2 Máquina de estados del producto

Un solo campo, cuatro estados, y cada transición tiene un dueño claro.

```
   scrape / form manual
            │
            ▼
      ┌───────────┐   aprobar (valida)   ┌──────────┐
      │ importado │─────────────────────▶│ aprobado │
      └───────────┘                      └──────────┘
            │                                  │
            │ borrado FISICO                   │ build OK
            │ (nunca fue publico)              ▼
            │                            ┌───────────┐
            │              ┌─────────────│ publicado │
            │              │  eliminar   └───────────┘
            ▼              ▼  (logico)         ▲
        (se va)      ┌────────────┐            │
                     │ eliminado  │────────────┘
                     └────────────┘   restaurar
                           │
                           │ vaciar papelera (>X meses)
                           ▼
                       (se va)
```

| Estado | Qué significa | En `productos.json` | Borrado |
|---|---|---|---|
| `importado` | Entró por scrape o formulario, datos incompletos | **No aparece** | **Físico** |
| `aprobado` | Datos validados, esperando la próxima publicación | Aparece con `activo: true` | **Físico** |
| `publicado` | Salió en al menos un build. Tiene URL en la calle | Aparece con `activo: true` | Solo lógico |
| `eliminado` | Estuvo publicado y se sacó del catálogo | Aparece con `activo: false` | Purga manual (§12.3) |

**`slug` se genera al aprobar, no al importar.** Es el momento exacto en que la
URL empieza a existir. Antes de eso no hay nada que preservar; después, es
inmutable — lo que conserva la regla de `SPEC.md` §6.7: *«un producto ya visto
reusa su `id` aunque el proveedor le haya cambiado el nombre: la URL
sobrevive»*. Renombrar un producto publicado cambia el `nombre`, nunca el `slug`.

**Validaciones para pasar a `aprobado`** (bloquean el botón y explican por qué):

1. `nombre` no vacío.
2. Al menos una categoría, y todos los slugs existen en `categorias.json`.
3. Al menos una variante con al menos una imagen, **o** confirmación explícita
   de publicar sin foto (`SPEC.md` §5.4 lo permite: el producto sigue visible y
   contactable).
4. `precio` es opcional. `NULL` ⇒ «Consultar precio» y sin bloque `offers`
   (`SPEC.md` §7.3).
5. Aviso — no bloqueo — si el precio varía más de ±25 % respecto del anterior.
   Es el chequeo de `SPEC.md` §6.9, movido del `exit code 2` al formulario, donde
   el error se comete.

### 5.3 El código como identidad

#### El `UNIQUE` de la columna NO garantiza la unicidad

Verificado, no supuesto: sobre el esquema 0001 se insertaron `CG85527` y `cg85527` y
**entraron los dos**. SQLite compara `TEXT` con collation `BINARY`, así que para el
`UNIQUE` son valores distintos.

El efecto sería un producto duplicado creado por tipear en minúscula: dos filas, dos
slugs, **dos URLs en la calle** para el mismo producto. Y el peor momento para
descubrirlo es después de publicar, porque el slug ya es inmutable (§5.2).

Se arregla en dos capas, y las dos hacen falta:

| Capa | Qué cubre |
|---|---|
| `normalizarCodigo()` en `admin/src/lib/codigo.ts` | El caso normal, con un mensaje en castellano. §10 pide que ningún error del admin sea crudo |
| Índice único sobre `upper(codigo)` (migración 0002) | Lo que la consulta previa no puede: la carrera entre dos pestañas insertando a la vez, y cualquier camino que olvide normalizar |

Se usó un índice sobre expresión y no un cambio de collation de la columna: SQLite no
permite alterar la collation sin recrear la tabla, y recrear una tabla con datos y
foreign keys apuntándole es mucho más riesgoso que agregar un índice.

**Los espacios de los bordes se recortan, los de adentro se rechazan.** Sacarlos
cambiaría en silencio lo que la persona escribió, y «CG 855 27» es casi siempre un
error de tipeo.

`buscarPorCodigo()` es la pieza que **los dos caminos de alta comparten**: el
formulario manual, que ante un código existente ofrece editar ese producto en vez de
fallar (§9), y el scrape, que hace `UPDATE` y no `INSERT` (§7.5). Devuelve `null` ante
un código inválido en vez de lanzar: buscar es una consulta, no un alta, y que el
formulario explote mientras alguien todavía está tipeando sería peor que no encontrar
nada.


`codigo` es `UNIQUE` global y `NOT NULL`. Tres consecuencias buscadas:

1. **Reemplaza el `manifest.json` de `SPEC.md` §6.7.** La idempotencia del scrape
   la da la restricción `UNIQUE`: un código ya visto se actualiza, no se duplica.
   No hay archivo de estado que se pueda desincronizar.
2. **Es la clave de las operaciones del admin**, incluida la eliminación por
   código del pedido original (§12).
3. **Absorbe el producto manual sin tocar el schema de Astro.** `origen` sigue
   siendo obligatorio en `content.config.ts`; un producto cargado a mano sale
   como `origen: { proveedor: "manual", ref: <codigo> }`.

`UNIQUE` global y no `UNIQUE(proveedor, codigo)`: el catálogo es de una sola
marca (`SPEC.md` §4.2) y un código repetido entre proveedores sería una
ambigüedad para la persona que opera, no un caso a soportar. Si algún día entra
un segundo proveedor con códigos colisionantes, se migra a la clave compuesta y
el admin pide el proveedor además del código.

**El código pasa a ser visible**, corrigiendo el *«no se renderiza»* de
`SPEC.md` §4.2:

- En la ficha, junto al nombre. Un cliente que escribe por WhatsApp citando el
  código es el caso de uso central de este negocio.
- En el índice de búsqueda de la Fase 3 (`SPEC.md` §9.4), como campo nuevo. Hoy
  el índice tiene `i,n,p,c,t`; suma `k` (código). Buscar «CG85527» tiene que
  encontrar el producto.
- En el mensaje pre-armado de WhatsApp, para que del otro lado no haya que
  adivinar de qué producto se habla.

### 5.4 De dónde salen las categorías

Tres cosas distintas, y conviene no confundirlas.

#### a) La lista de categorías: sigue en git

`categorias.json` **no se migra a D1**. Sigue escrito a mano y versionado, como
manda `SPEC.md` §1.3: define orden y visibilidad de la navegación, cambia muy
poco, y es una decisión de curaduría del rol técnico. Hoy tiene 15 entradas: 11
del eje **tipo** (`mochilas`, `carteras`, …) y 4 del eje **uso** (`notebook`,
`dama`, `escolar`, `fiesta`), según `SPEC.md` §4.3.

El admin lo consume **importándolo en tiempo de build** del Worker de admin. Una
categoría nueva es un commit, no una pantalla de administración. Se evita una
tabla que se desincronizaría de `reference('categorias')`, que es lo que hoy
rompe el build ante un slug inválido — y esa red de seguridad no se toca.

#### b) La categoría de origen: NO EXISTE en este camino

**Verificado el 2026-08-03 contra el sitio del proveedor:**

| Página | ¿Trae la categoría del producto? |
|---|---|
| Ficha `/producto/71010-cg85527` | **No.** Sin breadcrumb, sin etiqueta, sin link a `/categoria/…`. Solo el menú global, idéntico en todas las páginas |
| Listado `/lanzamientos/?lz=…` | **No.** Cada card trae código, foto y «Ver detalles y colores» |

Esto **invalida** el campo `categoriaOrigen: { padre, hijo }` del formato `crudo`
de `SPEC.md` §6.3 y toda la tabla de traducción `mapeo/chenson.json` de §6.6: no
hay dato de origen que mapear. La taxonomía del proveedor existe
(`/categoria/1-cartera`, `/categoria/2-mochila`) pero se navega de la categoría
al producto, nunca al revés.

La columna `categoria_origen` de §5.1 se conserva porque un scrape que algún día
entre **por categoría** sí la tendría, pero **por el camino de lanzamientos queda
`NULL`**, y el sistema no debe asumir que está poblada.

#### c) La asignación: la hace la persona que carga

Consecuencia directa de (b). Y es la decisión correcta, no un parche:

**Se descartó crawlear la taxonomía del proveedor** para armar un índice
código→categoría y hacer el join. Es viable (~1.500 productos a 1 req/s ≈ 25
minutos), pero solo autocompletaría el eje de **tipo**. El eje de **uso** no se
deriva de la taxonomía del proveedor **por definición**: `SPEC.md` §4.3 establece
que el aplanado a dos ejes ortogonales es curaduría, *«no del azar»*. Una mochila
porta-notebook para dama pertenece a `mochilas`, `notebook` y `dama` a la vez, y
eso lo decide una persona.

El argumento de fondo: **esa persona ya está editando cada producto.** El origen
no aporta nombre, ni precio, ni descripción (§7.2), así que los tres se escriben
a mano de todos modos. Sumar un desplegable de categorías a un formulario que se
va a llenar igual, con la foto a la vista, cuesta casi nada. Construir un crawler
de taxonomía para ahorrar un click por producto es complejidad que no se paga.

Para que no sea tedioso a escala de un lanzamiento (~64 productos, §7.2):
**asignación de categorías en lote** desde la grilla (§10.3). Los productos de un
mismo lanzamiento suelen ser del mismo tipo.

Si más adelante el volumen lo justifica, el crawl de taxonomía entra como fase
adicional que **prellena** el eje de tipo sin quitarle a nadie la decisión final.

### 5.5 Volcado D1 → `productos.json`

Corre en GitHub Actions (§11.2). Lee vía API HTTP de D1 y produce el JSON con el
mismo contrato de `SPEC.md` §4.4.

```
SELECT productos WHERE estado IN ('aprobado','publicado','eliminado')
```

| Campo del JSON | De dónde sale |
|---|---|
| `id` | `productos.slug` |
| `nombre`, `descripcion`, `precio` | Columnas homónimas |
| `categorias` | `producto_categorias` ordenado por `orden` |
| `variantes` | `variantes` ordenadas por `color` (alfabético, `SPEC.md` §6.6) |
| `variantes[].imagenes` | `{ base: 'catalogo/'‖hash16, anchos: JSON }` |
| `activo` | `estado != 'eliminado'` |
| `actualizado` | `date(actualizado_en)` |
| `origen` | `{ proveedor, ref: codigo }` |

**Determinismo** (`SPEC.md` §6.5): productos ordenados por `id`, claves de cada
objeto en orden alfabético fijo, variantes por `color`, imágenes por `orden`. Dos
volcados de la misma base dan bytes idénticos, así que un build sin cambios
produce `git diff --exit-code` limpio y no genera commits vacíos.

Tras un build exitoso, `aprobado` → `publicado` y se sella `publicado_en`.

---

## 6. Autenticación

**Cloudflare Access sobre el subdominio `.workers.dev` del admin.** Verificado:
está soportado y es gratis hasta 50 usuarios (§3).

- Login por PIN de un solo uso al email. La persona que opera no maneja ninguna
  contraseña, y no hay contraseña que se pueda filtrar.
- La lista de emails autorizados se administra desde el panel de Cloudflare.
- El Worker recibe la identidad en el header `Cf-Access-Authenticated-User-Email`,
  y con eso se llena `publicaciones.disparada_por` — queda registro de quién
  publicó qué.

**No escribimos autenticación propia.** Ni password como secret, ni cookie
firmada, ni manejo de sesiones. Es la superficie de ataque más cara de hacer bien
y acá la resuelve la plataforma.

El Worker **igual valida el JWT de Access** en cada request (`Cf-Access-Jwt-Assertion`
contra el JWKS del equipo). Confiar solo en el header sería confiar en que nadie
puede alcanzar el Worker sin pasar por Access.

#### Cómo se configuró — y por qué no como dice la documentación

Configurado el 2026-08-07. **Los dos caminos documentados no sirvieron**, así que
queda anotado el que sí, porque es exactamente el tipo de cosa que nadie recuerda.

| Camino | Qué pasó |
|---|---|
| El toggle del Worker: *Settings → Domains & Routes → «Enable Cloudflare Access»* (§17) | **Ese botón no existe** en el panel actual. La sección se llama **«Trigger events»**, está vacía, y su único `Add` ofrece Cron triggers y Queues |
| *Zero Trust → Access controls → Applications → Self-hosted* | La documentación exige *«an active domain on Cloudflare»* y `workers.dev` **no es zona propia**. Además Zero Trust se mudó de `one.dash.cloudflare.com` al panel principal |
| **Por API** | ✅ Funciona, y sin pedir dominio |

```
POST /accounts/{cuenta}/access/apps
  { "name": "...", "domain": "ybe-admin.chenson.workers.dev",
    "type": "self_hosted", "session_duration": "24h" }

POST /accounts/{cuenta}/access/apps/{app}/policies
  { "name": "...", "decision": "allow",
    "include": [{ "email": { "email": "..." } }] }
```

Hace falta un API token con **Access: Apps and Policies (Edit)**. El OAuth de
`wrangler` **no sirve**: tiene `workers`, `d1`, `workers_kv`, `queues` y una docena
más, pero ningún scope de Zero Trust.

El equipo lo autogenera Cloudflare al aceptar el plan Free (acá quedó
`old-forest-3a66`).

#### El proveedor de identidad por defecto NO es el PIN

Corregido el 2026-08-14. La versión anterior de esta sección afirmaba que el
proveedor por defecto del equipo era `cloudflare`, «o sea el PIN de un solo uso por
email». **Son dos proveedores distintos y esa equivalencia era falsa.**

| Tipo | Qué hace |
|---|---|
| `cloudflare` | *Login with Cloudflare*: autentica con una cuenta de Cloudflare existente. Trae **«Restrict to account members» activado**, así que solo entran los miembros de la cuenta |
| `onetimepin` | El PIN de un solo uso al email, que es lo que §6 pide |

Desde el 2026-06-18 Cloudflare cambió el default de las organizaciones nuevas de
Zero Trust: antes era `onetimepin`, ahora es `cloudflare`. Este equipo quedó del
lado nuevo.

**El síntoma, cuando falta el `onetimepin`:** se agrega un email a la policy, la
persona intenta entrar y recibe *«Cloudflare sign-in is restricted to members of the
account»*. Es fácil leerlo como un problema de la policy y no lo es — el flujo se
corta en el proveedor de identidad, **antes** de que la policy se evalúe. Mientras
el único proveedor sea `cloudflare`, la lista de emails de la policy es inalcanzable.

Lo que arregla el equipo, y hay que hacerlo una sola vez:

```
POST /accounts/{cuenta}/access/identity_providers
  { "name": "One-time PIN", "type": "onetimepin", "config": {} }
```

Por panel: *Zero Trust → Integrations → Identity providers → Add new identity
provider → One-time PIN*. No pide client id, ni secret, ni redirect URL.

Ojo con el token: este endpoint necesita **Access: Organizations, Identity Providers,
and Groups (Write)**, que es un scope **distinto** del `Access: Apps and Policies
(Edit)` con el que se creó la aplicación.

Y del lado de la aplicación, *Authentication → «Accept all available identity
providers»* tiene que estar en ON. Si los proveedores están fijados a mano, agregar
el `onetimepin` al equipo no alcanza: la aplicación lo sigue ignorando.

**Lo que NO hay que hacer** es agregar a esa persona como miembro de la cuenta de
Cloudflare. Hace desaparecer el error —el proveedor `cloudflare` la aceptaría— pero
al precio de entregar D1, R2, DNS, los Workers y el billing para que alguien cargue
productos. El permiso tiene que alcanzar para la tarea y nada más.

#### Cerrar sesión para probar el acceso de otra persona

```
https://ybe-admin.chenson.workers.dev/cdn-cgi/access/logout
```

La cookie `CF_Authorization` se setea **por dominio de aplicación**. El logout del
team domain (`https://old-forest-3a66.cloudflareaccess.com/cdn-cgi/access/logout`)
responde *«No Access cookie found»* si el login entró por la URL de la aplicación,
que es el caso normal acá.

Eso cierra la sesión de **Access**, no la de la cuenta de Cloudflare: el botón de
*Login with Cloudflare* puede volver a pasar sin preguntar nada. Son dos sesiones,
en dos capas.

**Verificado en tres etapas contra el Worker desplegado**, y las tres importan:

1. **Con las vars vacías: 403 en las ocho rutas probadas**, con el motivo en el
   cuerpo. El admin falla CERRADO, así que se puede desplegar antes de configurar
   Access — que es obligatorio, porque la URL tiene que existir para poder
   protegerla.
2. **Con Access delante: 302 al login** en las siete rutas probadas, incluidos los
   endpoints de API y los assets de imagen. El `meta` del redirect confirma el
   `hostname` y el `aud`.
3. **El sitio público sigue respondiendo 200 sin autenticación.** Access no lo tocó.

---

## 7. Ingesta por scrape

Reemplaza las dos etapas con dos binarios de `SPEC.md` §6.1. La separación que
esa sección defendía — red frágil por un lado, transformación determinista por el
otro — se conserva, pero el límite ahora es **el registro en D1**: el scrape
escribe filas en estado `importado`, y la normalización y curaduría ocurren
después, sobre datos ya guardados. Re-normalizar no vuelve a golpear al
proveedor, que era el punto.

### 7.1 El bucle vive en el navegador

El admin pega la URL de listado, por ejemplo
`https://www.chenson.com.py/lanzamientos/?lz=2026-07-16`. A partir de ahí:

```
navegador                            worker de admin              proveedor
   │                                       │                          │
   ├── POST /api/scrape/listado ──────────▶│── GET pagina 1 ─────────▶│
   │◀── { fichas[], siguiente } ───────────┤                          │
   │                                       │                          │
   ├── POST /api/scrape/ficha (x N) ──────▶│── GET ficha ────────────▶│
   │     (1 por segundo, secuencial)       │── GET imagenes ─────────▶│
   │◀── { codigo, colores, imagenes } ─────┤── INSERT D1, PUT R2      │
   │                                       │                          │
   └── repite con `siguiente` hasta que no haya mas paginas
```

**Por qué el navegador orquesta y no el servidor:**

1. **El progreso es visible.** «Página 3 de 7 · 42 productos · 2 errores» en
   pantalla. Para una persona no técnica, un scrape sin progreso visible es
   indistinguible de uno colgado.
2. **La granularidad es gratis de cambiar.** Si una ficha no entra en 10 ms de
   CPU, se parte en un request por color sin tocar infraestructura (§7.3).
3. **Un fallo es accionable en el momento**, no un mensaje en una cola muerta.
4. **Cero infraestructura extra.** Sin Queues, sin Workflows, sin Durable Objects.

**Costo asumido:** la pestaña tiene que quedar abierta. Si se cierra a mitad de
camino, el scrape queda incompleto — y como cada ficha se confirma
individualmente en D1, no se pierde lo ya hecho: se vuelve a correr y sigue
(§7.5).

**Salida de escape documentada, no construida:** si algún día hay que scrapear el
catálogo completo (~1.500 modelos, ~25 minutos con la cortesía de §7.4), Queues
ya está en el free tier con 10.000 operaciones diarias y permite el
fire-and-forget. No se hace en v1 porque el caso real es una página de
lanzamientos, que son decenas de productos y termina en minutos.

### 7.2 Endpoints

| Endpoint | Qué hace |
|---|---|
| `POST /api/scrape/listado` | Recibe `{ url, scrapeId? }`. Sirve las dos clases de listado —`/lanzamientos` y `/categoria/…`—. Devuelve URLs de fichas, las páginas que **esta** página enlaza y, si la categoría lo declara, cuántos productos tiene. Crea la fila en `scrapes` si es la primera página |
| `POST /api/scrape/ficha` | Recibe `{ scrapeId, url }`. Extrae código, colores hermanos y categoría de origen, y **registra en D1**. Devuelve las URLs de las fotos de cada color. **No toca R2** |
| `POST /api/scrape/imagen` | Recibe `{ sku, url }`. Baja la foto del proveedor y hashea los bytes originales. Si el hash ya existe, la vincula y termina. Si es nueva, **devuelve los bytes crudos** |
| `POST /api/scrape/vincular` | Recibe `{ sku, hash16 }`. Ata una imagen ya subida a su variante |
| `POST /api/scrape/cerrar` | Marca el `scrape` como `terminado` (o `abortado`) y devuelve el resumen |

#### Por qué `ficha` no sube imágenes — costura corregida el 2026-08-06

La versión anterior de esta tabla decía que `/api/scrape/ficha` *«hashea, guarda en
D1 y sube a R2 lo nuevo»*. **No puede**, y lo contradecía §8.1 en la misma spec: no
hay `sharp` en Workers, así que el que deriva `w300`/`w600` es el `<canvas>` del
navegador. Pero el navegador tampoco puede bajar la foto del proveedor — es otro
origen y no hay CORS.

El reparto real necesita dos endpoints más:

1. `ficha` registra la estructura y devuelve las URLs de las fotos.
2. `imagen` hace de **puente**: baja del proveedor y hashea el ORIGINAL. Si ya lo
   conoce, corta ahí y la foto no viaja — es lo que hace barato repetir una corrida.
3. El navegador deriva con canvas y sube a `POST /api/imagenes`, que registra el
   **contenido**.
4. `vincular` dice **de quién es**. Va aparte porque la misma foto puede pertenecer
   a variantes de productos distintos, que es el dedupe de `SPEC.md` §6.8.

Es, además, el escalón 2 de la escalera de mitigación de §7.3 — «un request por
imagen para el hash y la subida, separado del parseo» — aplicado no por CPU sino
porque el Worker no puede redimensionar.

La unidad de `/api/scrape/ficha` es el **modelo**, no la página: el bloque de
colores de una sola ficha ya revela todos los colores hermanos (`SPEC.md` §2.3),
así que no hace falta recorrer el catálogo dos veces. Las fichas de los colores
hermanos se marcan como visitadas y no se vuelven a pedir.

#### Estructura del origen — verificada el 2026-08-03

| Dato | Dónde está | Notas |
|---|---|---|
| **Paginación del listado** | `?lz={fecha}&page={N}` | Links numerados más flecha `»`. **16 productos por página.** El lanzamiento del 2026-07-16 tiene 4 páginas ⇒ ~64 productos por tanda |
| Código | Card del listado y encabezado de la ficha | `CG86003`. Identidad (§5.3) |
| URL de ficha | `/producto/{idColor}-{codigo}` | Ej. `/producto/71803-cg86003` |
| Colores hermanos | Sección «Colores Disponibles» de la ficha | Link y nombre con prefijo `(X)`. **Presente también en fichas alcanzadas desde lanzamientos** (verificado sobre `/producto/71803-cg86003`) |
| Imágenes | `/Prelude-images/product/{80hex}.jpg` | Los `src` traen **puerto explícito** `:443`. Hay que normalizar con `new URL()`; comparar strings crudos duplicaría cada imagen |
| Nombre del color | **`title` de la miniatura** del hermano | `img title="(A) VERDE OSCURO"`. El `<a>` trae `title="Ver en este color"` |
| **Color de la ficha abierta** | **`og:title` y `<title>`** | `Producto: {CODIGO} ({X}) {NOMBRE}`. **NO está en el bloque de colores.** Ver abajo |
| **Foto de cada color hermano** | El `src` de esa misma miniatura | **600 × 600, el mismo archivo que sirve su propia ficha.** Ver abajo |
| Nombre comercial | **No existe** | El título es el código. `SPEC.md` §2.3 confirmado |
| Precio | **No existe** | Portal de revendedores, detrás de login. `SPEC.md` §2.3 confirmado |
| Descripción / medidas | **No existe** | El rótulo «Medidas aprox. (alto x largo x ancho):» está en la plantilla, pero **la celda del valor viene vacía** en las 2 fichas verificadas. `SPEC.md` §2.3 confirmado |
| Categoría | **No existe en la ficha ni en el listado** | §5.4b. Corrige `SPEC.md` §6.3 |

**No hay nada que prellenar.** El origen aporta estructura, colores e imágenes; el
nombre, el precio, la descripción y la categoría los escribe una persona. Es
justamente lo que hace razonable pedirle también la categoría (§5.4c): ya está
frente al formulario.

#### El color de la propia ficha sólo está en el título — medido el 2026-08-06

**Ausente de la spec hasta acá, y omitirlo perdía un color por modelo.**

El bloque de colores de una ficha lista **únicamente a los hermanos**: la ficha
abierta no se enlaza a sí misma. Sobre `/producto/71163-cg85700` se ven
`(T) MARRON CLARO` y `(B) MARRON`, y en ningún lado el `(3) NEGRO` que es el color
que estás mirando.

El único lugar donde aparece es el título:

```html
<meta property="og:title" content="Producto: CG85700 (3) NEGRO">
<title>Producto: CG85700 (3) NEGRO</title>
```

Verificado sobre 5 fichas reales. El formato es `Producto: {CODIGO} ({X}) {NOMBRE}`,
y el código del título se compara con el de la URL: un título de otro código no
aporta color.

**El síntoma de no hacerlo es silencioso y engañoso**: de un modelo de 3 colores
entran 2, y el que falta es SIEMPRE el que estabas mirando. Sin ningún error.

#### La foto del color hermano ya viene en la ficha visitada — medido el 2026-08-07

**Ausente de la spec, y omitirlo dejaba sin imagen a todos los colores menos uno.**

La imagen del bloque de colores **no es una miniatura de baja resolución**. Es el
mismo archivo que sirve la ficha propia del hermano: mismo hash de 80 hex, mismo
peso al byte. Medido sobre `/producto/71163-cg85700`:

| Color | Archivo | Medidas | Bytes | ¿Igual al de su ficha? |
|---|---|---|---|---|
| `(3) NEGRO` (propio) | `fa9b2d5d…jpg` | 600 × 600 | 124 472 | — |
| `(T) MARRON CLARO` | `0a3e8919…jpg` | 600 × 600 | 115 561 | **Sí** |
| `(B) MARRON` | `a6d21d08…jpg` | 600 × 600 | 127 913 | **Sí** |

**Consecuencia de diseño, y es la buena:** no hay que visitar la ficha de cada
hermano. Un modelo de N colores sigue costando **una** ficha, y todos sus colores se
quedan con su foto. Ir a buscarlas de a una habría multiplicado por N el tráfico al
proveedor para traer bytes que ya estaban en la mano.

**El síntoma de no hacerlo** — que es cómo se encontró — es que se importa el
modelo, aparecen sus tres colores en la grilla, y sólo el de la ficha visitada tiene
imagen.

Ojo con la dirección de la regla: la foto del hermano es **del hermano**. No entra
a la galería de la ficha actual, porque le colgaría a esa variante la foto del color
equivocado, y eso llega hasta el cliente que pide por WhatsApp.

#### El listado enlaza OTROS lanzamientos: hay que filtrar por `lz`

La página de un lanzamiento enlaza también los anteriores (`?lz=2026-07-14`,
`?lz=2026-06-10`…). Seguir esos enlaces convierte «importar la tanda del 16 de
julio» en «importar el catálogo entero» sin que nadie lo haya pedido — unos 1.500
modelos a un request por segundo.

La regla: una URL de paginación cuenta **sólo si su `lz` es el mismo** que el de la
página que se pidió.

Y hay una trampa de identidad al contar páginas: quien opera pega
`?lz=2026-07-16`, **sin `page`**, y la paginación de esa misma página se enlaza a sí
misma como `?lz=2026-07-16&page=1`. Son dos strings distintos y la misma página. Sin
normalizar —`page` ausente ≡ `page=1`— la primera página se pide **dos veces** y sus
fichas se cuentan dos veces en el progreso.

#### Importar una categoría: la paginación es una VENTANA DESLIZANTE — medido el 2026-08-26

Un lanzamiento no alcanza para poblar el catálogo: son las novedades de una fecha, y
el proveedor tiene ramas enteras que nunca pasaron por una tanda importada. La segunda
puerta de entrada es la categoría —`/categoria/1-cartera`—, que se recorre con el mismo
bucle, el mismo paso de un pedido por segundo y la misma opción de saltear lo que ya
está en el catálogo.

Lo que **no** es igual es qué acota el recorrido. Un lanzamiento se acota por su `lz`;
una categoría se acota por su **ruta**, porque la página enlaza todas las demás
categorías en el menú y sus subcategorías y filtros (`?f=collection--16`) en la barra
lateral. Una subcategoría es una categoría más angosta: se recorre si es la que se
pidió, y no por colgar de la que se pidió.

Y acá está el hallazgo que importa. **La paginación de una categoría no enlaza todas
sus páginas.** Medido sobre `/categoria/1-cartera`, que tiene 431 productos en 36
páginas de 12:

| Página pedida | Páginas que enlaza |
|---|---|
| 1 | 1 … 6 |
| 6 | 1 … 11 |
| 36 | 31 … 36 |

El recorrido llega igual, y no por suerte: la cola del navegador se **resiembra con
cada respuesta** (§7.1), así que avanza 1→6, 6→11, 11→16 hasta el final. Lo que se
rompe sin más datos es el **denominador del progreso**: sacado de la primera página
diría «página 5 de 6» con un séptimo del trabajo hecho, y quien mira cerraría la
pestaña convencido de que estaba terminando. Un progreso que miente es peor que no
tener progreso, porque se le cree.

De ahí sale la regla: el encabezado de la categoría declara el total
(`<p>431 Productos</p>`) y las páginas se **estiman** como `total ÷ tamaño de página`,
donde el tamaño es el **mayor** visto y no el último —la última página trae 11 y no 12,
y estimar con ella daría 40 páginas—. La ventana de la paginación queda como **piso**:
un total mal contado por el proveedor no puede hacer que el progreso diga que terminó
mientras el sitio sigue enlazando páginas.

Dos trampas más, medidas, que no muerden hoy pero muerden a quien toque esto después:

- Pedir una página **pasada del final** no da error ni vacío: `?page=37` devuelve la 36
  idéntica. Hoy no llega nadie ahí porque ninguna página real la enlaza — pero un bucle
  que cuente números en vez de seguir enlaces no termina nunca.
- `/lanzamientos` sirve el **mismo** encabezado con el `<p>` vacío. Por eso «no declara
  total» es `null` y no `0`: el denominador tiene que distinguir «no lo sé» de «no hay
  ninguno» antes de dividir.

#### Las tres clases de imagen — y por qué confundirlas rompe el scrape

**Hallazgo del spike de Fase 2.0**, y el más importante de todo el análisis.

Una ficha lista imágenes de `/Prelude-images/product/` que **no son todas del
producto**. Medido sobre 3 corridas de `/producto/71803-cg86003`:

| Clase | Cómo se reconoce | Cantidad | Estable entre corridas |
|---|---|---|---|
| **Foto del producto** | `alt="product-thumb"` | 1 | **Sí** |
| Miniatura de otro color | `img` dentro de un `<a>` al mismo código | 1 | Sí |
| **Recomendado del carrusel** | `alt` = el código de OTRO producto (`CG85401`, `CG85099`…) | 4 | **No: cambian en CADA request** |

```
run1: f6ed711a  463dc121  bc032531  572d329e  90361af8
run2: f6ed711a  fa1634ba  773c3505  1459c4f4  56819bee
run3: f6ed711a  1db8ebdb  65bcdb05  d8dda153  a4f92ab0
      ▲ estable  └──────── rotan en cada pedido ────────┘
```

**Un selector `img[src*="/Prelude-images/product/"]` importa las tres clases.**
Consecuencias, todas silenciosas — ningún error, ningún log:

1. Cada corrida adjunta 4 fotos ajenas **distintas** ⇒ **la idempotencia de §7.5
   se cae**, y con ella el `git diff --exit-code` que la verifica.
2. La miniatura del hermano le cuelga **la foto del color equivocado** a la
   variante, y eso llega hasta el cliente que pide por WhatsApp.
3. Se suben a R2 imágenes de productos que no son de este catálogo.

**Regla: solo `alt="product-thumb"` es foto del producto.** Es la etiqueta que el
propio sitio le pone a sus imágenes de galería, así que es semántica y no
depende de contenedores ni de posiciones.

Se descartó una hipótesis intermedia — «un recomendado siempre cuelga de un `<a>`
a otro producto» — porque **se midió y era falsa**: los recomendados no están
dentro de un enlace de producto.

La misma imagen aparece dos veces en la galería (normal y con
`class="magniflier"` para el zoom), así que la colección debe ser un `Set`.

`CG86003` tiene **una sola** foto de producto. El diseño no puede asumir varias.

#### Los colores hermanos se detectan por URL, no por markup

`SPEC.md` §2.3 especifica el selector `#other-colors-tbl`. **Sobre
`/producto/71803-cg86003` — alcanzada desde lanzamientos — el bloque existe pero
rotulado «Colores Disponibles», y ese `id` no se pudo confirmar.**

El extractor **no depende de ningún `id` ni clase**. Regla:

> Todo `<a href>` que matchee `/producto/{digitos}-{codigo}` con el **mismo
> código** que la ficha actual es un color hermano.

La agrupación por modelo está en la estructura de la URL, que es el contrato más
estable que expone el sitio — `SPEC.md` §6.3 ya lo reconoce al derivar `codigo`
del segmento de URL *«que es lo más estable que expone el sitio»*. Un selector de
markup se rompe con el próximo rediseño; el patrón de URL, no.

**Y si igual se rompiera**, la red de seguridad ya está en el esquema:
`productos.codigo UNIQUE` (§5.3). Los colores que entren como fichas separadas se
agrupan solos en el `UPSERT` — el segundo y el tercero encuentran el producto ya
creado y se suman como variantes. La agrupación es un efecto de la restricción, no
código que dependa del parseo. El único costo sería pedirle al proveedor las
fichas hermanas en vez de saltearlas.

Extracción con **`HTMLRewriter`**, que es streaming y nativo del runtime — no se
carga el DOM completo en memoria ni se suma una dependencia de parseo.

### 7.3 Presupuesto de CPU y subrequests

**El riesgo número uno de esta etapa.** Se mide antes de construir el resto.

Por invocación de `/api/scrape/ficha`, con un modelo de 3 colores y 2 fotos cada
uno:

| Recurso | Consumo **medido** | Límite | Notas |
|---|---|---|---|
| Subrequests, solo parseo | **1** | 50 | — |
| Subrequests, parseo + hash | **2** en las 3 fichas probadas | 50 | 1 ficha + 1 foto de galería. Muy holgado |
| Bindings D1 / R2 | sin medir | 50 | Se asume que no son subrequests `fetch`. **A confirmar** (§16) |
| CPU, 1 parseo + 1 hash | **entra, con margen ~5×** | **10 ms** | Medido sobre el Worker desplegado. Ver abajo |

**Las fotos pesan más de lo estimado.** Medido: 115,7 KB · 115,6 KB · 183,9 KB.
La estimación previa de ~50 KB por imagen era del **archivo ya convertido a WebP**,
no del JPEG de origen. No cambia ninguna conclusión de costo — R2 son 10 GB
gratis y el egress es gratis — pero sí el peso del viaje por el navegador de §8.2:
son ~180 KB de bajada por imagen nueva, no ~50 KB.

#### La medición de CPU — resuelta el 2026-08-03

No se puede medir con `Date.now()` (§14, Fase 2.0). Se midió **repitiendo la
extracción N veces sobre el mismo HTML ya bajado**, lo que multiplica solo el CPU:
el N más alto que sobrevive es el margen en múltiplos del caso real.

| Parseos por invocación | Sin hash | Con hash de 115 KB |
|---|---|---|
| 1 (**el caso real**) | 5/5 ✅ | **5/5 ✅** |
| 3 | 5/5 ✅ | 5/5 ✅ |
| 5 | 5/5 ✅ | 4/5 ⚠️ |
| 8 | 0/5 ❌ | 0/5 ❌ |
| 12 · 20 | 0/5 ❌ | 0/5 ❌ |

Al excederse, el runtime devuelve **HTTP 503 con `error code: 1102`** —
«Worker exceeded CPU time limit». Ese error confirma además que **la cuenta está
en el plan Free**: en Paid el techo es de 30 s y ningún N de esta tabla moriría.

**Conclusiones:**

1. **Un modelo por invocación entra, con margen ~5×.** La granularidad de §7.2 —
   una ficha por request — es correcta. **No hace falta Workers Paid.**
2. **El hash es casi gratis.** Las dos columnas son equivalentes: el presupuesto
   se lo lleva `HTMLRewriter` sobre ~57 KB de HTML, no `crypto.subtle`. Hashear
   más imágenes agrega red, no CPU.
3. **Margen ~5×, no 50×.** Es cómodo pero no infinito: **prohibido parsear varias
   fichas en una sola invocación**, o encadenar el listado más sus fichas. Una
   página por request, siempre.
4. La cifra es conservadora: el bucle de medición construye un `Response` por
   iteración, que el código real no hace, y el acumulador de texto del spike
   (~27 KB más regex) desaparece en la Fase 2.5 al usar un selector concreto.

**Una sola corrida de esta medición miente.** El primer intento reportó que 25
parseos sobrevivían y a los pocos minutos 20 morían. La varianza entre isolates y
colos es real: sin repeticiones se habría documentado un margen 5 veces mayor que
el verdadero, y sobre ese número se habrían tomado decisiones de granularidad.

**Mitigación si en algún momento no alcanza**, en orden de aplicación:

1. Un request por **color** en vez de por modelo.
2. Un request por **imagen** para el hash y la subida, separado del parseo.
3. Recién si nada alcanza: Workers Paid ($5/mes, 30 s de CPU). Última opción.

Como el bucle lo maneja el navegador, pasar de (1) a (2) es cambiar un `for`.
Esa es la ventaja concreta de haber puesto la orquestación del lado del cliente.

### 7.4 Cortesía con el proveedor

Se conservan íntegras las reglas de `SPEC.md` §6.2:

- **`robots.txt` primero.** Se pide una vez al iniciar el scrape y se respetan
  sus exclusiones. `SPEC.md` §2.3 midió que hoy devuelve 404 — sin exclusiones
  declaradas — pero el chequeo se hace igual, y si algún día aparece, se acata.
- **1 request por segundo, secuencial, sin concurrencia.** El paso lo marca el
  navegador. Sin excepciones, aunque el free tier permita más.
- **User-Agent identificable**, no uno falseado de navegador.
- **Fallo tolerante.** Una ficha que no se pudo leer va a `scrape_errores` y no
  aborta la corrida.

### 7.5 Idempotencia y reanudación

Sin `manifest.json` (§5.3), la idempotencia sale de las restricciones de la base:

| Qué se repite | Qué lo evita |
|---|---|
| Un modelo ya importado | `productos.codigo UNIQUE` ⇒ `UPDATE`, no `INSERT` |
| Una variante ya existente | `variantes.sku UNIQUE` |
| Una imagen ya subida | `imagenes.hash16 UNIQUE` ⇒ no se procesa ni se sube |
| Una ficha ya visitada en esta corrida | El **navegador** la saltea por `codigo` antes de pedirla. El servidor también corta, pero recién después de bajarla: para cuando se entera, el request al proveedor ya salió |

**Nunca se pisa curaduría.** Un `UPDATE` sobre un producto en estado `aprobado`,
`publicado` o `eliminado` toca únicamente los campos de origen —
`categoria_origen`, `url_origen`, variantes e imágenes nuevas — y **jamás**
`nombre`, `descripcion`, `precio`, `slug` ni `estado`. Es la regla
de `SPEC.md` §6.9 (*«`activo` nunca se sube pisando una ocultación manual»*)
generalizada: **el scrape aporta estructura; las personas aportan decisiones, y
el scrape no las revierte.**

Un color nuevo del proveedor entra como variante nueva y **el producto queda
marcado con un aviso en el admin** — «este producto cambió en el origen» — para
que se revise. No se autopublica un color que nadie miró.

Ese aviso es la columna `productos.cambio_en_origen` de §5.1, que **no existía en el
esquema original**: la regla estaba escrita acá y no había dónde guardarla. La agrega
la migración `0003`. Es una fecha y no un booleano —así la revisión se puede ordenar
por antigüedad— y se limpia cuando una persona revisa el producto, **no cuando se
publica**: publicar sin mirar es exactamente lo que el aviso existe para evitar.

---

## 8. Pipeline de imágenes

### 8.1 El navegador reemplaza a `sharp`

`sharp` no corre en Workers (§3.1). La alternativa no es resignar el
procesamiento: es moverlo al único lugar del sistema que ya tiene un motor de
imágenes completo y gratis, **el navegador**, vía `<canvas>`.

```
POST /api/scrape/imagen  { sku, url }
   │
worker: GET imagen del proveedor        ← el navegador no puede: otro origen, sin CORS
   │
   ├── SHA-256 de los BYTES ORIGINALES  ──▶ ¿hash16 ya en D1?
   │                                            │ si ⇒ vincular, fin. NO viaja
   │                                            │ no ⇓
   ├── devuelve los bytes crudos (hash en el header X-Hash16)
   │
navegador: canvas
   ├── encaja en cuadrado, rellena con blanco (SPEC §5.3, §6.10)
   ├── nunca amplia (SPEC §5.5)
   ├── exporta w600 y w300 en WebP q82
   │
   ├── POST /api/imagenes ──────▶ PUT R2 catalogo/{hash16}/w{300,600}.webp
   │                              (registra el CONTENIDO)
   └── POST /api/scrape/vincular  (dice de QUIEN es)
```

**El corte del hash es lo que hace barato repetir una corrida.** Una foto ya conocida
muere en el Worker y no viaja: ni bajada al navegador, ni derivadas, ni subida.

**El navegador verifica el hash que le devuelve `/api/imagenes` contra el `X-Hash16`
del Worker.** Los dos se calcularon sobre los mismos bytes con el mismo algoritmo, así
que una diferencia significa que el cuerpo llegó cortado. Sin ese corte la foto se
guardaría bajo una clave que el Worker nunca vio: el dedupe se rompe y R2 junta
duplicados, en silencio y para siempre.

**El encuadre del scrape NO es el del alta manual.** Acá la imagen entra **entera** y
lo que sobra se rellena de blanco. El recorte cuadrado centrado de §8.3 es para fotos
de celular; aplicado a una foto del proveedor le corta los costados al producto — un
sillón de 800 × 600 pierde los apoyabrazos — y nadie está mirando cuando pasa, porque
el scrape corre solo.

#### En desarrollo, las miniaturas se leen del R2 local

En `astro dev` el binding `IMAGENES` es un bucket de **miniflare** que vive en
`.wrangler/state/`, pero `PUBLIC_R2_BASE` apunta al dominio público del bucket de
Cloudflare. Se escribe en un lado y se lee del otro, así que todo lo recién subido da
404.

El admin resuelve eso con `GET /img-dev/catalogo/{hash16}/w{300,600}.webp`, que lee
del binding y **sólo existe en desarrollo**. En producción las imágenes las sirve el
dominio público del bucket con su `Cache-Control` inmutable (§5.1): dejar la ruta viva
ahí sería una segunda URL para el mismo contenido y egress a través del Worker por
algo que R2 ya entrega gratis.

La validación de la clave no es opcional: el endpoint lee del bucket con lo que llega
por URL, así que sin ella cualquier objeto sería descargable por su nombre.

**El hash se calcula sobre los bytes originales, en el Worker.** No sobre el WebP
que produce el navegador. Es deliberado: el encoder WebP varía entre navegadores
y versiones, así que hashear la salida daría hashes distintos según quién cargue
y **rompería el dedupe y la idempotencia**. Manteniendo el hash anclado al
original se preserva exactamente `SPEC.md` §6.8: *«SHA-256 del byte stream
original»*, y el hash nunca se infiere del nombre de archivo (`SPEC.md` §2.2-7).

### 8.2 Lo que esto recupera

Creí que sin `sharp` había que resignar las derivadas y servir el original. No es
así — y el resultado es **mejor que el diseño original**:

| | `SPEC.md` v1 (sharp) | Etapa 2 (canvas) |
|---|---|---|
| Formato de salida | WebP q82 | **WebP q82** ✅ igual |
| Derivadas | `w300` + `w600` | **`w300` + `w600`** ✅ igual |
| Relleno a 1:1 con blanco | Sí | **Sí** ✅ igual |
| Nunca amplía | `withoutEnlargement` | **Regla explícita** ✅ igual |
| Dedupe por hash del original | Sí | **Sí** ✅ igual |
| Dónde corre | Node local | Navegador |
| Dependencia nativa | `sharp` | **Ninguna** |

**`src/` no se toca.** `content.config.ts` (regex `catalogo/{16 hex}`, `anchos`
de 300/600), `imagenes.ts:79` (`${imagen.base}/w${ancho}.webp` hardcodeado) y
`srcSetImagen()` siguen siendo válidos sin editar una línea. La afirmación se
verificó leyendo los archivos, no se asumió.

El contrato de `SPEC.md` §5.2 y §5.5 queda intacto:

| Lado mayor del origen | Se genera |
|---|---|
| ≥ 600 px | `w300` + `w600` |
| 300–599 px | solo `w300` |
| < 300 px | nada ⇒ placeholder de `SPEC.md` §5.4 |

**Costo asumido:** los bytes de cada imagen nueva hacen un viaje de ida y vuelta
por el navegador (~50 KB baja + ~70 KB sube entre las dos derivadas). Para una
página de lanzamientos son unos pocos MB. El egress de R2 es gratis y el tráfico
al proveedor es el mismo que tendría cualquier scraper. Una imagen ya conocida
por su hash no viaja: se corta antes, en el Worker.

**Marca de agua:** se publica tal cual. `SPEC.md` §5.6 sigue vigente sin cambios
— no se borra, no se tapa, no se recorta la banda inferior.

### 8.3 Carga manual de imágenes

El mismo pipeline, sin el paso de red. La persona elige un archivo, el navegador
lo normaliza con el mismo código de canvas y sube las derivadas.

Con una diferencia que el scrape no necesita: **recorte**. Una foto de celular son
4000×3000 y aspect ratio arbitrario; encajarla en 1:1 con relleno blanco automático
suele dejar el producto chico y descentrado.

**Resuelto con recorte cuadrado centrado automático. El recorte asistido —arrastrar y
escalar el cuadro— queda descartado por ahora** (decisión del 2026-08-06).

El razonamiento: lo que esta sección atacaba era el **relleno blanco**, y el recorte
centrado no lo usa — toma el cuadrado más grande que entra y *llena* el cuadro, así
que el producto nunca sale chico rodeado de blanco. Lo único que no cubre es un
producto **descentrado en la foto**, y eso se arregla del lado más barato: encuadrando
al sacar la foto, no construyendo una pantalla de arrastre.

Si algún día hace falta, el costo es sólo la interacción: `calcularEncuadre()` ya
acepta un recorte arbitrario y está cubierto por tests, incluido el caso de un recorte
más chico que 300 px, que no genera derivadas porque ampliar inventaría píxeles.

El hash acá sí se calcula sobre el archivo original elegido, en el navegador
(`crypto.subtle`), y se manda junto con las derivadas.

**Son dos encuadres distintos, no uno con parámetros.** La carga manual recorta un
cuadrado centrado; el scrape encaja la imagen entera y rellena (§8.1). Compartir una
sola función con el default puesto en «recortar» le cortaba los costados a las fotos
del proveedor, sin que nadie lo viera, porque el scrape corre solo.

---

## 9. Carga manual de un producto

Formulario de alta que produce exactamente la misma fila que el scrape, en estado
`importado`, con `proveedor: 'manual'`.

| Campo | Regla |
|---|---|
| Código | **Obligatorio.** Único. Es la identidad (§5.3). Si ya existe, el formulario ofrece editar ese producto en vez de fallar |
| Nombre | Obligatorio para aprobar |
| Descripción | Opcional |
| Precio | Opcional. Vacío ⇒ «Consultar precio» |
| Categorías | Al menos una, del listado de `categorias.json` |
| Variantes | Al menos una. Color obligatorio. **El hex no se carga desde el admin**, ver abajo |
| Fotos | Por variante, con el recorte de §8.3. Cero fotos es válido: se publica con placeholder |

El SKU se arma como `{codigo}-{slug(color)}`, siguiendo la regla de `SPEC.md`
§6.6 para colores sin prefijo del proveedor. Nunca un índice posicional: agregar
un color no mueve los SKU existentes.

#### El `color_hex` no se carga desde el admin — decidido el 2026-08-07

El formulario tenía un `<input type="color">` rotulado «Color en pantalla · Opcional».
**Se retiró de las dos pantallas (alta y edición) y también del camino de escritura.**

El motivo es que la promesa era imposible de cumplir: **`<input type="color">` no
tiene estado vacío.** Siempre devuelve un color. Y `SPEC.md` §6.6 —repetido en el
comentario de la columna en §5.1— dice que `color_hex` es `#rrggbb` **o NULL, y nunca
se inventa**. Las dos cosas no pueden ser ciertas a la vez.

En la práctica: el scrape nunca escribe esa columna, así que todo lo importado queda
en NULL. Al abrir un producto importado para ponerle nombre y precio, el formulario
mandaba el default del input para **todos** sus colores, y el sitio público dibujaba
una bolita de ese color al lado de cada uno. Un dato que nadie eligió, presentado como
si alguien lo hubiera elegido.

Sin valor, el selector de variante del sitio **cae a botón con texto**, que es lo que
`SPEC.md` §4.2 ya preveía. No se pierde nada que estuviera funcionando.

Sacar sólo el input no alcanzaba: el `UPDATE` de la edición escribía la columna en
cada guardado, así que un formulario que dejara de mandarla habría **borrado en
silencio** los valores ya cargados. El `UPDATE` toca ahora únicamente el orden.

**Queda pendiente y asumido:** hoy no hay forma de asignar un color de pantalla a un
producto nuevo. Los que ya lo tienen lo conservan. Si algún día hace falta, el control
tiene que tener un estado vacío de verdad — un campo de texto validado o una paleta
con opción «sin color», no un `type="color"`.

---

## 10. El admin, pantalla por pantalla

Cinco pantallas. El criterio transversal: **todo mensaje en castellano, ningún
código de error crudo, y ninguna acción destructiva sin confirmación que diga qué
va a pasar.**

### 10.1 Inicio

Estado del catálogo de un vistazo, y el estado de la última publicación (§11.3).

```
┌──────────────────────────────────────────────────────────┐
│  Catálogo                                                │
│                                                          │
│   142 publicados     8 aprobados sin publicar            │
│    23 por aprobar     4 eliminados                       │
│                                                          │
│  ✓ Publicado hace 2 horas · 8 productos                  │
│                                                          │
│  [ Importar desde el proveedor ]  [ Cargar un producto ] │
└──────────────────────────────────────────────────────────┘
```

«8 aprobados sin publicar» es el llamador a la acción: hay trabajo listo que no
está en el sitio.

### 10.2 Importar desde el proveedor

Un campo para la URL, y progreso en vivo mientras el bucle de §7.1 corre.

```
URL del listado:  [ https://www.chenson.com.py/lanzamientos/?lz=... ]
                  [ Importar ]

Página 3 de 7 · 42 fichas leídas · 38 productos nuevos · 2 con error
[████████████░░░░░░░░░░░░]  no cierres esta pestaña

  ⚠ 2 fichas no se pudieron leer          [ ver detalle ]
```

El aviso de no cerrar la pestaña es explícito porque es una restricción real del
diseño (§7.1), no un detalle de implementación que se pueda esconder. Va además un
`beforeunload`: el cartel no alcanza cuando alguien ya decidió cerrar.

Al terminar: resumen con nuevos, repetidos y errores, y un botón directo a la
grilla filtrada por «por aprobar». **Los números del resumen salen de la base, no
del contador de la pantalla** — si los dos no coinciden, el que manda es el que
quedó guardado.

**La guarda de «ya hay una importación en curso» se renderiza del lado del
servidor**, no sólo como el 409 del endpoint. Enterarse de que no se puede importar
DESPUÉS de pegar la URL y apretar el botón es enterarse tarde. Y cerrar la corrida
anterior es un `<form>` y no un `fetch`: es lo único de esta pantalla que puede
funcionar sin JavaScript, así que funciona.

Cancelar deja la corrida en `abortado`, que no es un error: lo que ya entró queda,
porque cada ficha se confirmó individualmente (§7.1), y volver a correr el scrape
sigue desde donde estaba.

**Esta pantalla necesita JavaScript y lo dice.** El bucle vive en el navegador a
propósito (§7.1) y el `<canvas>` es el motor de imágenes (§8.1): no hay una versión
degradada honesta que ofrecer, así que en vez de un formulario que promete algo que
no puede cumplir hay un `<noscript>` que explica por qué.

#### Dónde vive cada decisión

El bucle corre en el navegador, así que decisiones que en otro diseño tomaría un
servidor —a qué página ir, qué ficha saltear, cuándo esperar, qué dice el renglón de
progreso— las toma código de cliente. Y ese código no se puede testear con
`node --test` si además hace `fetch` y toca el DOM.

Misma división que sostiene el extractor frente al envoltorio de `HTMLRewriter`
(§7.2): **todo lo que decide vive en un módulo puro con tests**, y en el archivo del
navegador queda sólo `fetch`, DOM y canvas.

Con una consecuencia que no es obvia: **el corte de fichas ya visitadas tiene que
estar en el cliente.** El servidor también corta por código, pero lo hace después de
bajar la ficha — cuando se entera, el pedido al proveedor ya se hizo. El único filtro
que le ahorra tráfico de verdad es el del navegador, y por eso la cortesía de §7.4
depende de él.

### 10.3 Grilla de productos

La pantalla principal. Es la grilla con foto y datos que pedía el punto 4 del
pedido original.

```
[ Buscar por código o nombre ]   Estado: [ Por aprobar ▾ ]   Categoría: [ ▾ ]

┌────────┐  CG85527                          ⚠ sin nombre, sin precio
│ [foto] │  3 colores · 4 fotos
│        │  Origen: CARTERA | DE FIESTA                        [ Completar ]
└────────┘

┌────────┐  CG84102   Mochila urbana lisa 18"      Gs. 285.000
│ [foto] │  1 color · 1 foto · mochilas, notebook, escolar
│        │  ✓ listo para aprobar                     [ Editar ] [ Aprobar ]
└────────┘
```

- **Búsqueda por código o nombre.** El código es lo que esa persona tiene a mano
  cuando le preguntan por un producto (§5.3).
- **Filtro por estado**, con «Por aprobar» por defecto: la cola de trabajo
  pendiente. Esto ocupa el lugar de la sección `SIN CURAR` del reporte de
  `SPEC.md` §6.6, pero en pantalla y accionable.
  Se llama «Por aprobar» y no «Sin completar» (renombrado el 2026-08-06) porque
  **nombra la acción que falta, no una carencia**: la lista es una cola de trabajo y
  su rótulo tiene que decir qué hacer. El valor viaja en la URL como
  `?estado=por-aprobar`.
- **Los eliminados no aparecen** salvo que se elija ese filtro. Es la solución al
  ruido del inventario muerto: se filtra, no se borra.
- **Aprobación en lote** para los que ya pasan las validaciones de §5.2.
- **Asignación de categorías en lote.** Se seleccionan varios productos y se les
  asigna categoría de una sola vez. No es una comodidad: como el origen no aporta
  categoría (§5.4b) y un lanzamiento son ~64 productos generalmente del mismo
  tipo, es lo que hace que asignar a mano sea trabajo de minutos y no de horas.

### 10.4 Editar un producto

Los cuatro campos del pedido original — categoría, título, detalle, precio — más
las variantes y sus fotos, ya relacionadas desde la importación.

Detalles que importan:

- **Las validaciones de §5.2 se muestran como lista de pendientes**, no como un
  error al apretar Aprobar. Se ve qué falta antes de intentar.
- **Aviso de deriva de precio ±25 %** junto al campo, en el momento de tipear:
  «antes 285.000, ahora 2.850.000 — ¿es correcto?». Es `SPEC.md` §6.9 movido al
  lugar donde se comete el error.
- **Un color sin hex no se inventa** (`SPEC.md` §6.6). El campo queda vacío y el
  selector del sitio cae a botón con texto, que es el comportamiento
  especificado.
- **`slug` visible pero no editable** una vez publicado, con la razón al lado:
  «cambiarlo rompería el enlace que los clientes ya tienen».

### 10.5 Eliminados

La papelera. Lista de lo sacado del catálogo, con fecha, quién lo hizo, y dos
acciones: **Restaurar** y **Vaciar papelera** (§12.3).

### 10.6 Pedidos especiales

ABM de la colección de `SPEC.md` §4.5: los artículos que se venden por cantidad,
con precio a convenir. Ruta `/pedidos-especiales`.

**Por qué hay tabla en D1 y no un JSON a mano.** La colección nació como
`src/data/pedidos-especiales.json`, mantenido a mano igual que `categorias.json`.
Para cargarla desde el panel el dato tiene que vivir en D1: el admin corre en
Cloudflare y **no tiene filesystem**, así que no hay forma de que edite un
archivo del repo. La tabla es `pedidos_especiales` (migración `0006`).

**Una sola pantalla**, a diferencia de productos, que tiene grilla (§10.3) y
ficha (§10.4) por separado. Son una decena de entradas: mandar a abrir y cerrar
una página por edición es el viaje que no se justifica con ese volumen. Cada
ficha lleva su formulario dentro de un `<details>` plegado.

**Lista arriba, alta abajo**, al revés que la mayoría de los ABM. Lo que se hace
seguido es revisar y corregir lo cargado; dar de alta pasa cada varios meses.

| Campo | Regla |
|---|---|
| Nombre | Obligatorio. De acá sale el slug, **una sola vez** |
| Descripción | **Obligatoria.** Es todo el contenido de la ficha (`SPEC.md` §4.5) |
| Foto | Obligatoria, una sola. Mismo recorte cuadrado y mismo pipeline que §8.3 |
| Orden | Curaduría. Más chico, más arriba |
| Visible | Oculta sin borrar |

**El slug es inmutable**, igual que el de un producto (`SPEC.md` §6.7) y por la
misma razón: estas fichas se comparten por WhatsApp, que es el único canal de
venta. Renombrar cambia el nombre, nunca la URL. La pantalla muestra el slug
junto al nombre para que eso se entienda sin leer documentación.

**Ocultar y eliminar no son alternativas del mismo peso.** Ocultar es reversible
y devuelve la misma URL; eliminar la deja en 404 para quien la tenga guardada en
un chat. Por eso el borrado va separado, al final del formulario y en rojo.

**La imagen no se borra con la ficha.** Puede estar compartida con un producto
—el dedupe de `guardarImagen` es por contenido—, así que borrarla dejaría un
`<img>` roto en el catálogo. Quien decide si un objeto ya no lo referencia nadie
es la recolección de huérfanas (§12.3), y el índice
`idx_pedidos_especiales_imagen` existe para eso.

**Se publica por el mismo botón que el catálogo.** El volcado (§5.5) escribe
**dos archivos** en la misma corrida, `productos.json` y
`pedidos-especiales.json`, y los dos entran en el mismo commit. Dos scripts
serían dos Actions, dos commits y una ventana con el sitio a medio actualizar.

---

## 11. Publicación

### 11.1 Quién publica

**Publica la persona que carga, no el rol técnico.** Si el rol técnico es la
compuerta, se convierte en cuello de botella y el modo de falla es invisible: se
cargan cuarenta productos, se ven guardados, y nadie se entera de que están
esperando un deploy manual hasta que un cliente pregunta.

El riesgo que uno querría cubrir con esa compuerta —publicar un dato malo— **no
se resuelve ahí**. Se resuelve en la entrada (validaciones de §5.2, aviso de
deriva de precio) y en el build (Zod y `reference('categorias')` rompiendo el
build ante un slug inválido, `SPEC.md` §4.1). Esas compuertas no se distraen y no
se van de vacaciones.

### 11.2 El mecanismo

**Publicar es una acción de lote**, un botón, no algo que ocurra por producto.

```
[ Publicar cambios ]  ──▶ POST repository_dispatch a GitHub
                              │
                              ▼
                     GitHub Actions
                       1. lee D1 por API HTTP
                       2. escribe src/data/productos.json (determinista, §5.5)
                       3. npm test
                       4. astro build   ← Zod + reference() validan acá
                       5. commit y push si hubo cambios
                       6. wrangler deploy del sitio publico
                       7. POST de vuelta al admin: ok | error
                              │
                              ▼
                     aprobado → publicado, se sella publicado_en
```

**El commit va DESPUÉS del build, no antes.** Una versión anterior de este diagrama
commiteaba en el paso 3 y validaba en el 4, y es al revés: el build es justamente lo
que valida el JSON recién volcado. Con ese orden, un volcado que Zod rechaza deja el
JSON roto **ya comiteado** y `main` roto. Este mismo apartado dice que un build que
falla no cambia ningún estado — y un commit malo *es* un cambio de estado. Validar
primero y empujar después deja el repo intacto ante cualquier falla.

Implementado en `.github/workflows/publicar.yml`.

**`concurrency` con `cancel-in-progress`** en el workflow: cinco clicks nerviosos
colapsan en un solo build. El costo de Actions no lo define quién aprieta el
botón, sino cuántos builds se disparan, y esto lo acota sin código.

Un build que falla **no cambia ningún estado**: los productos siguen `aprobado` y
se pueden volver a publicar cuando se arregle la causa. Nunca queda un
`publicado` que en realidad no está en el sitio.

### 11.3 Que la falla sea visible

La pieza que hace seguro el auto-publish con una persona no técnica, y la que
suele faltar. Un check rojo en GitHub no existe para quien no entra a GitHub.

| Estado en `publicaciones` | Qué se ve en el admin |
|---|---|
| `pendiente` / `corriendo` | «Publicando… empezó hace 40 segundos» |
| `ok` | «✓ Publicado hace 2 horas · 8 productos» |
| `error` | «✗ No se pudo publicar. Ya avisamos al equipo técnico.» + qué hacer mientras |

Y ante `error`, **notificación al rol técnico** con el link al run de Actions.
Sin esto, auto-publish es publicar a ciegas.

#### El camino de error no puede depender del mismo secreto que el feliz

**Corregido el 2026-08-10, después de que este apartado fallara en producción dos
veces.** Es la lección más caras de las tres que dio el primer uso real del botón.

La Action falló porque faltaba `CLOUDFLARE_API_TOKEN`. Y el paso «Reportar el
resultado» —el que esta sección diseñó para que la falla fuera visible— **necesita ese
mismo token para escribir en D1.** No pudo reportar nada. La fila quedó en `pendiente`
y el admin mostró «Publicando…» indefinidamente, mientras el catálogo ya estaba
publicado.

O sea: la sección que existe para que las fallas se vean **es ciega exactamente ante
la falla de credenciales**, que es de las más probables al configurar el circuito por
primera vez.

Un reporte que viaja por el mismo canal que puede romperse no es un reporte. Cuando
eso pasa, la única red que queda es que **el lector se dé cuenta solo**:

| | Antes | Ahora |
|---|---|---|
| El botón vuelve | Sí, `hayPublicacionEnCurso` ya vencía | igual |
| El cartel vence | **No. Decía «Publicando…» para siempre** | «No llegó respuesta de la publicación» |

El vencimiento sale de **una sola** función que usan las dos preguntas. Con dos plazos
distintos habría una ventana donde el botón está libre y el cartel dice que hay algo
en curso; hay un test que fija los dos bordes.

El mensaje de una publicación vencida avisa de **mirar el sitio antes de reintentar**,
porque puede haberse publicado igual — que es literalmente lo que pasó. Y va con tono
de error y no de éxito: pintarla de `ok` diría que se publicó algo que nadie sabe si
se publicó.

Ante fechas ilegibles se responde «todavía en curso», que es el lado conservador:
tratarla como vencida abriría el botón para disparar una segunda publicación mientras
la primera quizás sigue corriendo.

#### Las otras dos fallas del primer uso, para no repetirlas

**`repository_dispatch` devuelve 204 aunque no haya ningún workflow escuchando.** El
primer intento no disparó nada porque `publicar.yml` no estaba en el repositorio
remoto — había 55 commits sin pushear. Desde el admin, «disparado» y «disparado al
vacío» son indistinguibles. Y sólo se disparan workflows de la rama **por defecto**:
tenerlo en otra rama no sirve.

**El circuito necesita credenciales en las DOS direcciones.** `GITHUB_TOKEN` como
secret del Worker cubre admin → GitHub. La vuelta, GitHub → Cloudflare, necesita en el
repositorio los secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` y
`D1_DATABASE_ID`, más las variables `SITE_URL`, `INDEXABLE`, `PUBLIC_R2_BASE` y
`PUBLIC_WHATSAPP`. El token se arma con la plantilla «Edit Cloudflare Workers» más una
fila `D1: Edit`: sin ella el workflow despliega pero no puede leer la base.

El mensaje de error del admin **no muestra el stack**. El caso más probable es el
que `SPEC.md` §4.1 diseñó a propósito: un slug de categoría inválido rompe el
build. Para quien opera, eso se traduce a «revisá las categorías del producto
CG85527», no a un volcado de Zod.

---

## 12. Eliminación

### 12.1 El criterio

El pedido original propone borrado físico, con el argumento de que un producto
mal borrado se vuelve a cargar y que el inventario muerto ocupa espacio.

**El espacio no es el problema.** Con las cifras verificadas de §3: un producto
muerto son ~600 bytes en D1 y ~300 KB en R2 (3 colores × 2 fotos). El free tier
de R2 son 10 GB, es decir **~33.000 productos muertos**. El catálogo objetivo son
300 a 1.500 (`SPEC.md` §9.4). Está tres órdenes de magnitud lejos de ser un
problema.

**El costo real del inventario muerto es el ruido en el admin**, y se resuelve
filtrando (§10.3), no borrando.

**Y «se vuelve a cargar y listo» no recupera la identidad.** El `slug` se genera
una sola vez (§5.2). Si se borra físicamente y se recarga, el nombre tipeado
apenas distinto produce **otra URL**, y la anterior queda muerta. En un negocio
cuyo canal es WhatsApp, los enlaces viven para siempre en conversaciones: un 404
ahí no lo reporta nadie. Es exactamente lo que `SPEC.md` §1.2 protegía con rutas
planas y §6.9 con *«borrar mata la URL y su indexación»*.

### 12.2 La regla

Depende de una sola cosa: **si el producto llegó a ser público.**

| Estado | Borrado | Por qué |
|---|---|---|
| `importado`, `aprobado` | **Físico**, con sus imágenes huérfanas | Nunca tuvo URL. Nadie tiene el enlace. No hay nada que preservar |
| `publicado` | **Lógico** ⇒ `eliminado` | Hay URLs en la calle |

Esto atiende la preocupación de fondo: **la basura de verdad es toda del primer
tipo.** Se importan 80 productos de una página de lanzamientos, se aprueban 30, y
los 50 restantes se borran de verdad, con sus fotos. Ese es el 90 % del
inventario muerto, y desaparece.

En el admin las dos acciones dicen **Eliminar** y piden confirmación explicando
qué va a pasar en cada caso:

- Nunca publicado: «Se va a borrar definitivamente, junto con sus 4 fotos.»
- Publicado: «Se va a sacar del catálogo. El enlace deja de mostrarlo pero no
  queda roto. Se puede restaurar.»

**Eliminar por código**, como pedía el punto 5: el buscador de §10.3 acepta el
código y la acción está en la fila. No hay una pantalla aparte de «eliminar por
código»; sería un camino paralelo para hacer lo mismo, y un camino paralelo es
donde se cometen los errores.

### 12.3 Vaciar papelera

La palanca de limpieza, **manual y explícita**, nunca automática:

1. Borra físicamente los `eliminado` con más de X meses (por defecto 6,
   configurable).
2. Recolecta las imágenes de R2 sin ninguna referencia en `variante_imagenes`.
   `DeleteObject` en R2 es gratis (§3), así que la purga no cuesta nada.
3. Informa cuántos productos y cuántas imágenes se van **antes** de confirmar.

Aviso que la pantalla muestra sin vueltas: las URLs de esos productos pasan de
«no muestra el producto» a **404 definitivo**.

---

## 13. Costos

| Concepto | Costo |
|---|---|
| Sitio público (assets estáticos, cualquier tráfico) | **$0** |
| Worker de admin | **$0** — muy por debajo de 100.000 req/día |
| D1 | **$0** — muy por debajo de 5 GB y de los límites diarios |
| R2 | **$0** — muy por debajo de 10 GB y de 1M Class A/mes |
| Cloudflare Access | **$0** — hasta 50 usuarios |
| GitHub Actions | **$0** esperado — a verificar (§16) |
| **Total mensual** | **$0** |
| Dominio | ~USD 10-15 / año. **No lo necesita el desarrollo, sí el lanzamiento**: sin dominio las fotos se sirven por `r2.dev`, que es development-only (§14, Fase 2.1) |

**Lo único que rompería el $0** es que los 10 ms de CPU no alcancen para el
scrape ni con las mitigaciones de §7.3, y haya que pasar a Workers Paid ($5/mes).
Por eso se mide primero (§14, Fase 2.0).

---

## 14. Fases de implementación

Cada fase es verificable por sí sola. La numeración `2.x` evita colisionar con
las fases de `SPEC.md` §11.

### Fase 2.0 — Descubrir el riesgo (no desplegable) · **CERRADA 2026-08-03**

**Antes de construir nada.** Worker descartable en `spike/ficha/`, fuera de la
raíz del proyecto: sin `package.json` propio, sin tocar `src/`, sin bindings.

```
npx wrangler dev -c spike/ficha/wrangler.jsonc --port 8788
curl "localhost:8788/?url=https://www.chenson.com.py/producto/71803-cg86003"
curl "localhost:8788/?url=...&imagenes=0"    # aísla parseo de hash
```

**Ya resuelto, corriendo en local:**

- ✅ Extracción de código, hermanos, colores e imágenes sobre fichas reales.
- ✅ El nombre del color vive en `img title` de la miniatura del hermano (§7.2).
- ✅ Las tres clases de imagen y la regla `alt="product-thumb"` (§7.2). **Este
  hallazgo justifica la fase por sí solo:** sin él, el scrape habría sido no
  idempotente y con fotos cruzadas entre colores, sin producir un solo error.
- ✅ La celda de medidas viene vacía: no hay descripción que prellenar (§7.2).
- ✅ Subrequests del parseo: **1**. Con hash de galería: 1 + nº de fotos.

**Resuelto con deploy:**

- ✅ **CPU: una ficha entra con margen ~5×.** No hace falta Workers Paid, y la
  granularidad de una ficha por request es correcta. Tabla y método en §7.3.
- ✅ La cuenta está en el **plan Free**, confirmado por el `error code: 1102`.
- ✅ El subdominio de la cuenta es **`chenson`**, así que el sitio queda en
  `ybe-catalogo.chenson.workers.dev` ⇒ es el valor de `SITE_URL`.

**Sigue pendiente para la Fase 2.2:**

- ⬜ Si D1 y R2 por binding cuentan contra el límite de 50 subrequests (§16). No
  se pudo medir acá: el spike no tiene bindings a propósito, para que el número
  de CPU fuera solo de red más parseo más hash.

El Worker desplegado **se elimina al cerrar la fase** (`wrangler delete`): es un
endpoint público que sale a buscar páginas del proveedor y no tiene por qué
seguir en línea. El código queda en el repo como registro del método.

Lo que sobrevive del spike son los **selectores verificados de §7.2**, que la Fase
2.5 reimplementa con tests en lugar de copiarlos.

### Fase 2.1 — R2 real (desplegable) · **CERRADA 2026-08-04**

Cierra el pendiente que el sitio ya tiene hoy.

**Prerrequisito manual, verificado el 2026-08-03:** R2 **no viene habilitado** en
la cuenta. `wrangler r2 bucket list` devuelve
`code: 10042 — Please enable R2 through the Cloudflare Dashboard`. Hay que
suscribirlo una vez desde *Storage & databases › R2 › Overview* completando el
checkout. **No es un problema de permisos:** el scope `r2` no existe en la lista
de OAuth de wrangler (`wrangler login --scopes-list`), y no hace falta — el token
alcanza la API de R2 y recibe respuesta; lo que falta es la suscripción. Queda sin
verificar si ese checkout exige medio de pago aun quedándose en el free tier.

- ✅ R2 habilitado en la cuenta y **bucket `ybe-catalogo` creado**.
- ✅ Acceso público habilitado: `https://pub-d528716484104bfeb9ae991ab4337347.r2.dev`
  ⇒ es el valor de `PUBLIC_R2_BASE`.
- ✅ **Cliente S3 de R2** en `scripts/import/r2.mjs` — subida condicional y
  `Cache-Control` inmutable. 13 tests, todos offline con un doble del cliente.
- ✅ **Script de relleno** en `scripts/import/subir-existentes.mjs`
  (`npm run subir-existentes`, con `--dry-run`). Regenera las derivadas desde
  `samples/` con el pipeline real, no copia `public/img-dev/`.
- ✅ **Verificado que las claves coinciden**: el ensayo planea exactamente las
  mismas 14 claves que sirve `public/img-dev/` hoy (249 kB). Era la premisa de
  toda la fase y ahora está comprobada, no asumida.
- ✅ **Token de escritura creado** y las 14 derivadas **subidas** (249 kB).
  Reejecutar el script sube 0: el dedupe por `HeadObject` funciona.
- ✅ **Verificado contra el bucket, objeto por objeto:** las 14 claves devuelven
  200 con bytes **idénticos** a los locales, `Content-Type: image/webp` y
  `Cache-Control: public, max-age=31536000, immutable`. No se verificó una y se
  extrapoló: se comparó el SHA-256 de las 14.
- ✅ `PUBLIC_R2_BASE` apunta al bucket y el build emite URLs de R2.
- ✅ **`public/img-dev/` borrado** y su regla sacada de `public/_headers`. El
  directorio pasa a `.gitignore`: es salida regenerable de
  `scripts/dev/imagenes-locales.mjs`, que queda como escape para trabajar sin red.

**Fase 2.1 CERRADA 2026-08-04.** Criterio de salida cumplido: el sitio sirve las
imágenes desde R2 y no queda ninguna referencia funcional a `/img-dev`.

Criterio de salida: el sitio publicado sirve imágenes desde R2, sin `/img-dev`.

#### La URL `r2.dev` NO sirve para producción

Verificado en la doc oficial el 2026-08-03: *«Public access through `r2.dev`
subdomains is rate-limited and should only be used for development purposes»* y
*«For production use, add your domain to Cloudflare instead»*.

**Esto sube el peso del dominio propio.** Hasta ahora el dominio condicionaba las
Image Transformations (§15) y el paso de `INDEXABLE` a `true` (`SPEC.md` §7.2).
Ahora también condiciona **servir las fotos del catálogo**: con `r2.dev` funcionan,
pero con rate limit y sin garantía de servicio.

Consecuencia concreta: **el sitio no se puede abrir a clientes reales estando en
`.workers.dev`.** No bloquea ninguna fase de la etapa 2 — todo el desarrollo y las
pruebas corren sobre `r2.dev` sin problema — pero el lanzamiento sí depende del
dominio, y no solo por SEO.

Al pasar al dominio propio, el cambio es de configuración: se agrega el dominio
como *custom domain* del bucket y `PUBLIC_R2_BASE` apunta ahí. Las claves de los
objetos no cambian, así que ninguna imagen se vuelve a subir.

**RESUELTO 2026-08-13.** Se cumplió tal cual: `img.asuncionybe.com` es custom domain
del bucket, `PUBLIC_R2_BASE` apunta ahí y no se resubió ninguna imagen. El **Public
Development URL del bucket quedó apagado**, así que la URL `pub-…r2.dev` de más
arriba ya no sirve: responde **401**. La misma clave por el dominio propio devuelve
200 `image/webp`. El sitio público pasó a `asuncionybe.com` con `INDEXABLE` en `true`
(`SPEC.md` §1.4 y §7.2), lo que cierra las tres cosas que este apartado decía que el
dominio condicionaba.

### Fase 2.2 — D1 y el volcado (desplegable) · **CERRADA 2026-08-10**

El eslabón que hace que todo lo demás pueda existir.

- ✅ **Esquema de §5.1** en `db/migrations/0001_esquema_inicial.sql`.
- ✅ **Volcado puro** en `scripts/volcado/construir.mjs` — 31 tests.
- ✅ **Tests del esquema** en `db/__tests__/esquema.test.mjs` — 18 tests.
- ✅ **Base D1 creada y migración aplicada.** `ybe-catalogo`, id
  `693387a5-f13b-4514-ad49-56a6bd5621ef`, región ENAM. Config de operación en
  `db/wrangler.jsonc` — **aparte del `wrangler.jsonc` de la raíz a propósito**:
  el binding a D1 no puede vivir en el del sitio público, que por diseño no tiene
  ninguno (§4.1).
- ✅ **Restricciones verificadas contra la base remota**, no solo en local:
  `FOREIGN KEY constraint failed: SQLITE_CONSTRAINT_FOREIGNKEY [code: 7500]` y
  `CHECK constraint failed: estado = 'importado' OR slug IS NOT NULL`. **D1
  aplica las foreign keys sin necesidad de `PRAGMA`.**
- ✅ **Capa de consultas** en `scripts/volcado/consultar.mjs` — 21 tests. Cuatro
  `SELECT` + el ejecutor contra la API HTTP de D1.
  - El WHERE **deriva de `PUBLICABLES`** de `construir.mjs`, que ahora se exporta.
    Con la lista duplicada, agregar un estado publicable dejaría el SQL filtrando
    por los viejos y el volcado omitiría productos sin que nada falle. Hay un test
    que ata las dos puntas.
  - `consultarFilas()` recibe un **ejecutor**, no una conexión. Así el mismo SQL
    corre contra D1 por HTTP en producción y contra `node:sqlite` en memoria en los
    tests: **D1 es SQLite, así que el SQL que pasa los tests es el que corre en
    producción.** Un doble no daría esa garantía.
  - **Verificado contra la D1 remota**, no solo en local: las cuatro consultas
    devuelven `success: true` con `rows_written: 0`.
- ✅ **Migración `productos.json` → D1** en `scripts/volcado/desde-json.mjs` (pura)
  y `scripts/volcado/sembrar.mjs` (emite el guion de SQL). **Aplicada** a la base
  remota: 6 productos, 7 variantes, 7 imágenes, 13 vínculos de categoría.
  - **Son 6 productos, no 4** — este checklist decía 4 y estaba mal.
  - Los metadatos de origen de cada imagen (`ancho_origen`, `alto_origen`,
    `bytes_origen`, **NOT NULL**) no están en el JSON: describen el archivo
    original, no la derivada. Se miden sobre `samples/` cruzando por `hash16`.
    Verificado que los 7 hashes del JSON tienen su archivo de origen.
  - `sembrar.mjs` **emite SQL** en vez de escribir en la base: para una migración
    de datos que se hace una vez, un artefacto legible y revisable vale más que la
    comodidad. `--limpiar` emite los `DELETE` en orden inverso para reintentar.
- ✅ **Capa de E/S del volcado** en `scripts/volcado/index.mjs`
  (`npm run volcar`, con `--dry-run`), más `diferencias.mjs` (reporte de cambios) y
  `ejecutor-wrangler.mjs` (transporte local). 20 tests.
  - **Elige el transporte:** con las tres variables de D1 en el entorno usa la API
    HTTP — lo que corre en la Action; sin ellas cae a wrangler, que en una máquina
    ya está autenticado. Es deliberado: sin ese fallback el volcado solo se podría
    ejecutar en CI, y **una pieza que solo corre en CI se depura a ciegas.**
  - **Criterio de salida VERIFICADO contra la D1 remota:** dos volcados seguidos ⇒
    el segundo reporta `sin cambios` y **no reescribe el archivo**, así que la
    publicación no genera un commit vacío.
  - El reporte no es cosmética: quien publica no entra a GitHub (§11.3). Una **baja**
    se marca aparte porque deja la URL de un producto publicado en 404.
- ✅ **Workflow** en `.github/workflows/publicar.yml`. `repository_dispatch`
  (tipo `publicar`) más `workflow_dispatch` para correrlo a mano;
  `concurrency` con `cancel-in-progress`. YAML validado con parser.
  - **Commit después del build, no antes** — ver §11.2.
  - **Faltan dos pasos que dependen del admin (fase 2.3)** y están declarados a la
    vista en el propio archivo, no omitidos: el POST de vuelta que alimenta la
    tabla `publicaciones` (§11.3), y la transición `aprobado` → `publicado` con el
    sello de `publicado_en` (§5.2). Hoy la segunda es un no-op: sin admin nada pone
    un producto en `aprobado`.
  - **Pendiente de configurar en GitHub** (trabajo de cuenta, no de código):
    secrets `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`, `CLOUDFLARE_API_TOKEN`; vars
    `SITE_URL`, `INDEXABLE`, `PUBLIC_R2_BASE`, `PUBLIC_WHATSAPP`.

> **Hueco de verificación honesto.** El volcado se probó de punta a punta contra la
> D1 remota **por el transporte de wrangler**. El transporte por **API HTTP** — que
> es el que usa la Action — tiene tests unitarios con un `fetch` inyectado, pero
> nunca corrió contra D1 real, porque no hay token de API en el entorno local. Para
> cerrarlo: poner las tres variables en `.env` y correr
> `npm run volcar -- --dry-run`, que con ellas presentes elige la API HTTP.

#### El orden de las variantes es curaduría, no abecedario

`variantes[0]` es la variante activa en el HTML inicial (`SelectorVariante`), así que
ese orden decide **qué color se ve al abrir la ficha** — y con él el `og:image` y la
imagen principal del JSON-LD. Es una decisión comercial, no un detalle de
serialización.

La regla original de `SPEC.md` §6.6 ordenaba **alfabéticamente por color**, lo que
dejaba esa decisión en manos del abecedario: `mochila-juvenil-acolchada` habría pasado
de mostrar Negro a mostrar Fucsia. **Se cambió a la columna `orden`**, con `color` y
después `sku` como desempates. Los dos desempates no son adorno: sin ellos dos
variantes con el mismo `orden` quedarían como las devolvió la base y se caería el
determinismo.

**El costo de la decisión, dicho de frente:** esto convierte a `orden` en curaduría, y
un re-scrape que la sobreescriba con el orden del proveedor movería los colores por su
cuenta — que es exactamente la inestabilidad que el alfabético evitaba. Por eso `orden`
entra en la lista de campos que la importación **nunca** pisa, junto a `activo`
(`SPEC.md` §6.4 y §6.6).

#### Qué cambió el primer volcado real

Medido, no estimado. **Cero cambios de contenido:** el reporte del volcado dice
`sin cambios`, los seis productos conservan su orden de variantes — incluido
`Negro/Fucsia` — y el `og:image` de la ficha sigue apuntando a la foto de Negro
(`862cab4eb0a88563`), verificado en el HTML construido.

El archivo sí cambió, pero solo de forma: orden canónico de productos por `id`, claves
alfabéticas y el formato de `serializar()`. `src/data/productos.json` ya está canónico,
así que la próxima publicación produce un diff chico y legible en vez de esta única
sacudida de 241 líneas.

**Efecto lateral bueno del cambio de regla:** el ida y vuelta `JSON → D1 → JSON` pasó a
ser identidad salvo el orden de productos. Antes había que reordenar las variantes del
lado esperado para compararlo; ahora no.

#### El ida y vuelta es el test más fuerte que tiene el volcado

`JSON → aFilas → INSERT en el esquema real → consultarFilas → construirProductos → JSON`

Corre en `node:sqlite` con la migración de verdad, así que ejercita también los
`NOT NULL`, los `CHECK` y las foreign keys. **Si una de las dos direcciones pierde
un campo, el ida y vuelta lo delata**; ningún test de una sola dirección lo haría.
Por eso `desde-json.mjs` se queda en el repo aunque la migración sea de una vez.

**Verificado además contra la D1 remota**, no solo en memoria: leer las cuatro
consultas de la base real y reconstruir da un JSON **idéntico** al comiteado, campo
por campo.

#### El `productos.json` comiteado NO está en orden canónico

Fue escrito a mano. El volcado ordena productos por `id` y variantes por `color`, y
el archivo actual no cumple ninguna de las dos: el orden de productos es otro, y
`mochila-juvenil-acolchada` tiene `[Negro, Fucsia]` donde el canónico es
`[Fucsia, Negro]`.

**Consecuencia que hay que decidir antes del primer volcado real:** `variantes[0]`
es la variante activa en el HTML inicial (`SelectorVariante`), así que regenerar el
archivo **cambia el color que se muestra por defecto** en ese producto — y con él su
`og:image` y la imagen principal del JSON-LD. No es un bug: es la normalización que
`SPEC.md` §6.6 pide. Pero es un cambio visible, no un reordenamiento inocuo.

#### Trampa de wrangler: `--file` con `--json` no devuelve las filas

`wrangler d1 execute --file X --json` devuelve un **resumen**
(`Total queries executed`, `Rows read`) en vez de los resultados. Con `--command` sí
devuelve las filas. Se descubrió a la mala: parecía que la consulta traía una sola
fila cuando la base tenía seis.

#### El filtro de estado va en las cuatro consultas, y no es redundancia

Si los hijos vinieran sin su padre, `construirProductos()` los leería como
huérfanas y cortaría el volcado denunciando una corrupción referencial que no
existe.

El corolario conviene tenerlo presente: como todo viene filtrado por un `JOIN` a
`productos`, **las guardas de huérfanas de `construir.mjs` no cubren este camino**
— una fila realmente huérfana queda excluida por el `JOIN`, no denunciada. Esas
guardas protegen el contrato de la función pura; lo que protege la base son las
foreign keys, que D1 aplica.

#### Un error de D1 llega con HTTP 200

`ejecutorD1()` no puede mirar solo el código de estado: D1 reporta los errores de
SQL con **HTTP 200 y `success: false`**. Leer eso como un resultado vacío haría que
el volcado escriba un `productos.json` vacío y que la publicación **borre el
catálogo entero sin un solo error**. Está cubierto por test, igual que el caso de
más de un resultado para una sola sentencia.

#### Cómo se testea SQL sin nube ni credenciales

**D1 es SQLite**, así que la migración se aplica sobre una base en memoria con
`node:sqlite` (Node 22, flag `--experimental-sqlite` ya agregado al script
`test`). Sin esto, verificar una restricción exigiría crear una base remota, y
los tests dejarían de correr offline.

No se testea que SQLite funcione: se testea que **nuestro** esquema declare bien
los invariantes. Un `CHECK` con un typo **no falla al crear la tabla** — deja
pasar estados imposibles en silencio.

El invariante principal que quedó cubierto por las dos puntas: `estado` publicable
⇒ `slug NOT NULL`. El volcado lanza si lo ve violado, y la base ahora lo rechaza
antes, así que un `UPDATE` mal hecho desde el admin no puede dejar la fila en un
estado imposible.

#### La frontera pura / E/S

`construirProductos()` recibe las filas **tal como las devuelve D1** — snake_case,
`0`/`1` por booleano — y devuelve la estructura de §4.4. No toca red, base ni
disco. Eso permite testear el determinismo llamándola dos veces, y deja la capa de
consultas como la única pieza que necesita una base de verdad.

Dos decisiones de determinismo que no son obvias y están cubiertas por test:

1. **El orden de colores usa comparación por punto de código, nunca
   `localeCompare`.** `localeCompare` depende del ICU del runtime, así que la
   GitHub Action y una máquina local podrían ordenar distinto y el volcado
   dejaría de ser determinista. Es el mismo riesgo que `SPEC.md` §9.3 evita al
   formatear precios en build. El test usa `Ámbar`/`Azul`/`Zafiro`, donde las dos
   estrategias difieren, para que nadie lo "arregle" con `localeCompare`.
2. **Se omiten las claves que igualan su default de Zod** (`activo`,
   `variante.activo`) y las opcionales ausentes (`descripcion`, `colorHex`), pero
   **`precio` y los arrays van siempre.** `precio` es `nullable` y no `optional`:
   la clave es obligatoria. Un `imagenes: []` es un estado con significado —
   dispara el placeholder de `SPEC.md` §5.4 — y omitirlo lo volvería
   indistinguible de un error de volcado. Con esta regla la salida reproduce
   exactamente el ejemplo de `SPEC.md` §4.4.

Criterio de salida: volcar D1 dos veces seguidas ⇒ `git diff --exit-code
src/data/productos.json` limpio. Es el test de idempotencia de `SPEC.md` §6.11
sobre la base nueva.

**✅ CUMPLIDO el 2026-08-10**, contra la D1 remota con 8 productos: el segundo volcado
reporta «sin cambios» y no reescribe el archivo. `git diff --exit-code` limpio. El
workflow de publicación lo ejercita en cada corrida, que es lo que convierte la
idempotencia en algo que se verifica solo y no cuando alguien se acuerda.

### Fase 2.3 — Admin: leer y editar (desplegable) · **CERRADA 2026-08-10**

El admin vive en `admin/`, con su propio `package.json` y `wrangler.jsonc`
(§4.1). El sitio público no se toca.

- ✅ **Validación del JWT de Access** en `admin/src/lib/access.ts` — 22 tests, y
  el valor está en los **casos negativos**: `alg: none`, confusión de algoritmo
  con `HS256`, firma ajena, `kid` desconocido, cuerpo alterado, `aud` de otra
  aplicación del equipo, emisor distinto, vencido, `nbf` futuro, sin `exp`.
  - **La identidad sale del JWT, nunca del header.**
    `Cf-Access-Authenticated-User-Email` es texto plano: si el Worker queda
    alcanzable por su URL de `workers.dev` sin la política delante, ese header lo
    pone cualquiera. Hay un test que manda los dos headers con emails distintos y
    exige que gane el del JWT, y otro que verifica que el header **solo** no
    alcanza.
  - **El algoritmo se fija en el código, no se lee del token.** Honrar el `alg`
    del token es la vulnerabilidad clásica: `none` deja pasar cualquier cosa y
    `HS256` permite firmar con la clave *pública* como secreto de HMAC.
  - **`aud` no es opcional.** Un equipo de Access puede tener varias aplicaciones,
    todas con el mismo emisor y la misma clave. Sin verificar `aud`, un token
    emitido para cualquier otra aplicación del equipo abre el admin.
- ✅ **JWKS con caché y refresco por rotación** en `admin/src/lib/jwks.ts` — 11
  tests. **Access rota las claves**, y con un caché a secas una rotación deja
  afuera a todo el mundo hasta que expire el TTL: ante un `kid` ausente se
  refresca y se reintenta **una** vez, con memoria de qué `kid` ya provocó un
  refresco para que un `kid` inventado no se convierta en tráfico contra el
  endpoint de Cloudflare. Un JWKS vacío o malformado **revienta** en vez de
  degradar a «nadie autorizado», que es un modo de falla mucho más confuso.
- ✅ **Scaffold y middleware.** Proyecto aparte en `admin/` con su propio
  `package.json`, `astro.config.mjs` y `wrangler.jsonc` (bindings `DB` a D1 e
  `IMAGENES` a R2). `src/middleware.ts` valida en **cada** request, sin lista de
  rutas exentas: una excepción es una ruta que alguien va a olvidar que existe.
  Responde **403** con el motivo y `Cache-Control: no-store` en todo.
  - **El atajo de desarrollo exige DOS condiciones**: estar en desarrollo Y que
    `ADMIN_DEV_EMAIL` tenga valor. `esDesarrollo` sale de `import.meta.env.DEV`,
    que en un build de producción es la constante `false`, así que en el bundle
    desplegado la rama del atajo es **código muerto**. Un `ADMIN_DEV_EMAIL` que
    quedara seteado en producción por un copiar y pegar del `.env` no cambia nada.
    Hay 9 tests, y el que importa es el que verifica que **fuera de desarrollo se
    ignora por completo**.
  - **Un JWT presente siempre gana sobre el atajo**, y un fallo del verificador se
    propaga en vez de caer al atajo: un token inválido que entrara por la puerta de
    desarrollo sería lo peor de los dos mundos.
  - **Verificado corriendo, no solo compilando:** con el atajo da 200 mostrando la
    identidad y los conteos reales de D1 (1 eliminado + 5 publicado); con un JWT
    basura da **403** — o sea que el token sí pasa por verificación; y un
    `Cf-Access-Authenticated-User-Email: intruso@otro.com` falsificado **no tiene
    ningún efecto**.
- ✅ **Grilla (§10.3), parte de lectura** — 37 tests. Búsqueda por código o nombre,
  filtro por estado con «Por aprobar» por defecto, y el estado de validación
  debajo de cada producto. Todo por **GET, sin JavaScript**: la URL queda
  compartible y recargable, el botón de atrás funciona, y una pantalla de trabajo
  no puede depender de que cargue un bundle.
  - **`validarParaAprobar()` no devuelve un booleano**, devuelve **qué** falta.
    Decide dos cosas a la vez: si el botón «Aprobar» se habilita y qué dice la
    grilla (`⚠ sin nombre, sin precio` / `✓ listo para aprobar`). Un validador
    binario obligaría a reimplementar los motivos en la vista, y ahí es donde las
    dos versiones se separan sin que nadie se entere.
  - **Acumula todos los faltantes**, no corta en el primero: arreglar de a uno y
    volver a guardar para descubrir el siguiente es trabajo regalado.
  - **La miniatura sale de la misma variante que muestra el sitio** — el mismo
    `ORDER BY v.orden, v.color, v.sku, vi.orden, i.hash16` del volcado. Verificado
    corriendo: `CG84455` muestra la foto de Negro, o sea que la decisión del orden
    curado llega hasta la grilla.
  - **La validación se evalúa también en los publicados**, no solo en los
    importados. Un producto en la calle puede haber quedado inválido porque se
    renombró una categoría en `categorias.json`, y la grilla es donde eso se tiene
    que ver. Ya pasa con `CG81500`, que está `publicado` y marca `⚠ sin fotos`.
  - **Un `estado` inválido en la URL cae al default; en la consulta REVIENTA.** No
    es incoherencia: un parámetro tipeado a mano en la barra se corrige y se sigue,
    pero un filtro inválido que llegue al SQL y degrade a «sin WHERE» mostraría la
    papelera, que es justo lo que §10.3 evita.
  - **La búsqueda escapa `%` y `_`.** Sin eso, un comodín tipeado por accidente trae
    todo y se lee como que la búsqueda no filtra. `LIKE` de SQLite es insensible a
    mayúsculas solo en ASCII: alcanza para el código — que es lo que esa persona
    tiene a mano (§5.3) — y queda documentado que `RIÑONERA` no matchea `Riñonera`.
  - Las categorías se traen en una **segunda consulta**, no con `group_concat`: su
    orden no está especificado en SQLite y `categorias[0]` es el breadcrumb.
- ✅ **Acciones en lote (§10.3)** — 35 tests. Aprobación en lote con la máquina de
  estados de §5.2, y asignación de categorías en lote.
  - **El slug se genera al aprobar y NUNCA se regenera.** Es el invariante más caro
    del sistema: la URL vive en conversaciones de WhatsApp que nadie va a corregir.
    Si el producto ya tiene slug se reusa, aunque el nombre haya cambiado. Hay test.
  - **Las colisiones dentro del mismo lote se resuelven**, no sólo contra la base.
    Dos productos con el mismo nombre generan sus slugs antes de que ninguno esté
    escrito; sin acumular los reservados, el `UNIQUE` rechazaría al segundo y el lote
    quedaría a medias. Verificado contra D1: dos «Cartera de prueba» salieron
    `cartera-de-prueba` y `cartera-de-prueba-2`.
  - **Sólo `importado` → `aprobado`.** Desde `publicado` retrocedería un producto que
    ya está en la calle; desde `eliminado` la transición es restaurar, que es otra
    cosa. El `UPDATE` lleva `AND estado = 'importado'` como guarda optimista.
  - **`publicado_en` no se toca al aprobar**: se sella en la publicación (§5.2).
  - **Un lote mixto aprueba los válidos y reporta los inválidos.** Cortar todo por
    uno obligaría a des-seleccionar de a uno hasta dar con el que molesta.
  - **Asignar categorías AGREGA, no reemplaza**, y al final: reemplazar destruiría
    curaduría en silencio y `categorias[0]` es el breadcrumb (§5.1). En cambio una
    categoría inexistente **corta la operación completa sin escribir nada** — es una
    elección del usuario aplicada a muchos, así que un slug mal escrito no puede
    quedar aplicado a medias.
  - **POST → redirect 303 → GET.** Recargar no reenvía el formulario. Las dos
    operaciones son idempotentes de todos modos, pero un F5 que «aprueba de nuevo»
    asusta y ensucia el reporte.

#### CSRF: el JWT válido no alcanza

`security.checkOrigin` va **explícito** en `admin/astro.config.mjs`, y hace falta de
verdad. Cloudflare Access autentica con la cookie `CF_Authorization` e inyecta el
header con el JWT: un formulario alojado en **otro** sitio que apunte al admin
mandaría la cookie, Access lo dejaría pasar, y el request llegaría **autenticado**.
La validación del JWT no protege de esto — el token es legítimo; lo que no es
legítimo es quién disparó el request.

Verificado corriendo: un `POST` con `Origin: https://sitio-malicioso.example` recibe
**403** y el producto sigue en `importado` con `slug` en `NULL`.

**Atomicidad, dicha de frente:** el lote no es atómico. Cada producto se actualiza con
una sola sentencia, así que ninguno queda a medias, pero si el lote falla en el medio
unos quedan cambiados y otros no. Por eso cada operación devuelve un resultado **por
producto** en vez de un booleano, y por eso las dos son idempotentes: reintentar es
seguro.

- ✅ **Edición (§10.4)** en `admin/src/pages/productos/[codigo].astro` — 17 tests.
  Trae **todo** lo cargado para no retipearlo.
  - **Es pantalla propia y no un modo del formulario de alta.** Un formulario que es
    «alta» o «edición» según lo que se tipeó en un campo cambia de significado en
    silencio, y el caso malo es creer que se está creando algo mientras se pisa un
    producto publicado. Con URL propia el modo es inequívoco, y además da el enlace
    que la grilla necesitaba para su código.
  - **Tres cosas no se editan y están fuera del formulario**, mostradas como dato: el
    **código** (es la identidad, §5.3), el **estado** (sólo se mueve por las
    transiciones — si esta pantalla pudiera cambiarlo habría dos caminos para lo mismo
    y uno se olvidaría de generar el slug) y la **dirección web** (§5.2).
  - **Quitar una variante se rechaza.** Su SKU ya circuló en pedidos y sus fotos
    quedarían huérfanas: sacar de circulación es destructivo y tiene sus propias
    reglas (§12). No puede pasar por borrar una fila sin querer.
  - El alta con un código existente **redirige a esta pantalla**, no muestra un aviso
    con un enlace: quien llegó hasta ahí ya dijo qué producto quiere.

#### El SKU se empareja por id, no recalculándolo

Encontrado corriendo, y rompía la edición de **todos** los productos del proveedor.

El SKU de un producto scrapeado es `{codigo}-{codigoColor}` con el prefijo `(X)` del
origen — `CG85527-E` — y `slug(color)` es sólo el **fallback** para colores sin prefijo
(`SPEC.md` §6.6). Recalcularlo da `CG85527-champagne`, que no coincide con nada: la
edición creía que todas las variantes existentes se habían borrado y se negaba a
guardar.

**El SKU es como el slug: se asigna una vez y no se vuelve a derivar.** Las variantes
existentes viajan con su `id` en el formulario y se emparejan por ahí; el SKU sólo se
calcula para las nuevas. El color de una variante existente queda de sólo lectura por
lo mismo — cambiarlo sería otra variante, no la misma renombrada.
- ✅ **Publicar (§11.2) con estado visible (§11.3)** e **Inicio (§10.1)** — 24 tests.
  El Inicio pasa a ser `/` y la grilla `/productos`. El botón de publicar vive en el
  Inicio y **no** en la grilla: publicar es una acción de lote sobre *todo* el
  catálogo, y ponerlo entre las acciones de la grilla haría pensar que publica lo
  seleccionado.
  - **El resultado lo escribe la Action en D1, NO lo postea al admin** como dice el
    diagrama de §11.2. La Action no puede pasar Cloudflare Access — no hay navegador
    ni PIN — así que un endpoint de vuelta exigiría un service token o excluir una
    ruta de la política: superficie de autenticación nueva justo en la pieza más
    protegida. La Action ya tiene credenciales de D1 para el volcado, así que escribe
    la fila y el admin la lee. Mismo efecto, sin puerta nueva.
  - **`if: always()` en el paso que reporta.** Es lo que hace visible la *falla*, que
    es el punto entero de §11.3: sin eso, un build roto deja la publicación en
    «Publicando…» para siempre y quien opera no se entera nunca.
  - **El admin no muestra el stack.** `errorLegible()` descarta la primera línea si
    tiene pinta de volcado — `node_modules`, `at …`, `ZodError` — y deja pasar los
    mensajes escritos para humanos. Verificado con un stack de Zod real: no aparece.
    El texto completo **sí** se guarda en la fila: el rol técnico lo necesita, y quien
    filtra es la vista, no quien escribe.
  - **Una publicación en curso vence a la hora.** Si la Action muere sin reportar, la
    fila queda en `corriendo` para siempre y el botón no vuelve nunca: no habría forma
    de salir sin tocar la base a mano.
  - `pendiente` y `corriendo` se ven igual: para quien opera son el mismo momento. La
    diferencia entre encolado y arrancado es vocabulario de CI.
  - Se corta **antes** de crear la fila si ya hay una en curso. El workflow colapsa
    builds con `concurrency`; esto es la mitad de arriba. Y si el dispatch falla, la
    fila queda marcada como error en vez de dejar un botón que no hizo nada visible.
  - Las dos puertas que faltan — importar del proveedor, cargar un producto — se
    muestran **desactivadas con su etapa**, no escondidas: un botón ausente se lee
    como «no se puede»; uno desactivado con su motivo se lee como «todavía no».
- ✅ **Sellado: `aprobado` → `publicado` y `publicado_en`** (§5.2) en
  `scripts/volcado/sellar.mjs` — 11 tests. Cierra la máquina de estados.

#### El sellado se hace contra el ARCHIVO, no contra «los aprobados de ahora»

Entre el volcado y el sellado pasan minutos. Si alguien aprueba un producto en el
medio, sellar todos los `aprobado` lo marcaría **En el catálogo** sin estar en el
sitio — y §11.2 promete exactamente lo contrario: *«nunca queda un `publicado` que en
realidad no está en el sitio»*.

La fuente de verdad de qué hay en el sitio es `src/data/productos.json`, que es
literalmente el archivo que se acaba de construir y desplegar. Se sella contra sus
slugs, y el que llegó tarde espera el próximo build. Verificado contra D1: de dos
aprobados, sólo el que estaba en el archivo pasó a `publicado`.

Tres detalles del mismo tamaño:

- **El paso va después del deploy y SIN `if: always()`.** Si el deploy falló, nada de
  esto ocurrió y marcar productos como publicados sería mentir. El orden de los pasos
  es lo que sostiene la promesa.
- **`publicado_en` sólo se sella si está vacío.** El esquema dice «primera
  publicación; NULL = nunca fue público»: pisarlo en cada build lo convertiría en
  «última publicación», que es otro dato. Correr el workflow dos veces no mueve la
  fecha.
- **Un `eliminado` sigue eliminado aunque esté en el JSON.** Aparece ahí con
  `activo: false` para que su URL no quede rota; estar en el archivo no lo devuelve al
  catálogo.

#### Tres trampas del adapter, encontradas a la mala

1. **`Astro.locals.runtime.env` se removió en Astro 6.** Ahora el entorno del Worker
   se importa con `import { env } from 'cloudflare:workers'`. El síntoma es un 500 en
   el primer acceso. Por eso los módulos de `admin/src/lib/` reciben el entorno **por
   parámetro**: así siguen corriendo bajo `node --test`, donde `cloudflare:workers`
   no existe.
2. **`@astrojs/cloudflare` 13.x declara peer `astro ^6`.** Con Astro 7 la instalación
   falla con `ERESOLVE`, y la salida NO es `--legacy-peer-deps` — es la línea 14.x,
   que declara peer `astro ^7`. `platformProxy` también desapareció en 14.x: los
   bindings en `astro dev` los levanta el plugin de Vite corriendo el Worker en
   workerd de verdad. Dejar la opción puesta no da error, **se ignora en silencio**.
3. **El adapter agrega bindings que nadie pidió.** Por defecto mete un binding
   `IMAGES` (Cloudflare Images) y un KV `SESSION` en el `wrangler.json` que genera, y
   los auto-provisiona en el deploy. `imageService: 'passthrough'` saca el de
   imágenes — el admin no transforma nada, las miniaturas salen de R2 ya derivadas.
   El KV de sesiones **se acepta**: suprimirlo pide declarar un driver de mentira que
   se rompe el día que el admin quiera un mensaje de «guardado» entre redirects.
   Queda como recurso auto-provisionado y sin uso, dentro del free tier.

Criterio de salida: una persona sin acceso a la terminal edita un producto, lo
aprueba, lo publica, y lo ve en el sitio. Y si el build falla, entiende qué pasó.

**✅ CUMPLIDO el 2026-08-10.** Login por PIN de Access, sin terminal en ningún momento:
se importaron productos, se aprobaron, se publicó con el botón, y `cartera-dama` y
`mochila` responden 200 en el sitio con su código a la vista. `cg85900`, que está en
`activo: false`, da 404 — la papelera llegando hasta el sitio público.

La segunda mitad del criterio —«y si el build falla, entiende qué pasó»— se cumplió de
la manera más incómoda posible: **falló tres veces y las tres el admin explicó mal lo
que pasaba.** Está documentado en §11.3, y lo que se corrigió ahí es parte de este
criterio, no un extra.

### Fase 2.4 — Carga manual (desplegable) · **CERRADA 2026-08-10**

- ✅ **Reglas puras de imagen** en `admin/src/lib/imagen.ts` — 19 tests. «Nunca se
  amplía» es un `Math.min(1, …)` con su test; las derivadas se deciden por el
  **recorte** y no por el original, que es lo que se escapa fácil.
- ✅ **Subida a R2** en `admin/src/lib/subida.ts` y `POST /api/imagenes` — 23 tests.
  El hash lo calcula el navegador, así que **nunca se sobreescribe** una clave
  existente: el peor caso pasa de «destruiste una foto» a «te devolvió la que ya
  estaba».
- ✅ **Pipeline de canvas** en `admin/src/scripts/recorte.ts`, con **recorte cuadrado
  centrado automático**. El recorte asistido queda descartado, ver §8.3.
- ✅ **Formulario de §9** en `admin/src/pages/nuevo.astro`, con aviso de código
  existente mientras se escribe y alta que ofrece **editar** en vez de fallar.
- ✅ **Retirado el selector de color** de las dos pantallas y del camino de
  escritura. `<input type="color">` no tiene estado vacío, así que estampaba un
  `color_hex` que nadie eligió, contra `SPEC.md` §6.6. Ver §9.
- ✅ **Probado con fotos de celular reales y publicado de punta a punta.** Es el
  criterio de salida, cumplido el 2026-08-10 con `CG15303`.

Va **antes** del scrape a propósito: construye y valida el pipeline de imágenes
con el caso controlado —un archivo elegido a mano— en vez de estrenarlo dentro
del scrape, donde un fallo se confunde con un problema de red o de parseo.

Criterio de salida: producto cargado a mano, con foto de celular recortada,
publicado y visible. `w300` y `w600` en R2, y el `srcset` del sitio funcionando
sin tocar `src/`.

**✅ CUMPLIDO el 2026-08-10.** `CG15303`, `proveedor: manual`, cargado desde `/nuevo`
con fotos de celular, aprobado, publicado, y respondiendo 200 en
`/productos/cartera-de-fiesta` con sus 3 fotos.

Hubo un momento en que pareció cumplido y no lo estaba, y vale anotarlo: ya había dos
productos publicados con sus fotos, `w300` y `w600` en R2 y `srcset` andando — pero los
dos eran `proveedor: chenson`, o sea que **entraron por el scrape**. Son dos caminos
distintos del mismo pipeline y no se prueban entre sí:

| | Alta manual (§8.3) | Scrape (§8.1) |
|---|---|---|
| Función | `subirFoto` | `subirFotoDelOrigen` |
| Encuadre | cuadrado centrado, **recorta** | entra entera, **rellena** |
| Origen de los bytes | `<input type="file">` | el puente del Worker |
| Tamaño típico | 4000 × 3000 de celular | 600 × 600 del proveedor |

Lo que el scrape prueba es el tramo compartido —canvas, derivadas, subida a R2, dedupe
por hash y `srcset`—; el recorte sobre una foto grande sólo lo ejercita esta fase.
Cerrar la fase con la evidencia del scrape habría sido dar por probado un camino que
nunca corrió.

### Fase 2.5 — Scrape (desplegable) · **CERRADA 2026-08-07**

- ✅ **Convenciones del origen** en `admin/src/lib/scrape/origen.ts` — 22 tests.
  Todo lo que sabe cómo está armado el sitio del proveedor vive ahí y en ningún otro
  lado: el día que rediseñen hay **un** archivo que mirar y una tanda de tests que se
  pone roja.
- ✅ **Extractor** en `scrape/extractor.ts` — 19 tests. Es un acumulador de eventos y
  no un parser porque `HTMLRewriter` **no existe en Node**, y un extractor que lo use
  por dentro no se puede testear. El envoltorio (`scrape/ficha.ts`) no tiene ni un
  `if`.
- ✅ **Listado con filtro por `lz`** (`scrape/listado.ts`, 8 tests) y **cortesía**
  (`scrape/robots.ts`, 10 tests).
- ✅ **Registro que no pisa curaduría** en `scrape/registrar.ts` — 16 tests. Más la
  migración `0003`, que agrega la columna que §7.5 pedía y no existía.
- ✅ **Contabilidad de la corrida** en `scrape/corrida.ts` — 9 tests, con caducidad a
  los 30 minutos para que una pestaña cerrada no bloquee el admin para siempre.
- ✅ **Los 5 endpoints** de §7.2, incluidos los dos que la costura de §8.1 obligó a
  agregar.
- ✅ **Plan y progreso del bucle** en `scrape/marcha.ts` — 37 tests. Puro y testeable
  aunque corra en el navegador (§10.2).
- ✅ **Pantalla de §10.2** en `admin/src/pages/importar.astro` y
  `admin/src/scripts/importar-cliente.ts`.
- ✅ **`/img-dev`** para ver las miniaturas del R2 local en desarrollo (§8.1).
- ✅ Migración `0003` aplicada en el D1 **remoto**.

Criterio de salida, sobre una URL de lanzamientos real:

1. ✅ Se recorren todas las páginas del listado. Medido: 4 páginas, 16 fichas cada
   una.
2. ✅ Un modelo con 3 colores entra con sus 3 variantes y **todas con su foto**.
   Verificado en D1 sobre `CG85700`: `-3`, `-T` y `-B`, una foto cada una, hashes
   distintos, y las 6 derivadas servidas.
3. ✅ Correrlo dos veces no duplica nada y no pisa ninguna edición manual.
4. ✅ Una ficha caída queda en `scrape_errores` y no corta la corrida.
5. ✅ El paso al proveedor no supera 1 request por segundo. Cuenta **cada** pedido,
   fotos incluidas.

Los dos hallazgos que costaron un bug cada uno están en §7.2: el color propio sólo
está en `og:title`, y la foto de cada hermano ya viene en la ficha visitada.

### Fase 2.6 — Eliminación y papelera (desplegable) · **CERRADA 2026-08-07**

- ✅ **Núcleo** en `admin/src/lib/papelera.ts` — 36 tests. `planearEliminacion`,
  `eliminar`, `restaurar`, `listarPapelera`, `contarPurga`, `purgar` y `fechaDeCorte`.
- ✅ **Migración `0004`**: `eliminado_en` y `eliminado_por`, que §10.5 pedía —«fecha,
  quién lo hizo»— y el esquema no tenía. Aplicada en local y en **remoto**.
- ✅ **Confirmación de §12.2** en `admin/src/pages/eliminar.astro`, con un mensaje
  distinto por grupo y sólo el irreversible pintado.
- ✅ **Papelera de §10.5** en `admin/src/pages/eliminados.astro`, con restaurar y
  vaciar en dos pasos.
- ✅ `clavesDeImagen` en `lib/imagenes.ts` para que la purga se lleve todas las
  derivadas de R2.

Lo que se aprendió construyéndola:

- **Una foto compartida con un producto que sobrevive no es huérfana.** Es el dedupe
  de `SPEC.md` §6.8 funcionando: la misma imagen cuelga de variantes de productos
  distintos. Sin ese filtro, borrar un producto le arranca la foto a otro que sigue
  publicado. Y contar las huérfanas de a un producto en vez de por lote diría que una
  foto sobrevive porque la usa otro que también se está borrando.
- **Primero la base, después R2.** Al revés, un fallo entre las dos bajas deja filas
  apuntando a objetos borrados, que es una foto rota en el catálogo. En este orden el
  peor caso es un objeto que nadie referencia: invisible, y el espacio nunca fue el
  problema (§12.1).
- **El `slug` no se libera al eliminar.** La URL sigue siendo de ese producto aunque
  no se muestre: es lo que permite restaurarlo sin que el enlace cambie, y lo que
  evita que otro producto se quede con una dirección que ya circuló.
- **La purga ignora los `eliminado` sin fecha.** Las filas anteriores a la migración
  `0004` tienen `eliminado_en` en NULL; sin ese filtro la primera purga se llevaría
  todo lo histórico sin poder evaluar su antigüedad. En la papelera se muestran como
  «antes de llevar registro».
- **`fechaDeCorte` fija el día después de mover el mes.** `setUTCMonth` sobre un 31 en
  un mes de 30 rueda al siguiente: «31 de agosto menos 6 meses» daría «31 de febrero»
  = 3 de marzo, y la purga se comería un mes extra.

Criterio de salida: un producto nunca publicado se borra con sus fotos; uno publicado
va a la papelera y se restaura con la misma URL; y vaciar informa qué se lleva antes
de hacerlo. ✅ Verificado sobre la base local, incluida la purga de un eliminado de
2025 que no tocó uno de agosto.

### Fase 2.7 — El código como campo visible (desplegable) · **CERRADA 2026-08-07**

- ✅ **Código en la ficha, junto al nombre.** Ya se renderizaba, pero en la lista de
  abajo entre la marca y las categorías. Se subió: es el dato con el que un cliente
  pregunta, así que va donde la vista cae primero.
- ✅ **Código en el mensaje de WhatsApp** — 6 tests nuevos en `src/lib/whatsapp.ts`.
- ⬜ Campo `k` en el índice de búsqueda de `SPEC.md` §9.4. **No entra: ese índice es
  de la Fase 3 de `SPEC.md` y todavía no existe.** Queda anotado acá y en §5.3 para
  cuando se construya.

El mensaje quedó así:

```
Hola! Me interesa este producto:

Mochila juvenil acolchada — Negro
Código: CG84455
https://…/productos/mochila-juvenil-acolchada
```

- **El código va rotulado y en su propia línea**, no pegado al nombre entre
  paréntesis. Quien atiende ESCANEA la conversación en vez de leerla, y un `CG85527`
  suelto se confunde con parte del nombre del producto.
- **La URL queda siempre al final**: es lo que la mayoría de los clientes de chat
  convierten en vista previa, y texto después la parte al medio.
- **`codigo` es opcional y un valor en blanco se trata como ausente.** Si un día una
  ficha se rinde sin él, el botón principal del sitio no puede quedar roto ni mostrar
  «Código:» sin nada al lado, que se lee como un error del sitio.

**No se agregó un campo `codigo` a `productos.json`.** Ya está en `origen.ref`, y
§5.3-3 lo diseñó así para absorber el producto manual sin tocar el schema de Astro.
Dos copias del identificador es una que se puede desincronizar. Lo que se corrigió es
el comentario de `content.config.ts`, que decía «no se renderiza» y era cierto hasta
esta fase.

Va última porque es la única que toca `src/`, y conviene hacerlo cuando el resto
ya está estable.

---

## 15. Fuera de alcance de la etapa 2

| Tema | Nota |
|---|---|
| Sitio público con SSR o lectura de D1 | Sigue prohibido (§4.2) |
| Categorías administrables desde el admin | Siguen en git (§5.4) |
| Múltiples roles o permisos en el admin | Todos los usuarios de Access pueden todo. Son 1–3 personas |
| Historial de cambios por campo | El historial es el de git sobre `productos.json` (§4.3) |
| Scrape programado o automático | Se dispara a mano. Un scrape automático publicaría sin que nadie mire |
| Segundo proveedor | El esquema lo soporta (`proveedor`), el mapeo de categorías no está generalizado |
| Edición de precios en lote | No pedido |
| Hash perceptual para dedupe | Sigue fuera (`SPEC.md` §6.8) |
| Eliminación de marcas de agua | Sigue fuera (`SPEC.md` §5.6) |
| Dominio propio, `INDEXABLE=true`, sitemap | Fase 2 de `SPEC.md` §11. No se mezcla acá |
| Image Transformations de Cloudflare | Requieren dominio en Cloudflare. No disponibles en `.workers.dev` |

---

## 16. Preguntas abiertas

**~~Minutos de GitHub Actions en repo privado~~** — RESUELTA el 2026-08-07
**No aplica: el repositorio es público** (`github.com/marfig/ybe-catalogo`,
verificado contra la API sin autenticación). En repos públicos los runners estándar
no consumen minutos de la cuota, así que la publicación por Actions (§11.2) no tiene
techo que administrar. La alternativa que esta pregunta proponía —hacerlo público— ya
era el estado de hecho. Workers Builds queda descartado por innecesario.

**Llamadas por binding y el límite de subrequests** — sigue abierta, y ya no urge
Se asumió que D1 y R2 vía binding no cuentan como subrequests `fetch`. La Fase 2.5
corrió un lanzamiento completo sin acercarse al límite, pero **eso no aísla la
pregunta**: con la granularidad final —una ficha por request, una imagen por request—
el presupuesto queda tan holgado que no fallaría de ninguna de las dos formas. Dicho
de otra manera: la mitigación que esta pregunta temía tener que aplicar (*«partir por
imagen»*, escalón 2 de §7.3) **ya está aplicada**, por otro motivo (§8.1). Queda como
dato pendiente, no como riesgo.

**~~Paginación del listado de lanzamientos~~** — RESUELTA el 2026-08-03
Es `?lz={fecha}&page={N}`, con links numerados y flecha `»`, 16 productos por
página. Documentado en §7.2.

**~~Índice de fechas de lanzamiento~~** — DECIDIDA el 2026-08-03
Se descartó el selector de fechas. **El flujo es pegar la URL y listo.** No se
construye un índice de lanzamientos disponibles: la URL la trae quien opera.

**~~Colores hermanos de un producto de lanzamiento~~** — RESUELTA el 2026-08-03
Sí traen el bloque. Verificado sobre `/producto/71803-cg86003`: `(9) AZUL` lista
`/producto/71805-cg86003` como `(A) VERDE OSCURO`. El `id` `#other-colors-tbl` de
`SPEC.md` §2.3 no se pudo confirmar, así que la detección pasa a ser por patrón
de URL. Documentado en §7.2.

**Retención de Time Travel en D1 free**
No figuraba en la página de precios consultada. Importa poco porque el backup
real es git (§4.3), pero conviene saberlo.

**¿Algún producto tiene las medidas cargadas?**
El rótulo existe en la plantilla y la celda del valor está vacía en las 2 fichas
verificadas. Puede haber productos donde sí esté cargada. El extractor puede
leerla si aparece, pero **no debe asumir que existe** ni tratarla como obligatoria.

**~~¿Las imágenes en vivo son más grandes que 600 × 600?~~** — RESUELTA el 2026-08-07
**No: son exactamente 600 × 600.** Medido sobre el origen en vivo, leyendo los
marcadores SOF del JPEG de tres fotos de `/producto/71163-cg85700`:

| Archivo | Medidas | Bytes |
|---|---|---|
| `fa9b2d5d…jpg` | 600 × 600 | 124 472 |
| `0a3e8919…jpg` | 600 × 600 | 115 561 |
| `a6d21d08…jpg` | 600 × 600 | 127 913 |

El techo duro de `SPEC.md` §2.2-3 queda **confirmado contra el origen real**, no sólo
contra `samples/`. **No hay zoom ni derivada por encima de 600**, y §5.2 sigue vigente
sin cambios. El peso de 115–184 KB era JPEG sin optimizar, no más resolución.

**¿Hay productos con más de una foto de galería?** — sigue abierta, con más evidencia
`CG86003` y `CG85700` tienen **una sola** cada uno. Todas las fichas medidas hasta hoy
dan exactamente una foto con `alt="product-thumb"`. El modelo lo soporta —`SPEC.md`
§4.4 muestra una variante con 2— y el código también: la galería es un `Set` y el
color propio recibe la lista completa, así que si aparece una segunda entra sin tocar
nada. **No es una pregunta que bloquee: es sólo un dato que no está confirmado.**

**Meses por defecto de la purga**
§12.3 propone 6. Es una decisión de negocio.

**Redes sociales**
Sigue abierta de `SPEC.md` §12, para `sameAs` y el footer.

---

## 17. Referencias

Consultadas el 2026-08-03.

- [Workers · Limits](https://developers.cloudflare.com/workers/platform/limits/) — 100.000 req/día, 10 ms de CPU, 50 subrequests, cuerpo de 100 MB en el plan Free
- [Workers · Static Assets · Billing and limitations](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) — *«Requests to static assets are free and unlimited»*; cuándo un request sí cuenta como invocación
- [D1 · Pricing](https://developers.cloudflare.com/d1/platform/pricing/) — 5 GB, 5M filas leídas/día, 100.000 filas escritas/día
- [R2 · Pricing](https://developers.cloudflare.com/r2/pricing/) — 10 GB-mes, 1M Class A, 10M Class B, egress gratis, `DeleteObject` gratis
- [Changelog · Queues now available on Workers Free plan](https://developers.cloudflare.com/changelog/post/2026-02-04-queues-free-plan/) — gratis desde 2026-02-04, 10.000 ops/día
- [Workers · Routing · workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/) — *«Enable Cloudflare Access»* sobre el subdominio, con lista de emails autorizados
- [R2 · Public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/) — dominio público del bucket para `PUBLIC_R2_BASE`
