-- ---------------------------------------------------------------------------
-- Aviso de cambio en el origen (SPEC-etapa2 §7.5)
--
-- §7.5 exige que "un color nuevo del proveedor entra como variante nueva y el
-- producto queda marcado con un aviso en el admin", para que nadie autopublique
-- un color que nadie miro. No habia donde guardar esa marca.
--
-- Es una FECHA y no un booleano: sirve para ordenar la revision por antiguedad y
-- para saber si el aviso es de hoy o de hace tres meses. NULL = sin novedad.
--
-- Se limpia cuando una persona revisa el producto, no cuando se publica: publicar
-- sin mirar es exactamente lo que este aviso existe para evitar.
-- ---------------------------------------------------------------------------
ALTER TABLE productos ADD COLUMN cambio_en_origen TEXT;

-- Parcial: el indice solo indexa las filas con aviso, que son pocas. La consulta
-- del admin es "cuales tienen novedad", nunca "cual es la fecha de este".
CREATE INDEX idx_productos_cambio_en_origen
  ON productos(cambio_en_origen)
  WHERE cambio_en_origen IS NOT NULL;
