-- ---------------------------------------------------------------------------
-- Pedidos especiales (SPEC.md §4.5)
--
-- Los articulos que se venden POR CANTIDAD, con precio negociado caso por caso.
-- La coleccion nacio como un JSON mantenido a mano —igual que categorias.json—
-- y esta tabla existe por un motivo concreto: el admin corre en Cloudflare y no
-- tiene filesystem, asi que no hay forma de que edite un archivo del repo. Para
-- que se puedan cargar desde el panel, el dato tiene que vivir en D1 y salir por
-- el mismo volcado que productos.json.
--
-- TABLA PROPIA Y NO COLUMNAS EN `productos`, por la misma razon que la coleccion
-- es aparte y no un flag: un producto exige variantes con `sku` y `color`, y
-- estos articulos no tienen ninguno de los dos. Compartir la tabla obligaria a
-- inventar una variante falsa por fila y a que toda consulta de catalogo tuviera
-- que filtrarlas.
-- ---------------------------------------------------------------------------
CREATE TABLE pedidos_especiales (
  id             INTEGER PRIMARY KEY,

  -- El `id` de la coleccion de Astro, o sea el segmento de URL. UNIQUE porque
  -- dos filas con el mismo slug generarian la misma pagina y una pisaria a la
  -- otra en el build, sin error.
  slug           TEXT    NOT NULL UNIQUE,

  nombre         TEXT    NOT NULL,

  -- NOT NULL, al reves que `productos.descripcion`, y la asimetria es la misma
  -- que defiende el `z.string().min(1)` del schema: una ficha de producto se
  -- sostiene sin descripcion —tiene precio, codigo, colores, marca—, y aca la
  -- descripcion ES la ficha. Sin ella el detalle es un clic hacia la misma foto
  -- que ya estaba en la tarjeta.
  --
  -- Se exige desde el alta y no hay estado `borrador`: estas filas se cargan a
  -- mano de a una, no las importa un scrape a medio completar. Un estado que
  -- solo existe para permitir guardar algo incompleto es una maquina de estados
  -- que nadie pidio.
  descripcion    TEXT    NOT NULL,

  -- UNA imagen, no un arreglo: no hay colores que elegir, asi que la segunda
  -- foto no tendria quien la seleccione. Referencia a `imagenes` y no un hash
  -- suelto para que la recoleccion de huerfanas (§12.3) la vea como cualquier
  -- otra referencia. Sin ON DELETE CASCADE: borrar una imagen que una ficha esta
  -- usando tiene que fallar, no vaciar la ficha en silencio.
  imagen_id      INTEGER NOT NULL REFERENCES imagenes(id),

  -- Curaduria, mismo criterio que `categorias.json`: quien carga decide el orden.
  orden          INTEGER NOT NULL DEFAULT 999,

  -- Oculta sin borrar, igual que `productos.activo`.
  activo         INTEGER NOT NULL DEFAULT 1,

  creado_en      TEXT    NOT NULL,
  actualizado_en TEXT    NOT NULL
);

-- Para la recoleccion de imagenes huerfanas al vaciar la papelera (§12.3): sin
-- esto el barrido tendria que escanear la tabla entera por cada imagen candidata.
CREATE INDEX idx_pedidos_especiales_imagen ON pedidos_especiales(imagen_id);
