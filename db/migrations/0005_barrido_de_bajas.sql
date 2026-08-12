-- ---------------------------------------------------------------------------
-- Barrido de bajas en origen
--
-- El proveedor da de baja modelos y no avisa. Hasta ahora la unica forma de
-- enterarse era que un cliente preguntara por algo que ya no existe.
--
-- DOS FECHAS Y NINGUN BOOLEANO, por el mismo motivo que `cambio_en_origen` en la
-- migracion 0003: un `si/no` no deja ordenar la revision ni distinguir un aviso
-- de hoy de uno de hace tres meses.
--
--   revisado_en_origen — la ultima vez que se le PREGUNTO al proveedor por el.
--                        NULL = nunca se reviso.
--   ausente_desde      — la primera vez que dio ausente. NULL = esta presente.
--
-- LA PRIMERA ES "CUANDO SE REVISO", NO "CUANDO SE LO VIO VIVO", y la diferencia
-- no es de redaccion. Si guardara la ultima vez que aparecio, un producto dado
-- de baja quedaria con la fecha congelada para siempre, seria eternamente el mas
-- viejo de la cola y se lo volveria a preguntar en cada corrida — mientras el
-- resto del catalogo espera su turno detras de el.
--
-- Y esa fecha es lo que ordena la cola: se revisa primero lo que hace mas tiempo
-- que nadie mira. Por eso el barrido es reanudable — se corta a los cinco minutos
-- y la proxima corrida sigue por donde iba, sin volver a empezar y sin que ningun
-- producto quede sin revisar nunca.
--
-- LO QUE ESTE BARRIDO NO HACE: BORRAR. Marca, y una persona decide desde la
-- grilla con el flujo de eliminacion que ya existe (§12.2). Un scraper que borra
-- solo es la contracara de un scraper que publica solo, y del otro lado hay URLs
-- que viven para siempre en conversaciones de WhatsApp (§12.1).
-- ---------------------------------------------------------------------------
ALTER TABLE productos ADD COLUMN revisado_en_origen TEXT;
ALTER TABLE productos ADD COLUMN ausente_desde TEXT;

-- Parcial, igual que el de 0003: la consulta del admin es "cuales estan dados de
-- baja", que son pocos, nunca "desde cuando este". Indexar las filas presentes
-- seria indexar el catalogo entero para no consultarlo jamas.
CREATE INDEX idx_productos_ausente_desde
  ON productos(ausente_desde)
  WHERE ausente_desde IS NOT NULL;

-- La cola del barrido no lleva indice A PROPOSITO. Ordena por
-- `revisado_en_origen` sobre el catalogo entero, que son 1.500 filas en el
-- objetivo y 9 hoy: SQLite las ordena en memoria sin despeinarse. Un indice
-- sobre una columna que ademas se REESCRIBE en cada producto barrido es costo de
-- escritura puro.

-- ---------------------------------------------------------------------------
-- El tipo de corrida
--
-- `scrapes` deja de ser solo importaciones. Importa de verdad porque
-- `corridaEnCurso()` es lo que impide que dos recorridos le peguen al proveedor
-- a la vez: el paso de 1 request por segundo (§7.4) lo marca cada pestana por su
-- cuenta, asi que un barrido y una importacion simultaneos lo duplican sin que
-- nadie se entere. Comparten tabla para compartir esa guarda.
--
-- El default cubre las filas historicas: todo lo que existe hoy es importacion.
-- ---------------------------------------------------------------------------
ALTER TABLE scrapes ADD COLUMN tipo TEXT NOT NULL DEFAULT 'importacion';
