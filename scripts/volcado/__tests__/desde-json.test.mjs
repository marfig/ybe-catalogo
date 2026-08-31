import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

import { construirProductos } from '../construir.mjs';
import { consultarFilas } from '../consultar.mjs';
import {
  TABLAS_SEMBRADAS,
  aFilas,
  comoGuionSql,
  comoLiteral,
  sentencias,
} from '../desde-json.mjs';

/**
 * Tests de la migracion `productos.json` -> D1: la INVERSA del volcado.
 *
 * El test que importa es el de ida y vuelta COMPLETO:
 *
 *   productos.json -> aFilas -> INSERT en el esquema real -> consultarFilas
 *                  -> construirProductos -> productos.json
 *
 * Pasa por `node:sqlite` con la migracion de verdad, asi que ejercita tambien los
 * NOT NULL, los CHECK y las foreign keys. Si una de las dos direcciones pierde un
 * campo, el ida y vuelta lo delata; ningun test de una sola direccion lo haria.
 *
 * NO se compara byte a byte contra el archivo comiteado: ese archivo fue escrito a
 * mano y el volcado emite los productos ordenados por `id`. Lo que se afirma es la
 * preservacion del CONTENIDO, normalizando solo ese orden del lado esperado.
 */

/**
 * La carpeta entera, en orden, que es lo que corre wrangler.
 *
 * ANTES ERA UNA LISTA A MANO Y YA HABIA FALLADO DOS VECES POR ESO. La primera cuando
 * `consultarFilas` empezo a consultar `pedidos_especiales`: la ida y vuelta reventaba
 * con «no such table» en un test que no habla de pedidos especiales. Se agrego la
 * `0006` a la lista y el problema volvio identico con `videos`.
 *
 * El sembrado sigue sin usar la mayoria de estas migraciones. Da igual: lo que decide
 * que tablas hacen falta no es lo que este test siembra, sino lo que consulta el codigo
 * que prueba — y eso cambia sin avisarle a la lista.
 */
const MIGRACIONES = readdirSync('db/migrations')
  .filter((n) => n.endsWith('.sql'))
  .sort()
  .map((n) => readFileSync(`db/migrations/${n}`, 'utf8'));

/**
 * EL FIXTURE ESTA CONGELADO, Y NO ES `src/data/productos.json`.
 *
 * Antes se leia ese archivo. Rompio en CI el 2026-08-10 y el motivo vale la pena:
 * `src/data/productos.json` es un archivo GENERADO, y el workflow de publicacion lo
 * REGENERA desde D1 en el paso anterior a correr los tests (§11.2). O sea que el
 * fixture cambiaba debajo del test, en CI, con datos que nadie eligio — pasaba en
 * local y fallaba en la nube.
 *
 * Lo que lo delato: dos productos cargados desde el admin en produccion trajeron
 * imagenes con hashes que no estan en `METADATOS`, y sin sus medidas el INSERT viola
 * los NOT NULL del esquema. Pero el mismo problema aparece con cualquier producto
 * nuevo: los asserts de casos borde nombran ids concretos (`cg85900`,
 * `rinonera-juvenil`) que un catalogo vivo puede no tener.
 *
 * Un test cuyo fixture es un artefacto de build no prueba lo que dice probar. Lo que
 * ESTE test prueba es que el ida y vuelta preserva el contenido sobre un conjunto con
 * casos borde conocidos —`activo:false`, precio nulo, varias variantes, una imagen
 * compartida— y eso no depende del catalogo de hoy.
 *
 * Los datos vivos igual estan cubiertos, por otras dos redes: Zod y
 * `reference('categorias')` rompen el build ante un JSON invalido (§11.2 paso 4), y la
 * idempotencia del volcado se verifica con `git diff --exit-code`.
 */
const JSON_COMITEADO = JSON.parse(
  readFileSync('scripts/volcado/__tests__/fixtures/productos-canonico.json', 'utf8')
);

/** Metadatos de origen medidos sobre samples/ (SPEC-etapa2 §5.1). */
const METADATOS = new Map([
  ['406b4fe1006d642b', { ancho: 600, alto: 600, bytes: 188336 }],
  ['4629d09be1221bad', { ancho: 600, alto: 600, bytes: 116321 }],
  ['605ea0e9d91bfbd6', { ancho: 600, alto: 600, bytes: 166443 }],
  ['67c9ff3b0ed208ef', { ancho: 600, alto: 600, bytes: 95777 }],
  ['862cab4eb0a88563', { ancho: 600, alto: 600, bytes: 171973 }],
  ['acaa55fa1e8d3b9c', { ancho: 601, alto: 600, bytes: 109886 }],
  ['e98d0c8ea68a9c21', { ancho: 600, alto: 600, bytes: 144798 }],
]);

const AHORA = '2026-08-05';

function base() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const m of MIGRACIONES) db.exec(m);
  return db;
}

/** Corre las sentencias de la siembra contra node:sqlite. */
function sembrar(db, filas) {
  for (const { sql, params } of sentencias(filas)) {
    db.prepare(sql).run(...params);
  }
}

const ejecutorSqlite = (db) => (sql, params = []) => db.prepare(sql).all(...params);

/**
 * Canonicaliza el lado esperado: solo el orden de los PRODUCTOS, por `id`.
 *
 * Las variantes NO se reordenan, y eso es el punto: desde que el volcado ordena por
 * la columna `orden` (que `aFilas` siembra con la posicion en el JSON), el viaje
 * devuelve las variantes en el orden original. El ida y vuelta pasa a ser identidad
 * salvo el orden de productos.
 */
function canonico(productos) {
  return [...productos].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** El pipeline completo de ida y vuelta. */
async function idaYVuelta(productos) {
  const db = base();
  sembrar(db, aFilas(productos, METADATOS, { ahora: AHORA }));
  return construirProductos(await consultarFilas(ejecutorSqlite(db)));
}

// --------------------------------------------------------------------------
// EL test: ida y vuelta sobre los datos reales
// --------------------------------------------------------------------------

test('ida y vuelta: el productos.json real sobrevive el viaje a D1 sin perder nada', async () => {
  const vuelta = await idaYVuelta(JSON_COMITEADO);
  assert.deepEqual(vuelta, canonico(JSON_COMITEADO));
});

test('ida y vuelta: no se pierde ni se agrega ningun producto', async () => {
  const vuelta = await idaYVuelta(JSON_COMITEADO);
  assert.equal(vuelta.length, JSON_COMITEADO.length);
  assert.deepEqual(
    vuelta.map((p) => p.id).sort(),
    JSON_COMITEADO.map((p) => p.id).sort()
  );
});

// --------------------------------------------------------------------------
// Los casos borde que los 6 productos reales cubren. Se afirman uno por uno
// porque un deepEqual que pasa no dice CUAL invariante sostuvo.
// --------------------------------------------------------------------------

test('activo:false se guarda como estado eliminado y vuelve como activo:false', async () => {
  const vuelta = await idaYVuelta(JSON_COMITEADO);
  const eliminado = vuelta.find((p) => p.id === 'cg85900');
  assert.equal(eliminado.activo, false);

  // Y en la base quedo con el estado correcto, no con un booleano aparte.
  const filas = aFilas(JSON_COMITEADO, METADATOS, { ahora: AHORA });
  assert.equal(filas.productos.find((p) => p.slug === 'cg85900').estado, 'eliminado');
  assert.equal(filas.productos.find((p) => p.slug === 'billetera-de-dama').estado, 'publicado');
});

test('precio null sobrevive como null, no como 0 ni ausente', async () => {
  const vuelta = await idaYVuelta(JSON_COMITEADO);
  const sinPrecio = vuelta.find((p) => p.id === 'rinonera-juvenil');
  assert.equal(sinPrecio.precio, null);
  assert.ok('precio' in sinPrecio, 'la clave precio va siempre (nullable, no optional)');
});

test('una variante sin imagenes sobrevive como arreglo vacio', async () => {
  // Es un estado con significado: dispara el placeholder de SPEC §5.4. Perderlo
  // lo volveria indistinguible de un error de volcado.
  const vuelta = await idaYVuelta(JSON_COMITEADO);
  const billetera = vuelta.find((p) => p.id === 'billetera-de-dama');
  assert.deepEqual(billetera.variantes[0].imagenes, []);
});

test('una variante sin colorHex no lo inventa', async () => {
  const vuelta = await idaYVuelta(JSON_COMITEADO);
  const billetera = vuelta.find((p) => p.id === 'billetera-de-dama');
  assert.ok(!('colorHex' in billetera.variantes[0]));
});

test('el orden de las categorias se preserva: NO es alfabetico', async () => {
  // ["mochilas","notebook","escolar"] no esta ordenado alfabeticamente y no debe
  // estarlo: categorias[0] es el breadcrumb (SPEC-etapa2 §5.1). Si aFilas no
  // guardara el `orden`, el volcado lo reordenaria y cambiaria el breadcrumb.
  const vuelta = await idaYVuelta(JSON_COMITEADO);
  const mochila = vuelta.find((p) => p.id === 'mochila-urbana-lisa-18');
  assert.deepEqual(mochila.categorias, ['mochilas', 'notebook', 'escolar']);
});

test('el orden de las imagenes dentro de una variante se preserva', async () => {
  const vuelta = await idaYVuelta(JSON_COMITEADO);
  const mochila = vuelta.find((p) => p.id === 'mochila-urbana-lisa-18');
  assert.deepEqual(
    mochila.variantes[0].imagenes.map((i) => i.base),
    ['catalogo/acaa55fa1e8d3b9c', 'catalogo/67c9ff3b0ed208ef']
  );
});

test('destacado no viaja en ninguna direccion: quedo fuera del contrato', async () => {
  // La columna sigue existiendo en D1 —congelada a proposito, sin migracion que la
  // baje— pero ni el sembrado la escribe ni el volcado la lee. Este test es la red:
  // si alguna de las dos puntas la volviera a tocar, el JSON de vuelta la traeria.
  const vuelta = await idaYVuelta(JSON_COMITEADO);
  assert.ok(vuelta.every((p) => !('destacado' in p)));
});

test('descripcion ausente no se convierte en cadena vacia', async () => {
  const vuelta = await idaYVuelta(JSON_COMITEADO);
  assert.ok(!('descripcion' in vuelta.find((p) => p.id === 'billetera-de-dama')));
  assert.match(
    vuelta.find((p) => p.id === 'rinonera-juvenil').descripcion,
    /Riñonera de poliéster/
  );
});

// --------------------------------------------------------------------------
// Una imagen compartida se guarda UNA vez y se referencia dos
// --------------------------------------------------------------------------

test('una imagen usada por dos variantes se inserta una sola vez', async () => {
  // Es el dedupe por contenido de SPEC §6.8. Insertarla dos veces violaria el
  // UNIQUE de hash16 y abortaria la migracion.
  const compartido = [
    {
      ...JSON_COMITEADO[0],
      id: 'uno',
      origen: { proveedor: 'chenson', ref: 'C1' },
      variantes: [
        { sku: 'C1-A', color: 'Azul', imagenes: [{ base: 'catalogo/406b4fe1006d642b', anchos: [300, 600] }] },
      ],
    },
    {
      ...JSON_COMITEADO[0],
      id: 'dos',
      origen: { proveedor: 'chenson', ref: 'C2' },
      variantes: [
        { sku: 'C2-A', color: 'Azul', imagenes: [{ base: 'catalogo/406b4fe1006d642b', anchos: [300, 600] }] },
      ],
    },
  ];

  const filas = aFilas(compartido, METADATOS, { ahora: AHORA });
  assert.equal(filas.imagenes.length, 1, 'la imagen se guarda una sola vez');
  assert.equal(filas.varianteImagenes.length, 2, 'y se referencia desde las dos variantes');

  // Y el viaje completo la devuelve en las dos.
  const vuelta = await idaYVuelta(compartido);
  assert.equal(vuelta.find((p) => p.id === 'uno').variantes[0].imagenes.length, 1);
  assert.equal(vuelta.find((p) => p.id === 'dos').variantes[0].imagenes.length, 1);
});

// --------------------------------------------------------------------------
// Determinismo e insumos incompletos
// --------------------------------------------------------------------------

test('aFilas es determinista: dos llamadas dan los mismos ids', () => {
  const a = aFilas(JSON_COMITEADO, METADATOS, { ahora: AHORA });
  const b = aFilas(JSON_COMITEADO, METADATOS, { ahora: AHORA });
  assert.deepEqual(a, b);
});

test('aFilas revienta si falta el metadato de una imagen', () => {
  // ancho_origen, alto_origen y bytes_origen son NOT NULL en el esquema. Sin el
  // metadato, insertar cero seria inventar un dato que despues nadie sabe que es
  // falso: mejor cortar y decir cual falta.
  assert.throws(
    () => aFilas(JSON_COMITEADO, new Map(), { ahora: AHORA }),
    /acaa55fa1e8d3b9c|sin metadatos/
  );
});

test('las sentencias insertan en orden de dependencia', () => {
  // Con foreign keys activas, una variante antes de su producto revienta. El orden
  // no es cosmetico.
  const filas = aFilas(JSON_COMITEADO, METADATOS, { ahora: AHORA });
  const tablas = sentencias(filas).map((s) => s.sql.match(/INSERT INTO (\w+)/)[1]);

  const primera = (t) => tablas.indexOf(t);
  assert.ok(primera('productos') < primera('variantes'));
  assert.ok(primera('productos') < primera('producto_categorias'));
  assert.ok(primera('variantes') < primera('variante_imagenes'));
  assert.ok(primera('imagenes') < primera('variante_imagenes'));
});

// --------------------------------------------------------------------------
// El guion de SQL plano: `wrangler d1 execute --file` no acepta parametros
// --------------------------------------------------------------------------

test('comoLiteral: escapa el apostrofo duplicandolo', () => {
  // Sin esto, una descripcion con apostrofo rompe la sintaxis del guion entero.
  assert.equal(comoLiteral("Cartera d'Or"), "'Cartera d''Or'");
  assert.equal(comoLiteral("''"), "''''''");
});

test('comoLiteral: null, numeros y booleanos', () => {
  assert.equal(comoLiteral(null), 'NULL');
  assert.equal(comoLiteral(undefined), 'NULL');
  assert.equal(comoLiteral(0), '0');
  assert.equal(comoLiteral(285000), '285000');
  assert.equal(comoLiteral(true), '1');
  assert.equal(comoLiteral(false), '0');
});

test('comoLiteral: revienta ante lo que no sabe serializar', () => {
  assert.throws(() => comoLiteral(NaN), /no finito/);
  assert.throws(() => comoLiteral({ a: 1 }), /tipo no soportado/);
});

test('comoGuionSql: reemplaza cada placeholder por su literal, en orden', () => {
  const guion = comoGuionSql([
    { sql: 'INSERT INTO t (a, b, c) VALUES (?, ?, ?)', params: ['x', null, 3] },
  ]);
  assert.equal(guion, "INSERT INTO t (a, b, c) VALUES ('x', NULL, 3);");
});

test('comoGuionSql: el guion de los datos reales es SQL valido y reproduce la base', () => {
  // El test que cierra el circulo del guion: se aplica el TEXTO que va a recibir
  // wrangler, no las sentencias parametrizadas, y tiene que dar la misma base.
  const filas = aFilas(JSON_COMITEADO, METADATOS, { ahora: AHORA });
  const db = base();
  db.exec(comoGuionSql(sentencias(filas)));

  const cuenta = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
  assert.equal(cuenta('productos'), 6);
  assert.equal(cuenta('variantes'), 7);
  assert.equal(cuenta('imagenes'), 7);

  // Y el acento y las comillas dobles del nombre sobrevivieron.
  const nombres = db.prepare('SELECT nombre FROM productos ORDER BY id').all().map((r) => r.nombre);
  assert.ok(nombres.includes('Mochila urbana lisa 18"'));
  assert.ok(nombres.includes('Riñonera juvenil'));
});

test('TABLAS_SEMBRADAS esta en orden inverso de dependencia', () => {
  // Se usa para limpiar y reintentar. Borrar productos primero reventaria por FK.
  const orden = sentencias(aFilas(JSON_COMITEADO, METADATOS, { ahora: AHORA })).map(
    (s) => s.sql.match(/INSERT INTO (\w+)/)[1]
  );
  const insercion = [...new Set(orden)];
  assert.deepEqual(TABLAS_SEMBRADAS, [...insercion].reverse());
});

test('sembrar sobre una base con foreign keys activas no viola ninguna', () => {
  const db = base();
  assert.doesNotThrow(() => sembrar(db, aFilas(JSON_COMITEADO, METADATOS, { ahora: AHORA })));

  const cuenta = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
  assert.equal(cuenta('productos'), 6);
  assert.equal(cuenta('imagenes'), 7);
  assert.equal(cuenta('variantes'), 7);
});
