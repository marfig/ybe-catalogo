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

/** Lo unico que `traerFotos` necesita de una ficha, venga de donde venga. */
export interface FichaConFotos {
  codigo?: string;
  /** Un item por color del modelo, con el SKU de su variante. */
  colores?: Array<{ sku: string; fotos: string[] }>;
}

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
  anotarProblema: (que: string, motivo: string) => void
): Promise<void> {
  /**
   * TODOS los colores del modelo, no sólo el de la ficha visitada. Las fichas de los
   * hermanos nunca se piden —las saltea el corte por código de §7.4— así que si sus
   * fotos no se suben en esta pasada, esas variantes se quedan sin imagen para siempre.
   */
  for (const { sku, fotos } of ficha.colores ?? []) {
    for (const url of fotos) {
      await unaFoto({ sku, url, codigo: ficha.codigo, cortesia, anotarProblema });
    }
  }
}

/** Una foto: puente, canvas, subida y vínculo. Nunca lanza. */
async function unaFoto({
  sku,
  url,
  codigo,
  cortesia,
  anotarProblema,
}: {
  sku: string;
  url: string;
  codigo: string | undefined;
  cortesia: () => Promise<void>;
  anotarProblema: (que: string, motivo: string) => void;
}): Promise<void> {
  // El SKU va en el aviso: en un modelo de tres colores, «falló una foto de CG85700» no
  // alcanza para saber cuál variante quedó sin imagen.
  const quien = `Foto de ${codigo ?? sku} (${sku})`;

  try {
    await cortesia();
    const respuesta = await fetch('/api/scrape/imagen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku, url }),
    });

    const tipo = respuesta.headers.get('Content-Type') ?? '';

    if (!tipo.startsWith('image/')) {
      // JSON: o ya estaba y quedó vinculada, o algo falló. Los bytes no viajaron.
      const cuerpo = (await respuesta.json().catch(() => ({}))) as { error?: string };
      if (cuerpo.error) anotarProblema(quien, cuerpo.error);
      return;
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
      return;
    }

    const vinculo = await postJson<{ error?: string }>('/api/scrape/vincular', {
      sku,
      hash16: subida.hash16,
    });
    if (vinculo.error) anotarProblema(quien, vinculo.error);
  } catch (error) {
    anotarProblema(quien, error instanceof Error ? error.message : String(error));
  }
}
