-- Esquema inicial de D1 (SPEC-etapa2 §5.1).
--
-- D1 es la fuente de verdad de los productos. El sitio publico NO lee de aca:
-- el build vuelca esta base a src/data/productos.json y todo src/ sigue
-- consumiendo Content Collections sin enterarse de que existe una base
-- (SPEC-etapa2 §4.2).
--
-- Las categorias NO viven aca: siguen en src/data/categorias.json, escritas a
-- mano y versionadas (SPEC-etapa2 §5.4a).
--
-- EL MOTIVO ESCRITO ACA ERA FALSO. Decia que una tabla se desincronizaria de
-- reference('categorias'), «que es lo que hoy rompe el build ante un slug
-- invalido». reference() NO valida que la categoria exista y NO rompe el build:
-- solo normaliza la forma del dato. La explicacion completa, con el puntero al
-- codigo de Astro, esta en src/content.config.ts.
--
-- EL MOTIVO QUE SI SE SOSTIENE es mas simple, y no depende de ninguna validacion:
-- el sitio publico carga las categorias con el loader file() de Astro sobre ese
-- JSON, asi que el archivo versionado tiene que existir de todas formas. Una tabla
-- aca seria una SEGUNDA fuente del mismo dato, y dos copias del mismo dato es una
-- que se puede desincronizar. El admin sigue el mismo criterio: importa EL MISMO
-- archivo en vez de copiarlo (ver admin/src/lib/categorias.ts).
--
-- LO QUE ESTO CUESTA, para que quede dicho: sin tabla no hay foreign key posible
-- sobre producto_categorias.categoria_slug, asi que sacar una categoria del JSON
-- deja vinculos apuntando a un slug que ya no existe y nada los limpia.

-- ---------------------------------------------------------------------------
-- productos — la unidad de curaduria y de publicacion
-- ---------------------------------------------------------------------------
CREATE TABLE productos (
  id             INTEGER PRIMARY KEY,

  -- Identidad de negocio (SPEC-etapa2 §5.3). UNIQUE global reemplaza al
  -- manifest.json de SPEC §6.7: un codigo ya visto se actualiza, no se duplica,
  -- y no hay archivo de estado que se pueda desincronizar.
  codigo         TEXT    NOT NULL UNIQUE,

  proveedor      TEXT    NOT NULL,          -- 'chenson' | 'manual'

  -- El id publico. NULL hasta aprobar: la URL nace en ese momento y desde ahi es
  -- inmutable (SPEC §6.7 "la URL sobrevive"). SQLite admite varios NULL en UNIQUE.
  slug           TEXT             UNIQUE,

  nombre         TEXT,                      -- NULL al importar; obligatorio para aprobar
  descripcion    TEXT,
  precio         INTEGER,                   -- guaranies, sin decimales. NULL = "Consultar"
  destacado      INTEGER NOT NULL DEFAULT 0,

  estado         TEXT    NOT NULL DEFAULT 'importado'
                 CHECK (estado IN ('importado','aprobado','publicado','eliminado')),

  -- NULL por el camino de lanzamientos: el origen no expone la categoria
  -- (SPEC-etapa2 §5.4b). Se conserva para un scrape futuro por categoria.
  categoria_origen TEXT,
  url_origen     TEXT,                      -- ficha del proveedor. Auditoria
  scrape_id      INTEGER REFERENCES scrapes(id),

  creado_en      TEXT    NOT NULL,
  actualizado_en TEXT    NOT NULL,
  publicado_en   TEXT,                      -- primera publicacion. NULL = nunca fue publico

  -- Invariante que el volcado tambien verifica: todo estado publicable tiene
  -- slug. Vale la pena en la base ademas del codigo, porque un UPDATE mal hecho
  -- desde el admin no deberia poder dejar la fila en un estado imposible.
  CHECK (estado = 'importado' OR slug IS NOT NULL)
);

CREATE INDEX idx_productos_estado ON productos(estado);
CREATE INDEX idx_productos_proveedor ON productos(proveedor);

-- ---------------------------------------------------------------------------
-- variantes — un color. Comparte nombre y precio con el producto (SPEC §4.2)
-- ---------------------------------------------------------------------------
CREATE TABLE variantes (
  id           INTEGER PRIMARY KEY,
  producto_id  INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,

  -- {codigo}-{codigoColor}: estable y semantico. Nunca un indice posicional, asi
  -- que agregar un color no mueve los SKU existentes (SPEC §6.6).
  sku          TEXT    NOT NULL UNIQUE,

  color        TEXT    NOT NULL,           -- normalizado, sin el prefijo (X)
  color_origen TEXT,                       -- '(P) ROSADO' literal. Auditoria
  color_hex    TEXT,                       -- #rrggbb o NULL. NUNCA se inventa (SPEC §6.6)
  activo       INTEGER NOT NULL DEFAULT 1,
  orden        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_variantes_producto ON variantes(producto_id);

-- ---------------------------------------------------------------------------
-- imagenes — direccionadas por contenido (SPEC §5.1, §6.8)
-- ---------------------------------------------------------------------------
CREATE TABLE imagenes (
  id           INTEGER PRIMARY KEY,

  -- sha256 de los BYTES ORIGINALES, primeros 16 hex. Nunca del WebP que produce
  -- el navegador: los encoders varian entre navegadores y hashear la salida
  -- romperia el dedupe en silencio (SPEC-etapa2 §8.1).
  hash16       TEXT    NOT NULL UNIQUE,

  -- JSON: '[300,600]' o '[300]'. Explicito porque un origen de menos de 600 px
  -- genera solo w300, y sin este dato el srcset apuntaria a un archivo
  -- inexistente (SPEC §5.5).
  anchos       TEXT    NOT NULL,

  ancho_origen INTEGER NOT NULL,
  alto_origen  INTEGER NOT NULL,
  bytes_origen INTEGER NOT NULL,
  creado_en    TEXT    NOT NULL
);

-- Muchas a muchas: la misma foto puede pertenecer a variantes de distintos
-- productos. Es exactamente el caso de dedupe de SPEC §6.8.
CREATE TABLE variante_imagenes (
  variante_id  INTEGER NOT NULL REFERENCES variantes(id) ON DELETE CASCADE,
  imagen_id    INTEGER NOT NULL REFERENCES imagenes(id),
  orden        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (variante_id, imagen_id)
);

-- Para la recoleccion de imagenes huerfanas al vaciar la papelera (§12.3).
CREATE INDEX idx_variante_imagenes_imagen ON variante_imagenes(imagen_id);

-- ---------------------------------------------------------------------------
-- producto_categorias — el orden importa: categorias[0] es el breadcrumb
-- ---------------------------------------------------------------------------
CREATE TABLE producto_categorias (
  producto_id    INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,

  -- Se valida contra src/data/categorias.json, no contra una tabla (§5.4a). QUIEN y
  -- CUANDO: validarParaAprobar, en el admin, al aprobar. Nada lo verifica en el
  -- INSERT ni lo vuelve a mirar despues, asi que esta columna puede contener un slug
  -- que ya no existe en el archivo.
  categoria_slug TEXT    NOT NULL,

  orden          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (producto_id, categoria_slug)
);

CREATE INDEX idx_producto_categorias_slug ON producto_categorias(categoria_slug);

-- ---------------------------------------------------------------------------
-- scrapes — reemplaza al crudo-{fecha}.json de SPEC §6.3 como registro
-- auditable de "de donde salio cada producto"
-- ---------------------------------------------------------------------------
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

-- Una ficha que fallo. No aborta el scrape: fallo tolerante (SPEC §6.2).
CREATE TABLE scrape_errores (
  id        INTEGER PRIMARY KEY,
  scrape_id INTEGER NOT NULL REFERENCES scrapes(id) ON DELETE CASCADE,
  url       TEXT    NOT NULL,
  motivo    TEXT    NOT NULL,
  creado_en TEXT    NOT NULL
);

CREATE INDEX idx_scrape_errores_scrape ON scrape_errores(scrape_id);

-- ---------------------------------------------------------------------------
-- publicaciones — alimenta el estado visible en el admin (§11.3)
--
-- Sin esta tabla, un build fallido es un check rojo en GitHub, y eso no existe
-- para quien no entra a GitHub. Es la pieza que hace seguro el auto-publish con
-- una persona no tecnica.
-- ---------------------------------------------------------------------------
CREATE TABLE publicaciones (
  id            INTEGER PRIMARY KEY,
  estado        TEXT    NOT NULL
                CHECK (estado IN ('pendiente','corriendo','ok','error')),
  disparada_por TEXT    NOT NULL,          -- email que reporta Cloudflare Access
  disparada_en  TEXT    NOT NULL,
  terminada_en  TEXT,
  productos     INTEGER NOT NULL DEFAULT 0,
  run_url       TEXT,                      -- run de GitHub Actions
  commit_sha    TEXT,
  error         TEXT                       -- mensaje en castellano para el admin
);

CREATE INDEX idx_publicaciones_disparada_en ON publicaciones(disparada_en);
