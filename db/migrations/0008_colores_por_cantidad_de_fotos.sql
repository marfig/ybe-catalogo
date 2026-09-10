-- ---------------------------------------------------------------------------
-- Los colores con mas fotos, primero
--
-- MIGRACION DE DATOS, NO DE ESQUEMA: es la primera de esta carpeta que no crea
-- ni altera nada y solo reescribe filas. No agrega columnas porque no hace falta
-- ninguna: `variantes.orden` ya es la unica fuente de verdad del orden de los
-- colores, y el color "principal" de un producto es simplemente el primero — no
-- hay campo `principal` a proposito, ni lo va a haber. Ese `orden` es lo que
-- consumen el volcado (`construir.mjs`), `varianteInicial()`, la miniatura de la
-- tarjeta, la del buscador, el mensaje de WhatsApp y el `og:image`.
--
-- POR QUE LA CANTIDAD DE FOTOS Y NO EL ALFABETO. El alta ordenaba por nombre de
-- color, que es un criterio comodo y sin ninguna relacion con lo que el cliente
-- ve: un producto cuya "A" trae una sola foto de catalogo se presenta con esa,
-- mientras el color que tiene seis fotos de estudio queda tercero y nadie lo
-- abre. Cuantas fotos tiene un color es lo mas parecido a "cuanto material hay
-- para mostrarlo" que la base sabe hoy.
--
-- EL EMPATE SE DESEMPATA POR EL `orden` ACTUAL, Y NO ES UN DETALLE. Dos colores
-- con la misma cantidad de fotos conservan la posicion relativa que ya tenian,
-- asi que lo que era alfabetico sigue alfabetico dentro de cada grupo y el
-- resultado no depende del planificador. Sin ese desempate la migracion no seria
-- determinista y correrla de nuevo podria dar otro color de portada.
--
-- LO QUE ESTA MIGRACION SI HACE Y 0005 NO HARIA: PISAR CURADURIA. Se aplica al
-- catalogo ENTERO, incluidos los productos que alguien reordeno a mano con las
-- flechas del admin, y el orden anterior no queda guardado en ningun lado: es
-- irreversible. Es una decision explicita e informada del dueno del catalogo, no
-- un descuido, y por eso no lleva ninguna guarda que exceptue a los productos ya
-- curados — una guarda dejaria la mitad del catalogo con el criterio viejo y la
-- otra con el nuevo, que es el peor de los dos mundos.
--
-- DE UNA SOLA VEZ. Wrangler no la vuelve a aplicar, y no debe correrse a mano una
-- segunda vez: para las altas nuevas el criterio ya vive en `registrarFicha`, que
-- ordena los colores de un producto nuevo por cantidad de fotos con el mismo
-- desempate alfabetico. Esta migracion existe solo para los productos que se
-- importaron antes de eso.
-- ---------------------------------------------------------------------------

-- `LEFT JOIN` y no `JOIN`: un color sin ninguna foto existe igual en la ficha —el
-- catalogo le dibuja el placeholder— y tiene que recibir su lugar en la secuencia.
-- Con un INNER se quedaria sin `orden` nuevo, mezclado con la numeracion vieja.
--
-- `row_number() - 1` deja la secuencia densa y desde 0, que es la forma que
-- esperan el resto de los caminos. El catalogo real llega aca con huecos: los
-- colores nuevos entran con `max(orden)+1` y el reordenamiento del admin los
-- deja salteados.
UPDATE variantes
   SET orden = nuevo.orden
  FROM (
         SELECT v.id,
                row_number() OVER (
                  PARTITION BY v.producto_id
                      ORDER BY count(vi.imagen_id) DESC, v.orden ASC
                ) - 1 AS orden
           FROM variantes v
                LEFT JOIN variante_imagenes vi ON vi.variante_id = v.id
          GROUP BY v.id
       ) AS nuevo
 WHERE nuevo.id = variantes.id;
