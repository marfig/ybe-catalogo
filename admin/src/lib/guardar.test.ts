import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

import { loteSqlite } from './d1.ts';
import { guardarFilas, type CambioFila } from './guardar.ts';
import type { Ejecutar, EjecutarLote, Sentencia } from './grilla.ts';

/**
 * Tests del guardado en línea de la grilla (SPEC-etapa2 §10.3).
 *
 * Dos invariantes sostienen todo lo demás:
 *
 *  1. **Sólo se escribe lo que cambió.** `actualizado_en` termina en el campo
 *     `actualizado` de `productos.json`; tocar las 50 filas de la página en cada
 *     guardado cambiaría la fecha de todo el catálogo y produciría un diff enorme en
 *     cada publicación.
 *  2. **Cambiar el nombre NO cambia el slug.** La URL es inmutable desde que existe.
 */

const MIGRACION = readFileSync(
  new URL('../../../db/migrations/0001_esquema_inicial.sql', import.meta.url),
  'utf8'
);
const ANTES = '2026-08-01T10:00:00Z';
const AHORA = '2026-08-05T16:00:00Z';
const CATEGORIAS = new Set(['carteras', 'mochilas', 'fiesta', 'dama', 'escolar']);

function base() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(MIGRACION);
  return db;
}

const ejecutor =
  (db: DatabaseSync): Ejecutar =>
  async (sql, params = []) =>
    db.prepare(sql).all(...(params as never[])) as never;

interface Alta {
  codigo?: string;
  nombre?: string | null;
  descripcion?: string | null;
  precio?: number | null;
  destacado?: boolean;
  estado?: string;
  slug?: string | null;
  categorias?: string[];
}

function alta(db: DatabaseSync, a: Alta = {}): number {
  const estado = a.estado ?? 'importado';
  const fila = db
    .prepare(
      `INSERT INTO productos
         (codigo, proveedor, slug, nombre, descripcion, precio, destacado, estado, creado_en, actualizado_en)
       VALUES (?, 'chenson', ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
    )
    .get(
      a.codigo ?? 'CG1000',
      a.slug !== undefined ? a.slug : null,
      a.nombre !== undefined ? a.nombre : 'Cartera de fiesta',
      a.descripcion !== undefined ? a.descripcion : null,
      a.precio !== undefined ? a.precio : 195000,
      a.destacado ? 1 : 0,
      estado,
      ANTES,
      ANTES
    ) as { id: number };

  (a.categorias ?? ['carteras']).forEach((c, orden) => {
    db.prepare(
      `INSERT INTO producto_categorias (producto_id, categoria_slug, orden) VALUES (?, ?, ?)`
    ).run(fila.id, c, orden);
  });
  return fila.id;
}

const leer = (db: DatabaseSync, id: number) =>
  db
    .prepare(
      `SELECT nombre, descripcion, precio, destacado, slug, estado, actualizado_en
         FROM productos WHERE id = ?`
    )
    .get(id) as {
    nombre: string | null;
    descripcion: string | null;
    precio: number | null;
    destacado: number;
    slug: string | null;
    estado: string;
    actualizado_en: string;
  };

const cats = (db: DatabaseSync, id: number) =>
  db
    .prepare(`SELECT categoria_slug FROM producto_categorias WHERE producto_id = ? ORDER BY orden`)
    .all(id)
    .map((f) => (f as { categoria_slug: string }).categoria_slug);

/**
 * Un `CambioFila` con los campos que el test no nombra en su valor NEUTRO.
 *
 * Neutro significa "igual al default de `alta`": descripcion vacia y sin destacar. Asi
 * un test que solo habla del precio no dispara de rebote una escritura de los otros
 * campos y sigue midiendo lo que dice medir.
 */
const cambio = (c: Partial<CambioFila> & { id: number }): CambioFila => ({
  nombre: 'Cartera de fiesta',
  descripcion: null,
  precio: 195000,
  categoriaPrincipal: 'carteras',
  ...c,
});

const opciones = { categoriasValidas: CATEGORIAS, ahora: AHORA };

/**
 * Las opciones con el ejecutor de lote de esta base.
 *
 * Se arma por test porque el lote lleva la conexion adentro. `loteSqlite` NO es un doble:
 * es la implementacion de `d1.ts` que cumple el mismo contrato que `batch()` de D1, asi
 * que estos tests ejercitan el camino de escritura de produccion.
 */
const con = (db: DatabaseSync) => ({ ...opciones, lote: loteSqlite(db) });

/** Un lote que cuenta cuantas veces se lo llamo, para medir los viajes. */
function loteContado(db: DatabaseSync) {
  const real = loteSqlite(db);
  const llamadas: Sentencia[][] = [];
  const lote: EjecutarLote = async (sentencias) => {
    llamadas.push([...sentencias]);
    return real(sentencias);
  };
  return { lote, llamadas };
}

// --------------------------------------------------------------------------
// INVARIANTE 1: sólo se escribe lo que cambió
// --------------------------------------------------------------------------

test('una fila sin cambios NO se escribe: actualizado_en queda igual', async () => {
  const db = base();
  const id = alta(db, { nombre: 'Cartera de fiesta', precio: 195000, categorias: ['carteras'] });

  const rs = await guardarFilas(ejecutor(db), [cambio({ id })], con(db));

  assert.equal(rs[0].ok, true);
  assert.equal(rs[0].cambio, false, 'no deberia contarse como cambio');
  assert.equal(leer(db, id).actualizado_en, ANTES, 'la fecha no se puede tocar');
});

test('abrir y guardar la pagina entera sin tocar nada no ensucia ninguna fecha', async () => {
  // El escenario que produciria un diff gigante en cada publicacion.
  const db = base();
  const ids = [
    alta(db, { codigo: 'CG1', nombre: 'Uno', precio: 1000, categorias: ['carteras'] }),
    alta(db, { codigo: 'CG2', nombre: 'Dos', precio: null, categorias: ['mochilas'] }),
    alta(db, { codigo: 'CG3', nombre: null, precio: 3000, categorias: ['dama'] }),
    // Con la descripcion ya cargada: es la que mas facil se re-escribe de rebote,
    // porque el formulario la manda en cada guardado.
    alta(db, {
      codigo: 'CG4',
      nombre: 'Cuatro',
      descripcion: 'Cartera rigida con strass.',
      precio: 4000,
      categorias: ['fiesta'],
    }),
  ];

  await guardarFilas(
    ejecutor(db),
    [
      cambio({ id: ids[0], nombre: 'Uno', precio: 1000, categoriaPrincipal: 'carteras' }),
      cambio({ id: ids[1], nombre: 'Dos', precio: null, categoriaPrincipal: 'mochilas' }),
      cambio({ id: ids[2], nombre: null, precio: 3000, categoriaPrincipal: 'dama' }),
      cambio({
        id: ids[3],
        nombre: 'Cuatro',
        descripcion: 'Cartera rigida con strass.',
        precio: 4000,
        categoriaPrincipal: 'fiesta',
      }),
    ],
    con(db)
  );

  for (const id of ids) assert.equal(leer(db, id).actualizado_en, ANTES);
});

test('un cambio real SI actualiza la fecha', async () => {
  const db = base();
  const id = alta(db, { nombre: 'Viejo' });
  await guardarFilas(ejecutor(db), [cambio({ id, nombre: 'Nuevo' })], con(db));
  const fila = leer(db, id);
  assert.equal(fila.nombre, 'Nuevo');
  assert.equal(fila.actualizado_en, AHORA);
});

// --------------------------------------------------------------------------
// INVARIANTE 2: el slug no se mueve
// --------------------------------------------------------------------------

test('cambiar el nombre de un producto publicado NO cambia su slug', async () => {
  // SPEC.md §6.7: "un producto ya visto reusa su id aunque el proveedor le haya
  // cambiado el nombre: la URL sobrevive".
  const db = base();
  const id = alta(db, { estado: 'publicado', slug: 'cartera-de-fiesta', nombre: 'Cartera de fiesta' });

  await guardarFilas(
    ejecutor(db),
    [cambio({ id, nombre: 'Cartera de gala renombrada' })],
    con(db)
  );

  const fila = leer(db, id);
  assert.equal(fila.nombre, 'Cartera de gala renombrada');
  assert.equal(fila.slug, 'cartera-de-fiesta', 'el slug es la URL y no se toca');
});

// --------------------------------------------------------------------------
// Nombre
// --------------------------------------------------------------------------

test('el nombre se recorta', async () => {
  const db = base();
  const id = alta(db, { nombre: 'Algo' });
  await guardarFilas(
    ejecutor(db),
    [cambio({ id, nombre: '   Cartera de fiesta   ' })],
    con(db)
  );
  assert.equal(leer(db, id).nombre, 'Cartera de fiesta');
});

test('vaciar el nombre de un IMPORTADO se permite: es su estado inicial', async () => {
  const db = base();
  const id = alta(db, { estado: 'importado', nombre: 'Algo' });
  const rs = await guardarFilas(ejecutor(db), [cambio({ id, nombre: '' })], con(db));
  assert.equal(rs[0].ok, true);
  assert.equal(leer(db, id).nombre, null);
});

test('vaciar el nombre de un PUBLICADO se RECHAZA', async () => {
  // El volcado lanza ante un producto publicable sin nombre, asi que dejarlo pasar
  // haria que la proxima publicacion falle entera. Se corta donde se comete.
  const db = base();
  const id = alta(db, { estado: 'publicado', slug: 'ya-esta', nombre: 'Cartera de fiesta' });
  const rs = await guardarFilas(ejecutor(db), [cambio({ id, nombre: '   ' })], con(db));
  assert.equal(rs[0].ok, false);
  assert.match(rs[0].motivo!, /nombre/i);
  assert.equal(leer(db, id).nombre, 'Cartera de fiesta', 'no debe haberse tocado');
});

// --------------------------------------------------------------------------
// Descripcion
// --------------------------------------------------------------------------

test('la descripcion se guarda y se recorta', async () => {
  const db = base();
  const id = alta(db, { descripcion: null });
  await guardarFilas(
    ejecutor(db),
    [cambio({ id, descripcion: '  Cartera rigida con aplicacion de strass.  ' })],
    con(db)
  );
  assert.equal(leer(db, id).descripcion, 'Cartera rigida con aplicacion de strass.');
});

test('vaciar la descripcion la borra: en un textarea, vaciar ES la forma de borrar', async () => {
  // A diferencia del select de categoria — donde "sin elegir" no puede leerse como
  // "sacale la categoria" porque no hay forma de pedirlo — un textarea vacio es una
  // accion inequivoca. Misma semantica que la pantalla de edicion (§10.4).
  const db = base();
  const id = alta(db, { descripcion: 'Algo cargado' });
  await guardarFilas(ejecutor(db), [cambio({ id, descripcion: '   ' })], con(db));
  assert.equal(leer(db, id).descripcion, null);
});

test('cambiar SOLO la descripcion mueve la fecha', async () => {
  const db = base();
  const id = alta(db, { descripcion: null });
  const rs = await guardarFilas(
    ejecutor(db),
    [cambio({ id, descripcion: 'Nueva descripcion.' })],
    con(db)
  );
  assert.equal(rs[0].cambio, true);
  assert.equal(leer(db, id).actualizado_en, AHORA);
});

test('una descripcion identica salvo espacios NO cuenta como cambio', async () => {
  // Se compara DESPUES de recortar: sin esto, el textarea devolviendo un salto de
  // linea final marcaria las 50 filas como cambiadas en cada guardado.
  const db = base();
  const id = alta(db, { descripcion: 'Cartera rigida.' });
  const rs = await guardarFilas(
    ejecutor(db),
    [cambio({ id, descripcion: '  Cartera rigida.\n' })],
    con(db)
  );
  assert.equal(rs[0].cambio, false);
  assert.equal(leer(db, id).actualizado_en, ANTES);
});

test('la descripcion se puede vaciar tambien en un PUBLICADO', async () => {
  // No es el nombre: el volcado OMITE la descripcion cuando es null, asi que un
  // publicado sin descripcion es valido y la publicacion no falla.
  const db = base();
  const id = alta(db, {
    estado: 'publicado',
    slug: 'ya-esta',
    nombre: 'Cartera de fiesta',
    descripcion: 'Algo',
  });
  const rs = await guardarFilas(ejecutor(db), [cambio({ id, descripcion: '' })], con(db));
  assert.equal(rs[0].ok, true, rs[0].motivo ?? 'sin motivo');
  assert.equal(leer(db, id).descripcion, null);
});

// --------------------------------------------------------------------------
// Destacado: columna congelada
// --------------------------------------------------------------------------

/**
 * La portada dejo de curar productos y `destacado` salio de esta pantalla, pero la
 * columna NO se bajo de D1: se decidio conservar el dato en vez de tirarlo en una
 * migracion irreversible.
 *
 * ESTE TEST ES LA RED DE ESA DECISION, y guarda un caso concreto que casi se cuela:
 * si en vez de sacar el campo de la ruta de escritura se hubiera ocultado el checkbox
 * en la plantilla, la casilla no viajaria en el POST, la pagina la traduciria a
 * `false` y el primer guardado de la grilla apagaria en silencio TODO lo marcado. Una
 * columna solo queda congelada si nadie le escribe.
 */
test('el guardado no toca `destacado`: la columna quedo congelada', async () => {
  const db = base();
  const id = alta(db, { destacado: true });

  const rs = await guardarFilas(ejecutor(db), [cambio({ id, nombre: 'Otro nombre' })], con(db));

  assert.equal(rs[0].cambio, true, 'el nombre si se guarda');
  assert.equal(leer(db, id).destacado, 1, 'el valor viejo sobrevive intacto');
});

// --------------------------------------------------------------------------
// Categoria principal
// --------------------------------------------------------------------------

test('cambiar la principal reemplaza la primera y conserva las demas', async () => {
  const db = base();
  const id = alta(db, { categorias: ['mochilas', 'escolar', 'dama'] });

  await guardarFilas(ejecutor(db), [cambio({ id, categoriaPrincipal: 'carteras' })], con(db));

  assert.deepEqual(cats(db, id), ['carteras', 'escolar', 'dama']);
});

test('si la nueva principal YA era secundaria, no queda duplicada', async () => {
  // El caso que el UNIQUE de (producto_id, categoria_slug) rechazaria.
  const db = base();
  const id = alta(db, { categorias: ['mochilas', 'escolar'] });

  const rs = await guardarFilas(
    ejecutor(db),
    [cambio({ id, categoriaPrincipal: 'escolar' })],
    con(db)
  );

  assert.equal(rs[0].ok, true, rs[0].motivo ?? 'sin motivo');
  assert.deepEqual(cats(db, id), ['escolar']);
});

test('un producto sin categorias recibe la principal', async () => {
  const db = base();
  const id = alta(db, { categorias: [] });
  await guardarFilas(ejecutor(db), [cambio({ id, categoriaPrincipal: 'mochilas' })], con(db));
  assert.deepEqual(cats(db, id), ['mochilas']);
});

test('dejar la principal vacia no borra las categorias', async () => {
  // Un select sin elegir no puede leerse como "sacale la categoria": borrar
  // curaduria tiene que ser explicito.
  const db = base();
  const id = alta(db, { categorias: ['mochilas', 'escolar'] });
  await guardarFilas(ejecutor(db), [cambio({ id, categoriaPrincipal: null })], con(db));
  assert.deepEqual(cats(db, id), ['mochilas', 'escolar']);
});

test('una categoria inexistente se RECHAZA por fila', async () => {
  const db = base();
  const id = alta(db, { categorias: ['mochilas'] });
  const rs = await guardarFilas(
    ejecutor(db),
    [cambio({ id, categoriaPrincipal: 'inventada' })],
    con(db)
  );
  assert.equal(rs[0].ok, false);
  assert.match(rs[0].motivo!, /inventada/);
  assert.deepEqual(cats(db, id), ['mochilas']);
});

// --------------------------------------------------------------------------
// Precio
// --------------------------------------------------------------------------

test('el precio se guarda y el vacio queda en null', async () => {
  const db = base();
  const id = alta(db, { precio: 195000 });
  await guardarFilas(ejecutor(db), [cambio({ id, precio: null })], con(db));
  assert.equal(leer(db, id).precio, null);
});

// --------------------------------------------------------------------------
// Un lote parcialmente invalido
// --------------------------------------------------------------------------

test('una fila invalida NO impide guardar las demas', async () => {
  // Perder 50 filas de trabajo tipeado por un error en una es cruel. La fila que
  // falla se reporta y se retipea; el resto queda guardado.
  const db = base();
  const bueno = alta(db, { codigo: 'CG1', nombre: 'Antes' });
  const malo = alta(db, { codigo: 'CG2', estado: 'publicado', slug: 's', nombre: 'No me borres' });

  const rs = await guardarFilas(
    ejecutor(db),
    [cambio({ id: bueno, nombre: 'Despues' }), cambio({ id: malo, nombre: '' })],
    con(db)
  );

  assert.equal(rs.find((r) => r.id === bueno)!.ok, true);
  assert.equal(rs.find((r) => r.id === malo)!.ok, false);
  assert.equal(leer(db, bueno).nombre, 'Despues');
  assert.equal(leer(db, malo).nombre, 'No me borres');
});

test('una fila rechazada por el nombre no guarda su descripcion', async () => {
  // El rechazo tiene que dejar la fila ENTERA sin tocar. Guardar la descripcion de una
  // fila que se reporto como fallida es la incoherencia mas dificil de ver: el resumen
  // dice que fallo y la base dice que algo se escribio.
  const db = base();
  const id = alta(db, {
    estado: 'publicado',
    slug: 's',
    nombre: 'No me borres',
    descripcion: 'La de antes',
  });

  const rs = await guardarFilas(
    ejecutor(db),
    [cambio({ id, nombre: '', descripcion: 'La nueva' })],
    con(db)
  );

  assert.equal(rs[0].ok, false);
  const fila = leer(db, id);
  assert.equal(fila.descripcion, 'La de antes');
  assert.equal(fila.actualizado_en, ANTES);
});

test('un id que no existe se reporta', async () => {
  const db = base();
  const rs = await guardarFilas(
    ejecutor(db),
    [cambio({ id: 99999, nombre: 'X', precio: null })],
    con(db)
  );
  assert.equal(rs[0].ok, false);
  assert.match(rs[0].motivo!, /no existe/i);
});

test('una lista vacia no hace nada', async () => {
  const db = base();
  assert.deepEqual(await guardarFilas(ejecutor(db), [], con(db)), []);
});

// --------------------------------------------------------------------------
// Los viajes a la base. Es lo que colgaba la pantalla.
// --------------------------------------------------------------------------

test('CINCUENTA FILAS SE ESCRIBEN EN UN SOLO VIAJE', async () => {
  /**
   * EL TEST QUE EXISTE POR UN INCIDENTE. Antes esto hacia un `await` por escritura dentro
   * del bucle: una fila que cambia columnas y categoria son 3 o 4 viajes, asi que una
   * pagina de 50 eran unas 200 escrituras EN SERIE en un solo request.
   *
   * El 2026-08-19 eso colapso. Con una migracion masiva corriendo y otra persona curando
   * en la grilla, la pantalla se colgaba y el inicio llego a 17 s; horas despues, en calma,
   * el mismo codigo daba 526 ms. El SQL nunca fue el problema —0,3 ms medidos— sino la
   * cantidad de viajes, y D1 es SQLite: un solo escritor a la vez.
   *
   * Se cuenta el NUMERO DE LLAMADAS y no el tiempo: un test de tiempo seria flaky y no
   * diria por que. Que sea 1 es la propiedad que hay que defender.
   */
  const db = base();
  const ids = Array.from({ length: 50 }, (_, i) => alta(db, { codigo: `CG${900 + i}` }));
  const { lote, llamadas } = loteContado(db);

  const rs = await guardarFilas(
    ejecutor(db),
    // `mochilas` y no `carteras`: el fixture ya nace con `carteras`, asi que pedirla no
    // seria un cambio y el DELETE + INSERT de categorias no entraria al lote.
    ids.map((id, i) => cambio({ id, nombre: `Nombre ${i}`, categoriaPrincipal: 'mochilas' })),
    { ...opciones, lote }
  );

  assert.equal(rs.filter((r) => r.ok).length, 50, 'las 50 tienen que haberse guardado');
  assert.equal(llamadas.length, 1, `fueron ${llamadas.length} viajes en vez de 1`);

  // Y en ese viaje van las escrituras de las 50: el UPDATE, y el DELETE + INSERT de la
  // categoria de cada una.
  assert.ok(llamadas[0]!.length >= 150, `sentencias en el lote: ${llamadas[0]!.length}`);
});

test('sin cambios no se hace NINGUN viaje', async () => {
  // Abrir la grilla y apretar Guardar sin tocar nada no tiene que escribir ni pedir nada.
  // Es el invariante 1 llevado hasta el final: cero escrituras, cero viajes.
  const db = base();
  const id = alta(db);
  const { lote, llamadas } = loteContado(db);

  const rs = await guardarFilas(ejecutor(db), [cambio({ id })], { ...opciones, lote });

  assert.equal(rs[0]!.cambio, false);
  assert.equal(llamadas.length, 0);
});

test('si una fila rompe, NINGUNA queda escrita', async () => {
  /**
   * La atomicidad que antes no habia. `guardarFilas` borraba las categorias de un producto
   * y despues las insertaba: un request que muriera en el medio dejaba el producto sin
   * ninguna, y un publicable sin categoria rompe el build del sitio.
   *
   * Se fuerza el fallo con una categoria que pasa la validacion de la aplicacion pero no
   * existe en la base como fila insertable... asi que se rompe el UNIQUE insertando dos
   * veces la misma, que es la unica forma de fallar en SQL desde afuera.
   */
  const db = base();
  const id = alta(db, { nombre: 'Original' });

  const real = loteSqlite(db);
  const lote: EjecutarLote = async (sentencias) =>
    real([...sentencias, { sql: 'INSERT INTO productos (codigo) VALUES (NULL)' }]);

  await assert.rejects(() =>
    guardarFilas(ejecutor(db), [cambio({ id, nombre: 'Cambiado' })], { ...opciones, lote })
  );

  const p = db.prepare('SELECT nombre FROM productos WHERE id = ?').get(id) as { nombre: string };
  assert.equal(p.nombre, 'Original', 'el UPDATE tenia que revertirse');
});
