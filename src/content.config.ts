import { defineCollection, reference, z } from 'astro:content';
import { file } from 'astro/loaders';

/**
 * Colecciones del catalogo (SPEC §4.1).
 *
 * El loader `file()` exige un `id` unico por objeto y lo expone como `entry.id`.
 * Se aprovecha: el `id` ES el slug de la URL, asi que no hay campo `slug`
 * duplicado y el `id` no va en el schema.
 */

const categorias = defineCollection({
  loader: file('src/data/categorias.json'),
  schema: z.object({
    nombre: z.string().min(1),
    orden: z.number().int().nonnegative().default(999),
    activa: z.boolean().default(true),
  }),
});

/**
 * Clave direccionada por contenido SIN el sufijo de tamano, mas los anchos que
 * realmente existen.
 *
 * `anchos` es explicito y no se asume: segun §5.5 un origen de menos de 600 px
 * genera solo w300, y sin este dato el srcset apuntaria a un archivo inexistente.
 * El regex valida la forma `catalogo/{sha256[:16]}` en build.
 */
const imagen = z.object({
  base: z.string().regex(/^catalogo\/[0-9a-f]{16}$/, 'clave de imagen mal formada'),
  anchos: z.array(z.union([z.literal(300), z.literal(600)])).min(1),
});

const variante = z.object({
  sku: z.string().min(1),
  color: z.string().min(1),
  colorHex: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i, 'colorHex debe ser #rrggbb')
    .optional(),
  imagenes: z.array(imagen).default([]),
  activo: z.boolean().default(true),
});

const productos = defineCollection({
  loader: file('src/data/productos.json'),
  schema: z.object({
    nombre: z.string().min(1),
    descripcion: z.string().optional(),

    // reference() es deliberado: un slug de categoria mal escrito por el
    // importador ROMPE EL BUILD en vez de renderizar una categoria vacia en
    // produccion. El costo es resolver con getEntries().
    categorias: z.array(reference('categorias')).min(1),

    // Entero: el guarani no tiene decimales. null explicito = "Consultar precio".
    precio: z.number().int().positive().nullable(),

    // min(1): un producto sin variante no tiene imagen ni SKU.
    variantes: z.array(variante).min(1),

    activo: z.boolean().default(true),
    destacado: z.boolean().default(false),
    // z.iso.date() y no z.string().date(): esta ultima esta deprecada en Zod 4.
    actualizado: z.iso.date(),

    // No se renderiza. Es la clave de idempotencia del importador (SPEC §6.7).
    origen: z.object({
      proveedor: z.string().min(1),
      ref: z.string().min(1),
    }),
  }),
});

export const collections = { productos, categorias };
