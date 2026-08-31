-- ---------------------------------------------------------------------------
-- Un video opcional POR PRODUCTO
--
-- Hasta aca el catalogo tenia un solo medio: la imagen. Y "imagen" no es una
-- tabla, es un CONCEPTO horneado en siete capas que afirman, cada una por su
-- cuenta, lo mismo: un medio = un WebP cuadrado con anchos en {300,600}. El
-- esquema (`anchos NOT NULL`), la clave de R2 (`catalogo/{hash16}/w{n}.webp`),
-- la validacion de subida, el volcado, el schema zod publico, el render con
-- srcset, y el indice de busqueda.
--
-- El video no entra por ahi, y no se lo fuerza a entrar.
--
-- POR QUE POR PRODUCTO Y NO POR VARIANTE. No es "menos trabajo", son tres
-- razones estructurales:
--
--   1. 0..1 es una columna nullable. No hace falta tabla de union: la union
--      `variante_imagenes` existe para el dedupe de fotos repetidas entre SKU
--      (§6.8), un problema que un video por producto no tiene. Sin tabla de
--      union no hay columna `orden`, y sin `orden` no hay desempates que el
--      volcado tenga que resolver para seguir siendo determinista.
--
--   2. La invariante de la foto de portada se vuelve IMPOSIBLE de romper. La
--      og:image, el JSON-LD, la miniatura de la grilla y el indice de busqueda
--      leen todos `variantes[0].imagenes[0]`. Un video colgado del producto no
--      entra nunca en ese arbol. No es una regla que haya que vigilar: es una
--      rama del arbol donde el video no vive.
--
--   3. El video no cambia con el color, asi que se renderiza fuera de la isla
--      de Preact, en el .astro estatico. Cero cambios en el selector de
--      variantes y cero JS de cliente nuevo.
--
-- SIN TRANSCODIFICAR, SUBIDA MANUAL. sharp no corre en Workers: por eso las
-- derivadas de las imagenes se generan en el canvas del navegador. Y el canvas
-- puede redimensionar una imagen pero NO puede transcodificar un video. En vez
-- de pelear con ese limite, se lo esquiva: entra el archivo tal cual, con tope
-- de 10 MB. El compresor ya existe y es el que se usa todos los dias — mandar
-- el video por WhatsApp lo deja en 1-3 MB. Un video de camara sin pasar por ahi
-- (1080p30 son ~17 Mbps) no baja de 30 MB y se rechaza; el mensaje de rechazo
-- tiene que ensenar ese camino, no solo negar.
--
-- NADA QUE MIGRAR. Es puramente aditivo: `imagenes`, `variantes` y
-- `variante_imagenes` no se tocan, ningun producto existente cambia de estado y
-- no hay backfill.
-- ---------------------------------------------------------------------------

CREATE TABLE videos (
  id        INTEGER PRIMARY KEY,

  -- Mismo dedupe que `imagenes.hash16`, y por el mismo motivo: el hash ES la
  -- clave del objeto en R2 (`videos/{hash16}/`). Dos filas con el mismo hash
  -- serian dos duenos del mismo objeto, y borrar una dejaria a la otra
  -- apuntando al vacio.
  hash16    TEXT    NOT NULL UNIQUE,

  -- OJO: no cumplen la funcion que cumplen en `imagenes`. Alla `ancho_origen`
  -- evita generar una derivada mas grande que el original. Aca no hay derivadas
  -- que generar: ancho y alto sostienen el aspect-ratio del <video> para que la
  -- ficha no salte cuando el archivo carga, igual que ImagenProducto declara
  -- width y height explicitos.
  ancho     INTEGER NOT NULL,
  alto      INTEGER NOT NULL,

  -- Para mostrar el peso en el admin y para auditar el tope de 10 MB despues
  -- del hecho.
  bytes     INTEGER NOT NULL,

  -- SIN columna para el poster: se deriva del mismo hash
  -- (`videos/{hash16}/poster.webp`), asi que guardarla seria guardar dos veces
  -- el mismo dato con la posibilidad de que discrepen.
  --
  -- SIN `duracion_ms`: no se muestra en ningun lado. Por el criterio de la 0004,
  -- una columna para un caso que no existe es peso que toda consulta arrastra.
  creado_en TEXT    NOT NULL
);

-- El video cuelga del PRODUCTO. SQLite solo acepta REFERENCES en un ADD COLUMN
-- cuando el default es NULL, que es justo lo que se quiere: opcional y sin
-- backfill.
--
-- Sin ON DELETE CASCADE y sin SET NULL, a proposito y en las dos direcciones:
--
--   - Borrar un video que un producto esta usando tiene que FALLAR, no vaciar
--     la ficha en silencio. Quitarle el video a un producto es una decision
--     explicita del admin, un UPDATE.
--
--   - Borrar el producto NO borra el video: la fila queda huerfana a proposito,
--     porque la fila es lo unico que sabe que existe un objeto de 10 MB en R2.
--     La recoleccion de huerfanas (§12.3) se lleva los dos juntos. Un CASCADE
--     aca borraria la fila y dejaria el objeto en R2 para siempre, sin nadie que
--     supiera de el. Una foto huerfana pesa 40 KB y no se nota; un video, si.
ALTER TABLE productos ADD COLUMN video_id INTEGER REFERENCES videos(id);

-- Parcial, misma convencion deliberada que 0003 y 0005: los productos con video
-- van a ser una minoria, y el indice solo tiene que conocer a esos. Sirve tanto
-- para listarlos en el admin como para la consulta inversa —que videos no usa
-- nadie— de la recoleccion de huerfanas.
CREATE INDEX idx_productos_video
  ON productos(video_id)
  WHERE video_id IS NOT NULL;
