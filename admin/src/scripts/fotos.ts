/**
 * Las fotos del origen: del Worker al canvas, del canvas a R2, y recien ahi el vinculo.
 *
 * ESTABA DENTRO DE `importar-cliente.ts` Y SE SACO ACA porque la migracion del catalogo
 * viejo necesita exactamente esto. Copiarlo habria duplicado la verificacion de hash, que
 * es la parte sutil: si el hash del Worker y el del canvas no coinciden, la foto se guarda
 * bajo una clave que el Worker nunca vio, el dedupe se rompe y R2 junta duplicados en
 * silencio y para siempre. Una regla asi no puede vivir en dos lugares.
 */
import { postJson } from './pedidos.ts';
import { subirFotoDelOrigen } from './recorte.ts';

/**
 * Cuántas fotos se pidieron y cuántas quedaron vinculadas POR PRIMERA VEZ.
 *
 * EXISTE PARA LA PASADA DE REVISIÓN DE GALERÍAS (`revision-fotos.ts`). Esa pasada visita el
 * catálogo entero porque no hay forma de saber a quién le faltan fotos sin abrir la ficha,
 * así que sin este recuento la pantalla sólo podría decir «revisados 950» — y quien la corre
 * no tendría ni idea de si encontró algo. `vinculadas` es exactamente lo que apareció.
 *
 * Los demás clientes lo ignoran, que es correcto: en una importación normal todas las fotos
 * son nuevas por definición y el dato no agrega nada.
 */
export interface Recuento {
  pedidas: number;
  vinculadas: number;
}

/** Lo unico que `traerFotos` necesita de una ficha, venga de donde venga. */
export interface FichaConFotos {
  codigo?: string;
  /** Un item por color del modelo, con el SKU de su variante. */
  colores?: Array<{ sku: string; fotos: string[] }>;
}

/**
 * El puente por defecto: el del proveedor, que es el que se usa todos los dias.
 *
 * ES UN PARAMETRO Y NO UNA CONSTANTE PORQUE HAY DOS ORIGENES DE FOTOS, y cada uno tiene su
 * propia guarda de origen en el servidor. `/api/scrape/imagen` sólo acepta URLs del
 * proveedor; las fotos del catálogo viejo entran por `/api/migracion/imagen`, que se borra
 * cuando la migración termine. Ampliar la guarda del de todos los días habría dejado para
 * siempre un permiso que hacía falta una vez.
 */
export const PUENTE_DEL_PROVEEDOR = '/api/scrape/imagen';

/**
 * Las fotos de una ficha, una por una (§8.1).
 *
 * El Worker baja la imagen y hashea los BYTES ORIGINALES. Si ya la conoce, responde
 * JSON y la foto no viaja. Si es nueva, responde los bytes crudos: el canvas deriva
 * w300/w600, los sube y recién ahí se vincula a la variante.
 *
 * Una foto que falla no tumba la ficha: el producto ya está en la base, y un producto
 * sin foto se completa a mano desde la grilla.
 */
export async function traerFotos(
  ficha: FichaConFotos,
  cortesia: () => Promise<void>,
  anotarProblema: (que: string, motivo: string) => void,
  puente: string = PUENTE_DEL_PROVEEDOR
): Promise<Recuento> {
  const recuento: Recuento = { pedidas: 0, vinculadas: 0 };

  /**
   * TODOS los colores del modelo, no sólo el de la ficha visitada. Las fichas de los
   * hermanos nunca se piden —las saltea el corte por código de §7.4— así que si sus
   * fotos no se suben en esta pasada, esas variantes se quedan sin imagen para siempre.
   */
  for (const { sku, fotos } of ficha.colores ?? []) {
    for (const url of fotos) {
      recuento.pedidas += 1;
      const vinculada = await unaFoto({
        sku,
        url,
        codigo: ficha.codigo,
        cortesia,
        anotarProblema,
        puente,
      });
      if (vinculada) recuento.vinculadas += 1;
    }
  }

  return recuento;
}

/**
 * Una foto: puente, canvas, subida y vínculo. Nunca lanza.
 *
 * Devuelve `true` sólo si el vínculo es NUEVO. Los dos endpoints que vinculan —el puente
 * cuando ya conoce los bytes, y `/api/scrape/vincular` cuando acaban de subirse— informan
 * `vinculada: false` sobre algo que ya estaba, porque los dos son idempotentes.
 */
async function unaFoto({
  sku,
  url,
  codigo,
  cortesia,
  anotarProblema,
  puente,
}: {
  sku: string;
  url: string;
  codigo: string | undefined;
  cortesia: () => Promise<void>;
  anotarProblema: (que: string, motivo: string) => void;
  puente: string;
}): Promise<boolean> {
  // El SKU va en el aviso: en un modelo de tres colores, «falló una foto de CG85700» no
  // alcanza para saber cuál variante quedó sin imagen.
  const quien = `Foto de ${codigo ?? sku} (${sku})`;

  try {
    await cortesia();
    const respuesta = await fetch(puente, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku, url }),
    });

    const tipo = respuesta.headers.get('Content-Type') ?? '';

    if (!tipo.startsWith('image/')) {
      // JSON: o ya estaba y quedó vinculada, o algo falló. Los bytes no viajaron.
      const cuerpo = (await respuesta.json().catch(() => ({}))) as {
        error?: string;
        vinculada?: boolean;
      };
      if (cuerpo.error) anotarProblema(quien, cuerpo.error);
      return cuerpo.vinculada === true;
    }

    const delWorker = respuesta.headers.get('X-Hash16');
    const bytes = await respuesta.blob();
    const archivo = new File([bytes], `${delWorker ?? 'origen'}.jpg`, { type: bytes.type });

    const subida = await subirFotoDelOrigen(archivo);

    /**
     * EL HASH TIENE QUE COINCIDIR. El Worker lo calculó sobre los mismos bytes y con el
     * mismo algoritmo, así que si difiere es que el cuerpo llegó cortado. Sin este corte
     * la foto se guardaría bajo una clave que el Worker nunca vio: el dedupe se rompe y
     * R2 junta duplicados, en silencio y para siempre.
     */
    if (delWorker && subida.hash16 !== delWorker) {
      anotarProblema(
        quien,
        'La imagen llegó incompleta y no se guardó. Volvé a importar este producto.'
      );
      return false;
    }

    const vinculo = await postJson<{ error?: string; vinculada?: boolean }>(
      '/api/scrape/vincular',
      { sku, hash16: subida.hash16 }
    );
    if (vinculo.error) anotarProblema(quien, vinculo.error);
    return vinculo.vinculada === true;
  } catch (error) {
    anotarProblema(quien, error instanceof Error ? error.message : String(error));
    return false;
  }
}
