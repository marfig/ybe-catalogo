/**
 * Los productos que quedaron sin ninguna foto y se les puede pedir de nuevo.
 *
 * POR QUÉ EXISTE ESTO Y NO ALCANZA CON REIMPORTAR. `unaFoto` está escrita para no lanzar
 * nunca (§7.4): si la red se cae en el medio, anota el problema en `scrape_errores` y la
 * corrida sigue. Eso es correcto —una foto caída no puede tumbar una importación de 900
 * fichas— pero deja un hueco que NO se cierra solo, y por dos motivos que se suman:
 *
 *   1. no hay reintento: la foto que falló, falló
 *   2. la importación viene con «saltear los que ya tengo» tildada, así que en la próxima
 *      corrida `sinVisitar` filtra justamente esas fichas — el producto ya está en la base
 *
 * O sea que el hueco es PERMANENTE hasta que alguien lo mire. Esta consulta es la lista de
 * trabajo, y el relleno lo hace `/api/scrape/ficha` más `traerFotos`: los mismos dos pasos
 * de la importación de todos los días, sin ningún camino de escritura nuevo.
 *
 * NO ES CÓDIGO DE UN SOLO USO, al contrario de `pendientes.ts`. Esa pasada existió para
 * cerrar un bug de regex que se arregló una vez; una foto que se cae por red va a volver a
 * pasar cada vez que la conexión titubee en el medio de una importación larga. Es
 * herramienta permanente.
 */
import type { Ejecutar } from '../grilla.ts';

/** Un producto al que hay que volver a pedirle la ficha para conseguir sus fotos. */
export interface ProductoSinFotos {
  id: number;
  codigo: string;
  /** La ficha del proveedor. Es lo que recibe `/api/scrape/ficha`. */
  url: string;
  /** Para que la pantalla pueda mostrar cuál está publicado y cuál esperando. */
  estado: string;
}

/**
 * A quién le falta TODA la foto.
 *
 * LAS CUATRO CONDICIONES, las mismas que `sinDescripcion` y por los mismos motivos:
 *
 *   sin ninguna imagen   — ver abajo: es `NOT EXISTS` y no un `LEFT JOIN`.
 *   `proveedor = 'chenson'` — los `manual` no salieron de ningún origen, y los
 *                        `catalogo-viejo` son EXACTAMENTE los que el proveedor ya no
 *                        publica: pedirles la ficha traería una página que no existe.
 *   `estado <> 'eliminado'` — ya se decidió sacarlos del catálogo. Si alguno se restaura,
 *                        vuelve a aparecer en esta lista solo.
 *   `url_origen` con algo — sin ficha no hay nada que pedir. Incluirlos daría un error por
 *                        producto en cada corrida, sobre algo que esto no puede resolver.
 *
 * `NOT EXISTS` Y NO UN `LEFT JOIN ... IS NULL`, y la diferencia decide la consulta: un
 * modelo de tres colores donde sólo uno trajo foto NO es un producto sin fotos. Volver a
 * pedir su ficha no arreglaría nada —las variantes vacías son colores que el proveedor
 * sirve sin imagen— y sería un request por corrida, para siempre. Hay un test que fija
 * exactamente ese caso.
 *
 * INCLUYE LOS PUBLICADOS a propósito, igual que `sinDescripcion`: un producto en la calle
 * sin foto está mostrándole el placeholder de «sin imagen» a un cliente que lo está
 * mirando, que es el caso que más molesta. Llegó ahí porque alguien marcó explícitamente
 * «permitir sin foto» al aprobarlo (`validarParaAprobar` lo bloquea de lo contrario), así
 * que conseguirle la foto es una mejora y no pisa ninguna decisión.
 *
 * Ordenado por código, que es estable entre corridas. Y no hace falta acordarse de por
 * dónde iba: lo ya resuelto sale de la lista solo, porque ya tiene foto.
 */
export async function sinFotos(ejecutar: Ejecutar): Promise<ProductoSinFotos[]> {
  return ejecutar<ProductoSinFotos>(
    `SELECT p.id, p.codigo, p.url_origen AS url, p.estado
       FROM productos p
      WHERE p.proveedor = 'chenson'
        AND p.estado <> 'eliminado'
        AND trim(COALESCE(p.url_origen, '')) <> ''
        AND NOT EXISTS (
              SELECT 1
                FROM variantes v
                JOIN variante_imagenes vi ON vi.variante_id = v.id
               WHERE v.producto_id = p.id
            )
      ORDER BY p.codigo`
  );
}
