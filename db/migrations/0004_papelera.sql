-- ---------------------------------------------------------------------------
-- La papelera (SPEC-etapa2 §10.5, §12.2)
--
-- §10.5 pide que la papelera muestre "fecha, quien lo hizo, y dos acciones", y
-- no habia donde guardar ninguno de los dos datos. Es el mismo hueco que tenia
-- §7.5 antes de la migracion 0003: la regla estaba escrita en la spec y el
-- esquema no la soportaba.
--
-- POR QUE IMPORTA QUIEN. Eliminar un producto publicado saca de la calle algo
-- que un cliente puede tener enlazado por WhatsApp. Cuando alguien pregunta "y
-- esto por que no esta?", la respuesta tiene que existir en la base y no en la
-- memoria de una persona.
--
-- Las dos columnas se limpian al restaurar: un producto que volvio al catalogo
-- no tiene fecha de eliminacion. La historia de quien lo saco la primera vez se
-- pierde a proposito — no es un log de auditoria, es el estado actual de la
-- papelera, y confundir las dos cosas lleva a inventarse una tabla de eventos
-- que nadie pidio.
-- ---------------------------------------------------------------------------
ALTER TABLE productos ADD COLUMN eliminado_en TEXT;

-- El email de Access. NULL en las filas que ya estaban eliminadas antes de esta
-- migracion: no se puede inventar quien las saco.
ALTER TABLE productos ADD COLUMN eliminado_por TEXT;

-- Sin indice a proposito. La papelera se consulta por `estado = 'eliminado'`, que
-- ya cubre `idx_productos_estado`, y despues se ordena sobre esas pocas filas.
-- Un indice mas sobre una columna que casi siempre es NULL es peso sin uso.
