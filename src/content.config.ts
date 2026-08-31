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

/**
 * El video opcional de un producto.
 *
 * SU PROPIO PREFIJO, y no es simetria con `imagen`: `indice.json.ts` arma la miniatura
 * del buscador con `base.replace('catalogo/', '')` sin validar nada. Una clave de video
 * bajo `catalogo/` pasaria por ese replace y saldria como una miniatura rota, sin error.
 * El regex de aca es lo que hace imposible que eso llegue al build.
 *
 * SIN `anchos`, al reves que una imagen: no hay derivadas. El navegador no puede
 * transcodificar, asi que el archivo es uno solo y entra tal cual se subio.
 *
 * `ancho` y `alto` NO son informativos: el `<video>` los necesita para reservar su
 * lugar, o la ficha salta cuando el archivo carga.
 */
const video = z.object({
  base: z.string().regex(/^videos\/[0-9a-f]{16}$/, 'clave de video mal formada'),
  ancho: z.number().int().positive(),
  alto: z.number().int().positive(),
});

/**
 * Pedidos especiales: lo que se vende POR CANTIDAD, con precio por caso.
 *
 * COLECCION APARTE Y NO UN FLAG SOBRE `productos`, que era el diseño anterior
 * (`destacado`). El motivo no es de orden sino de forma: un producto exige
 * `variantes` con `sku` y `color` —min(1) mas abajo, y `construir.mjs` corta el
 * volcado si faltan—, y un pedido por cantidad no tiene ninguno de los dos. Meterlo
 * en `productos` obliga a inventar un SKU y un color falsos por cada entrada.
 *
 * Tampoco tiene `precio`: es lo que lo define. El precio se negocia por caso, y por
 * eso la unica salida de estas fichas es la consulta por WhatsApp.
 *
 * SE MANTIENE A MANO, igual que `categorias.json` y a diferencia de
 * `productos.json`, que lo genera el volcado desde D1. Son pocas entradas y las
 * escribe la misma persona que decide la oferta.
 */
const pedidosEspeciales = defineCollection({
  loader: file('src/data/pedidos-especiales.json'),
  schema: z.object({
    nombre: z.string().min(1),

    /**
     * OBLIGATORIA, al reves que en `productos`, y la asimetria es deliberada.
     *
     * Una ficha de producto se sostiene sin descripcion: tiene precio, codigo,
     * colores, marca y migas. Aca no hay nada de eso — la descripcion ES la pagina de
     * detalle. Sin ella, entrar a la ficha es un clic hacia la misma foto que ya
     * estaba en la tarjeta, y el visitante que queria saber la cantidad minima se va
     * sin la respuesta.
     *
     * Que lo corte el build y no la memoria de quien carga: `min(1)` falla en
     * `astro build` nombrando la entrada, antes de publicar una ficha vacia.
     *
     * Texto libre y NO campos estructurados (`cantidadMinima: number` y companía): la
     * primera entrada real va a decir «12 unidades por color» o «a partir de media
     * docena», y ningun numero entero aguanta eso. Se estructura despues de cargar
     * unas cuantas y ver que se repite, no antes.
     */
    descripcion: z.string().min(1),

    // UNA sola, y no un arreglo como en `variantes`: no hay colores que mostrar, asi
    // que la segunda foto no tendria quien la elija.
    imagen,

    // Mismo criterio que `categorias`: el orden lo decide quien edita el archivo.
    orden: z.number().int().nonnegative().default(999),

    /*
      SIN `activo`, al reves que `productos`. Estas fichas siempre estan publicadas:
      son unas pocas, curadas a mano, y la que no va se borra. Un flag para un caso
      que no existe es una condicion mas que arrastra cada consulta y cada pantalla.
    */
  }),
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

    /**
     * UN video opcional POR PRODUCTO, no por variante.
     *
     * Colgarlo del producto hace IMPOSIBLE por construccion romper la invariante de la
     * foto de portada: og:image, el JSON-LD, la miniatura de la grilla y el indice de
     * busqueda leen todos `variantes[0].imagenes[0]`, y el video no entra en ese arbol.
     * Como variante habria sido una regla que vigilar; asi es una rama donde no vive.
     */
    video: video.optional(),

    activo: z.boolean().default(true),
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

export const collections = { productos, categorias, pedidosEspeciales };
