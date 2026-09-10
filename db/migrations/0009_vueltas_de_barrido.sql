-- ---------------------------------------------------------------------------
-- La vuelta del barrido
--
-- POR QUE HACE FALTA UNA TABLA PARA CONTAR. La pantalla del barrido tiene que
-- decir cuanto falta, y con `revisado_en_origen` sola ESO NO SE PUEDE SABER.
--
-- El barrido es una ROTACION: se revisan los 300 mas viejos, esos pasan a ser
-- los mas nuevos, y el catalogo queda igual de barrible que antes. Cualquier
-- cuenta derivada del estado —«cuantos faltan», «cuantas corridas quedan»— da
-- el mismo numero siempre, porque el estado despues de una corrida es
-- equivalente al de antes. La rotacion no tiene memoria.
--
-- Ya se intento dos veces y las dos salio mal:
--
--   1. `contarBarribles() - 300`. Dos constantes: decia 1157 en la primera
--      corrida y 1157 en la quinta.
--   2. `revisado_en_origen IS NULL`. Baja de verdad, pero UNA SOLA VEZ en la
--      vida del catalogo: llega a cero y no vuelve a subir nunca. Mide el
--      arranque en frio, no el trabajo.
--
-- Lo que faltaba era el ANCLA. Una cuenta regresiva necesita un punto de
-- partida, y el punto de partida de una vuelta no esta en los productos: esta
-- en cuando alguien decidio empezarla.
--
--   iniciada_en  — desde cuando cuenta esta vuelta. Un producto revisado ANTES
--                  de esta fecha sigue pendiente; uno revisado despues, ya no.
--   terminada_en — cuando se cubrio el catalogo entero. NULL = en curso.
--
-- SIN VENTANA DE DIAS, y no por simplificar. Un «pendiente a los 15 dias»
-- obliga a elegir cada cuanto se revisa el catalogo, y acá no hay cadencia: el
-- barrido se corre cuando se lo pide. Un plazo inventado haria que la pantalla
-- anuncie trabajo pendiente los lunes por el calendario y no por el catalogo.
-- ---------------------------------------------------------------------------
CREATE TABLE barrido_vueltas (
  id           INTEGER PRIMARY KEY,
  iniciada_en  TEXT NOT NULL,
  terminada_en TEXT
);

-- UNA SOLA VUELTA ABIERTA, garantizado por la base y no por una consulta previa
-- en el codigo. `abrirVuelta()` corre desde `/api/scrape/abrir`, que dos
-- pestañas pueden pedir a la vez: un `SELECT` y despues un `INSERT` tienen una
-- ventana entre medio, y dos vueltas abiertas dejarian la cuenta regresiva
-- dependiendo de cual de las dos gana el `ORDER BY`.
--
-- El indice es sobre la EXPRESION `terminada_en IS NULL`, que vale 1 en todas
-- las filas que el indice parcial admite. Un UNIQUE sobre `terminada_en` a secas
-- no serviria: en SQL dos NULL no son iguales, asi que no chocarian nunca.
CREATE UNIQUE INDEX idx_barrido_vueltas_abierta
  ON barrido_vueltas((terminada_en IS NULL))
  WHERE terminada_en IS NULL;
