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

    /**
     * `reference()` NO VALIDA QUE LA CATEGORIA EXISTA. Esto decia lo contrario.
     *
     * Lo que hace es normalizar el valor a `{ id, collection }` para que
     * `getEntries()` lo pueda resolver, y validar la FORMA: string, numero, o un
     * objeto cuyo `collection` coincida. Nunca busca el id en la coleccion destino
     * —ver `createReference` en `astro/dist/content/runtime.js`—, asi que un slug
     * con un typo pasa igual que uno correcto.
     *
     * Y NO ROMPE EL BUILD, que es lo que este comentario prometia. Un slug que no
     * existe resuelve a `undefined` y `resolverCategorias` lo descarta con su
     * `Boolean(c)` (`src/lib/productos.ts`): la categoria desaparece del producto en
     * silencio, sin error ni warning. Casi exactamente el «renderizar una categoria
     * vacia en produccion» que la promesa decia estar evitando.
     *
     * NO ES UNA PROMESA INOCENTE: se uso como fundamento para que las categorias no
     * tengan tabla en D1 (`db/migrations/0001_esquema_inicial.sql`, SPEC-etapa2
     * §5.4a) — el argumento era que una tabla se desincronizaria de esta validacion.
     * La decision puede seguir siendo la correcta, pero no por este motivo.
     *
     * LA RED QUE SI EXISTE es `validarParaAprobar` en el admin: bloquea la
     * aprobacion nombrando las categorias inexistentes. Tiene un hueco conocido, y
     * conviene saberlo antes de confiarle el catalogo: valida EN EL MOMENTO DE
     * APROBAR. Un producto aprobado cuando la categoria existia, y que sigue
     * publicado apuntandole despues de que se la saco de `categorias.json`, ya paso
     * por esa puerta y nadie lo vuelve a revisar.
     */
    categorias: z.array(reference('categorias')).min(1),

    // Entero: el guarani no tiene decimales. null explicito = "Consultar precio".
    precio: z.number().int().positive().nullable(),

    // min(1): un producto sin variante no tiene imagen ni SKU.
    variantes: z.array(variante).min(1),

    activo: z.boolean().default(true),
    destacado: z.boolean().default(false),
    // z.iso.date() y no z.string().date(): esta ultima esta deprecada en Zod 4.
    actualizado: z.iso.date(),

    /**
     * El proveedor y el codigo del producto.
     *
     * `ref` SI SE RENDERIZA desde la fase 2.7, corrigiendo el «no se renderiza» que
     * decia este comentario y `SPEC.md` §4.2: es el codigo con el que el cliente
     * pregunta por WhatsApp, asi que va en la ficha junto al nombre y en el mensaje
     * pre-armado (SPEC-etapa2 §5.3).
     *
     * Sigue siendo ademas la clave de identidad del catalogo. No hay un campo
     * `codigo` aparte a proposito: seria el mismo valor escrito dos veces, y dos
     * copias del identificador es una que se puede desincronizar. Un producto cargado
     * a mano sale como `{ proveedor: "manual", ref: <codigo> }`.
     */
    origen: z.object({
      proveedor: z.string().min(1),
      ref: z.string().min(1),
    }),
  }),
});

export const collections = { productos, categorias };
