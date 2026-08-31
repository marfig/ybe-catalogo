/**
 * ABM de pedidos especiales (SPEC.md §4.5).
 *
 * Estas fichas NO son productos: no tienen codigo de proveedor, ni SKU, ni color, ni
 * precio. Por eso no pasan por `alta.ts` ni por la grilla de productos — comparten con
 * ellas una sola cosa, el pipeline de imagenes, que `guardarImagen` ya deja
 * desacoplado (registra en `imagenes` sin saber nada de variantes).
 *
 * Tampoco hay estados: se cargan a mano de a una, completas. Un `borrador` que sólo
 * existe para permitir guardar algo incompleto es una máquina de estados que nadie
 * pidió, y acá `descripcion` es obligatoria justamente porque ES la ficha.
 */
import type { Ejecutar } from './grilla.ts';
import { slugificar, slugUnico } from './slug.ts';

export interface PedidoEspecial {
  id: number;
  /** El segmento de URL. INMUTABLE desde el alta, ver `actualizarPedidoEspecial`. */
  slug: string;
  nombre: string;
  descripcion: string;
  /** hash16 de la imagen, ya subida por `/api/imagenes`. */
  hash16: string;
  orden: number;
  actualizado_en: string;
}

export interface DatosPedidoEspecial {
  nombre: string;
  descripcion: string;
  /** hash16 de la imagen ya subida. */
  hash16: string;
  orden: number;
}

export type Errores = Partial<Record<keyof DatosPedidoEspecial, string>>;

const RE_HASH16 = /^[0-9a-f]{16}$/;

/**
 * Valida los datos del formulario y devuelve un error por campo.
 *
 * TODOS los errores de una vez y no el primero, mismo criterio que `validarPedido` del
 * sitio: un formulario que revela un problema por intento se abandona en el tercero.
 */
export function validar(datos: DatosPedidoEspecial): Errores {
  const errores: Errores = {};

  if (datos.nombre.trim() === '') errores.nombre = 'Completá el nombre.';

  /**
   * La descripcion es OBLIGATORIA acá y opcional en un producto.
   *
   * La asimetria es la razon de ser de la seccion: una ficha de producto se sostiene
   * sin descripcion —tiene precio, codigo, colores, marca—, y esta no tiene nada de
   * eso. Sin descripcion, entrar al detalle es un clic hacia la misma foto que ya
   * estaba en la tarjeta, y quien queria saber la cantidad minima se va sin respuesta.
   */
  if (datos.descripcion.trim() === '') {
    errores.descripcion = 'Obligatoria: es todo el contenido de la ficha. Poné la cantidad mínima y las condiciones.';
  }

  // Sin foto no hay tarjeta: la grilla del sitio no tiene placeholder para esta
  // coleccion, al reves que la de productos (SPEC.md §5.4).
  if (!RE_HASH16.test(datos.hash16)) errores.hash16 = 'Falta la foto.';

  if (!Number.isInteger(datos.orden) || datos.orden < 0) {
    errores.orden = 'Tiene que ser un número de 0 en adelante.';
  }

  return errores;
}

export function hayErrores(errores: Errores): boolean {
  return Object.keys(errores).length > 0;
}

/** Filas para la pantalla del admin, en el mismo orden en que se ven en el sitio. */
export async function listarPedidosEspeciales(ejecutar: Ejecutar): Promise<PedidoEspecial[]> {
  return ejecutar<PedidoEspecial>(
    `SELECT pe.id, pe.slug, pe.nombre, pe.descripcion, pe.orden,
            pe.actualizado_en, i.hash16
       FROM pedidos_especiales pe
       JOIN imagenes i ON i.id = pe.imagen_id
      ORDER BY pe.orden, pe.slug`
  );
}

/**
 * Una ficha por su slug. `null` si no existe.
 *
 * POR SLUG Y NO POR ID: es lo que va en la URL de la pantalla de edición, y es el
 * mismo identificador que ve el cliente en el sitio. Con el `id` autoincremental, la
 * dirección del admin no diría nada de qué se está editando, y un enlace guardado
 * apuntaría a otra ficha si la base se recrea.
 *
 * Devuelve `null` en vez de lanzar: un slug inexistente es una URL vieja o mal tipeada
 * —un caso normal— y la pantalla lo resuelve con un 404 propio, no con un error.
 */
export async function buscarPorSlug(
  ejecutar: Ejecutar,
  slug: string
): Promise<PedidoEspecial | null> {
  const [fila] = await ejecutar<PedidoEspecial>(
    `SELECT pe.id, pe.slug, pe.nombre, pe.descripcion, pe.orden,
            pe.actualizado_en, i.hash16
       FROM pedidos_especiales pe
       JOIN imagenes i ON i.id = pe.imagen_id
      WHERE pe.slug = ?`,
    [slug]
  );
  return fila ?? null;
}

/**
 * Resuelve el hash16 a la fila de `imagenes`.
 *
 * LANZA si no existe, y es deliberado: la imagen se sube ANTES por `/api/imagenes`,
 * que la registra. Un hash sin fila significa que el formulario mandó algo que nunca
 * se subió — guardar la ficha igual la dejaría apuntando a una foto inexistente, y el
 * error recién saldría en el volcado, lejos de donde se cometió.
 */
async function imagenIdDe(ejecutar: Ejecutar, hash16: string): Promise<number> {
  const [fila] = await ejecutar<{ id: number }>(`SELECT id FROM imagenes WHERE hash16 = ?`, [
    hash16,
  ]);

  if (!fila) {
    throw new Error(`La imagen ${hash16} no está registrada. Subila antes de guardar la ficha.`);
  }
  return fila.id;
}

/** Los slugs ya tomados. Se lee entero: son una decena de filas. */
async function slugsTomados(ejecutar: Ejecutar): Promise<Set<string>> {
  const filas = await ejecutar<{ slug: string }>(`SELECT slug FROM pedidos_especiales`);
  return new Set(filas.map((f) => f.slug));
}

export async function crearPedidoEspecial(
  ejecutar: Ejecutar,
  datos: DatosPedidoEspecial,
  { ahora }: { ahora: string }
): Promise<{ id: number; slug: string }> {
  const errores = validar(datos);
  if (hayErrores(errores)) {
    throw new Error(`Datos inválidos: ${Object.values(errores).join(' ')}`);
  }

  const imagenId = await imagenIdDe(ejecutar, datos.hash16);

  /**
   * El slug se deriva del nombre UNA sola vez, acá, y desde este momento es inmutable
   * (SPEC.md §6.7). Es el mismo contrato que el de un producto y por la misma razon:
   * la URL termina pegada en un chat que nadie va a corregir.
   */
  const slug = slugUnico(slugificar(datos.nombre), await slugsTomados(ejecutar));

  const [fila] = await ejecutar<{ id: number }>(
    `INSERT INTO pedidos_especiales
       (slug, nombre, descripcion, imagen_id, orden, creado_en, actualizado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
    [slug, datos.nombre.trim(), datos.descripcion.trim(), imagenId, datos.orden, ahora, ahora]
  );

  return { id: fila!.id, slug };
}

/**
 * Actualiza una ficha. El `slug` NO está en el UPDATE, y es deliberado.
 *
 * Cambiarle el nombre a una ficha publicada cambia el nombre, nunca la URL. Es la
 * misma regla que protege a los productos en `edicion.ts`, y acá pesa igual: estas
 * fichas se comparten por WhatsApp, que es literalmente el único canal de venta.
 */
export async function actualizarPedidoEspecial(
  ejecutar: Ejecutar,
  id: number,
  datos: DatosPedidoEspecial,
  { ahora }: { ahora: string }
): Promise<void> {
  const errores = validar(datos);
  if (hayErrores(errores)) {
    throw new Error(`Datos inválidos: ${Object.values(errores).join(' ')}`);
  }

  const imagenId = await imagenIdDe(ejecutar, datos.hash16);

  await ejecutar(
    `UPDATE pedidos_especiales
        SET nombre = ?, descripcion = ?, imagen_id = ?, orden = ?, actualizado_en = ?
      WHERE id = ?`,
    [datos.nombre.trim(), datos.descripcion.trim(), imagenId, datos.orden, ahora, id]
  );
}

/**
 * Borra la ficha. La imagen NO se toca.
 *
 * Queda huérfana en `imagenes` y en R2, y eso es correcto: puede estar compartida con
 * un producto —el dedupe de `guardarImagen` es por contenido— y borrarla acá dejaría
 * un `<img>` roto en el catálogo. La recolección de huérfanas (§12.3) es la que decide
 * si un objeto ya no lo referencia nadie.
 */
export async function eliminarPedidoEspecial(ejecutar: Ejecutar, id: number): Promise<void> {
  await ejecutar(`DELETE FROM pedidos_especiales WHERE id = ?`, [id]);
}
