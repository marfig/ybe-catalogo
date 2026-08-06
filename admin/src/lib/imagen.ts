/**
 * Reglas de imagen del pipeline de canvas (SPEC-etapa2 §8; SPEC.md §5.2, §5.5, §6.10).
 *
 * PIEZA PURA. Decide cuántas derivadas se generan y qué pedazo del original entra en
 * el cuadrado; lo que corre en el navegador es un `drawImage` con estos números. Así
 * la parte que puede arruinar una foto se prueba sin canvas.
 *
 * LA REGLA QUE SOSTIENE TODO: **nunca se amplía.** Ampliar inventa píxeles, y una
 * foto borrosa en el catálogo es peor que una foto chica — de ahí el placeholder de
 * `SPEC.md` §5.4 en vez de un estirón.
 *
 * `sharp` no corre en Workers (§3.1), así que el procesamiento se mudó al único lugar
 * del sistema con un motor de imágenes completo y gratis: el navegador.
 */
import { slugificar } from './slug.ts';

/** Anchos del contrato. Los mismos que declara `content.config.ts` (SPEC.md §5.2). */
export const ANCHOS = [300, 600] as const;

export interface Recorte {
  x: number;
  y: number;
  /** Cuadrado: el recorte asistido de §8.3 siempre produce 1:1. */
  lado: number;
}

export interface Encuadre {
  /** Rectángulo de ORIGEN, en píxeles del archivo. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Rectángulo de DESTINO, en píxeles del canvas cuadrado. */
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * Qué derivadas se pueden generar a partir de un lado mayor dado.
 *
 * OJO: cuando hay recorte, el lado que manda es el del RECORTE, no el del original.
 * Una foto de 4000×3000 recortada a 250×250 no puede dar `w300`: serían 50 píxeles
 * inventados. Mirar el original diría que sí.
 */
export function anchosParaLado(ladoMayor: number): number[] {
  return ANCHOS.filter((a) => a <= ladoMayor);
}

/** El cuadrado más grande que entra en la imagen, centrado. La propuesta de §8.3. */
export function recorteCentrado(ancho: number, alto: number): Recorte {
  const lado = Math.min(ancho, alto);
  return {
    x: Math.floor((ancho - lado) / 2),
    y: Math.floor((alto - lado) / 2),
    lado,
  };
}

function validarRecorte(recorte: Recorte, ancho: number, alto: number): void {
  const { x, y, lado } = recorte;
  const entero = (n: number) => Number.isFinite(n) && Number.isInteger(n);

  if (!entero(x) || !entero(y) || !entero(lado) || lado <= 0) {
    throw new Error(`Recorte inválido: ${JSON.stringify(recorte)}. Se esperan enteros y lado > 0.`);
  }
  if (x < 0 || y < 0 || x + lado > ancho || y + lado > alto) {
    /**
     * Un recorte fuera de los límites produce un canvas con bordes transparentes o
     * negros según el navegador — o sea, una foto rota que se sube igual. Cortar acá
     * es mucho mejor que descubrirlo en el catálogo.
     */
    throw new Error(
      `Recorte inválido: ${JSON.stringify(recorte)} se sale de la imagen de ${ancho}×${alto}.`
    );
  }
}

/**
 * Los rectángulos de origen y destino para dibujar en un canvas cuadrado de `lado`.
 *
 * El destino se centra y lo que sobra se rellena con blanco, que coincide con el
 * fondo real de las fotos del proveedor y con `--color-superficie` (SPEC.md §6.10):
 * el relleno es invisible.
 */
export function calcularEncuadre({
  anchoOrigen,
  altoOrigen,
  lado,
  recorte,
}: {
  anchoOrigen: number;
  altoOrigen: number;
  lado: number;
  recorte?: Recorte;
}): Encuadre {
  if (recorte) validarRecorte(recorte, anchoOrigen, altoOrigen);

  const sx = recorte ? recorte.x : 0;
  const sy = recorte ? recorte.y : 0;
  const sw = recorte ? recorte.lado : anchoOrigen;
  const sh = recorte ? recorte.lado : altoOrigen;

  // `min(1, …)` ES la regla de "nunca amplía": por encima de 1 estaría estirando.
  const escala = Math.min(1, lado / Math.max(sw, sh));

  // `floor` y no `round`: redondear para arriba puede dar 601 en un cuadro de 600 y
  // recortar un píxel del borde.
  const dw = Math.floor(sw * escala);
  const dh = Math.floor(sh * escala);

  return {
    sx,
    sy,
    sw,
    sh,
    dw,
    dh,
    dx: Math.floor((lado - dw) / 2),
    dy: Math.floor((lado - dh) / 2),
  };
}

/**
 * SKU de una variante: `{codigo}-{slug(color)}` (§9, SPEC.md §6.6).
 *
 * Nunca un índice posicional: agregar un color no puede mover los SKU existentes.
 *
 * LANZA si del color no queda nada slugificable. `CG1-` sería un SKU válido para
 * cualquier color roto, así que dos variantes chocarían contra el UNIQUE y el error
 * aparecería lejos de la causa.
 */
export function skuDe(codigo: string, color: string): string {
  let sufijo: string;
  try {
    sufijo = slugificar(color);
  } catch {
    throw new Error(
      `No se puede armar el SKU: el color ${JSON.stringify(color)} no tiene letras ni números.`
    );
  }
  return `${codigo}-${sufijo}`;
}
