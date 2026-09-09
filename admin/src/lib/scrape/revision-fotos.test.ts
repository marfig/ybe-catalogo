import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { Ejecutar } from '../grilla.ts';
import {
  codigosPedidos,
  contarParaRevisar,
  paraRevisarFotos,
  partirCodigos,
} from './revision-fotos.ts';

/**
 * Contra el ESQUEMA REAL con `node:sqlite`, igual que `sin-fotos.test.ts` y
 * `pendientes.test.ts`, y por el mismo motivo: esta consulta decide a qué fichas se les
 * vuelve a pedir la galería. Uno de más son pedidos al proveedor sobre algo que ya estaba
 * completo; uno de menos es un producto que se queda con una foto para siempre, porque
 * nada lo va a volver a mirar.
 */
const MIGRACIONES = [
  '0001_esquema_inicial.sql',
  '0002_codigo_insensible_a_mayusculas.sql',
  '0003_aviso_cambio_en_origen.sql',
  '0004_papelera.sql',
  '0005_barrido_de_bajas.sql',
].map((n) => readFileSync(new URL(`../../../../db/migrations/${n}`, import.meta.url), 'utf8'));

const AHORA = '2026-09-09T18:00:00Z';

function base() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const m of MIGRACIONES) db.exec(m);
  return db;
}

const ejecutor =
  (db: DatabaseSync): Ejecutar =>
  async (sql, params = []) =>
    db.prepare(sql).all(...(params as never[])) as never;

interface Alta {
  codigo: string;
  proveedor?: string;
  estado?: string;
  urlOrigen?: string | null;
  /** Cuántas fotos cuelgan de su única variante. 0 = variante vacía. */
  fotos?: number;
}

let siguienteHash = 0;

function alta(db: DatabaseSync, a: Alta) {
  const estado = a.estado ?? 'publicado';
  db.prepare(
    `INSERT INTO productos (codigo, proveedor, estado, slug, url_origen, creado_en, actualizado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    a.codigo,
    a.proveedor ?? 'chenson',
    estado,
    estado === 'importado' ? null : `slug-${a.codigo}`,
    a.urlOrigen !== undefined ? a.urlOrigen : `https://www.chenson.com.py/producto/1-${a.codigo}`,
    AHORA,
    AHORA
  );
  const productoId = Number(
    (db.prepare('SELECT id FROM productos WHERE codigo = ?').get(a.codigo) as { id: number }).id
  );

  db.prepare(`INSERT INTO variantes (producto_id, sku, color, orden) VALUES (?, ?, ?, 0)`).run(
    productoId,
    `${a.codigo}-3`,
    'Negro'
  );
  const varianteId = Number(
    (db.prepare('SELECT id FROM variantes WHERE sku = ?').get(`${a.codigo}-3`) as { id: number }).id
  );

  for (let i = 0; i < (a.fotos ?? 0); i += 1) {
    siguienteHash += 1;
    const hash = String(siguienteHash).padStart(16, '0');
    db.prepare(
      `INSERT INTO imagenes (hash16, anchos, ancho_origen, alto_origen, bytes_origen, creado_en)
       VALUES (?, '[300,600]', 600, 600, 1000, ?)`
    ).run(hash, AHORA);
    const imagenId = Number(
      (db.prepare('SELECT id FROM imagenes WHERE hash16 = ?').get(hash) as { id: number }).id
    );
    db.prepare(
      `INSERT INTO variante_imagenes (variante_id, imagen_id, orden) VALUES (?, ?, ?)`
    ).run(varianteId, imagenId, i);
  }
}

const codigosDe = async (db: DatabaseSync, desde?: string, tope?: number) =>
  (await paraRevisarFotos(ejecutor(db), { desde, tope })).map((p) => p.codigo);

const conCodigos = async (
  db: DatabaseSync,
  codigos: string[],
  desde?: string,
  tope?: number
) => (await paraRevisarFotos(ejecutor(db), { codigos, desde, tope })).map((p) => p.codigo);

// --------------------------------------------------------------------------
// A quién hay que volver a mirarle la galería
// --------------------------------------------------------------------------

/**
 * ESTE ES EL TEST QUE SEPARA ESTA CONSULTA DE `sinFotos`, y la razón de que exista.
 *
 * `sinFotos` pregunta `NOT EXISTS(imagen)`: un producto CON foto no le interesa. Acá un
 * producto con una foto es justamente el caso: el filtro de rutas descartaba las
 * adicionales, así que quedó con la principal y nada más. No hay ninguna señal en la base
 * que distinga «tiene una porque el proveedor sirve una» de «tiene una porque perdimos
 * cinco» — sólo la ficha lo sabe.
 */
test('un producto que YA tiene una foto entra igual: es el caso que esto repara', async () => {
  const db = base();
  alta(db, { codigo: 'AAA111', fotos: 1 });
  assert.deepEqual(await codigosDe(db), ['AAA111']);
});

test('uno sin ninguna foto entra también: la ficha se pide igual', async () => {
  const db = base();
  alta(db, { codigo: 'AAA111', fotos: 0 });
  assert.deepEqual(await codigosDe(db), ['AAA111']);
});

test('uno con varias fotos entra también: no hay forma de saber si están todas', async () => {
  const db = base();
  alta(db, { codigo: 'AAA111', fotos: 6 });
  assert.deepEqual(await codigosDe(db), ['AAA111']);
});

test('devuelve la url de la ficha, que es lo que recibe /api/scrape/ficha', async () => {
  const db = base();
  alta(db, { codigo: 'AAA111', urlOrigen: 'https://www.chenson.com.py/producto/9-aaa111' });
  const [fila] = await paraRevisarFotos(ejecutor(db), {});
  assert.equal(fila?.url, 'https://www.chenson.com.py/producto/9-aaa111');
});

test('los estados publicables entran: importado, aprobado y publicado', async () => {
  const db = base();
  alta(db, { codigo: 'IMP001', estado: 'importado' });
  alta(db, { codigo: 'APR001', estado: 'aprobado' });
  alta(db, { codigo: 'PUB001', estado: 'publicado' });
  assert.deepEqual(await codigosDe(db), ['APR001', 'IMP001', 'PUB001']);
});

// --------------------------------------------------------------------------
// Lo que NO puede entrar, y por qué. Las mismas tres exclusiones de `sinFotos`.
// --------------------------------------------------------------------------

test('un eliminado no entra: ya se decidió sacarlo del catálogo', async () => {
  const db = base();
  alta(db, { codigo: 'DEL001', estado: 'eliminado', fotos: 1 });
  assert.deepEqual(await codigosDe(db), []);
});

test('sin url de origen no entra: no hay ficha que pedir', async () => {
  const db = base();
  alta(db, { codigo: 'SIN001', urlOrigen: null });
  alta(db, { codigo: 'SIN002', urlOrigen: '' });
  alta(db, { codigo: 'SIN003', urlOrigen: '   ' });
  assert.deepEqual(await codigosDe(db), []);
});

test('los que no son del proveedor no entran', async () => {
  /**
   * Los `manual` no salieron de ningún origen, y los `catalogo-viejo` son EXACTAMENTE los
   * que el proveedor ya no publica: pedirles la ficha traería una página que no existe. Y
   * además ésos no sufren el bug — la migración del catálogo viejo se traía TODAS las fotos.
   */
  const db = base();
  alta(db, { codigo: 'MAN001', proveedor: 'manual', fotos: 1 });
  alta(db, { codigo: 'VIE001', proveedor: 'catalogo-viejo', fotos: 1 });
  assert.deepEqual(await codigosDe(db), []);
});

// --------------------------------------------------------------------------
// El corte por código: es lo único que hace retomable una pasada que no se vacía sola
// --------------------------------------------------------------------------

/**
 * POR QUÉ HACE FALTA UN CORTE Y `sinFotos` NO LO NECESITA.
 *
 * Las otras dos pasadas de reparación se vacían solas: un producto al que se le llenó la
 * descripción deja de cumplir `trim(descripcion) = ''`, y uno al que se le consiguió una
 * foto deja de cumplir `NOT EXISTS(imagen)`. Ésta NO: revisar la galería de un producto no
 * cambia nada que la consulta pueda ver, así que al volver a entrar la lista está entera.
 *
 * Sin el corte, una pasada interrumpida a los 40 minutos vuelve a empezar del principio.
 */
test('desde: sólo los códigos POSTERIORES, sin repetir el último hecho', async () => {
  const db = base();
  for (const codigo of ['AAA111', 'BBB222', 'CCC333']) alta(db, { codigo });
  assert.deepEqual(await codigosDe(db, 'BBB222'), ['CCC333']);
});

test('desde vacío o ausente trae la lista entera', async () => {
  const db = base();
  for (const codigo of ['AAA111', 'BBB222']) alta(db, { codigo });
  assert.deepEqual(await codigosDe(db, ''), ['AAA111', 'BBB222']);
  assert.deepEqual(await codigosDe(db, '   '), ['AAA111', 'BBB222']);
  assert.deepEqual(await codigosDe(db, undefined), ['AAA111', 'BBB222']);
});

test('desde compara en mayúsculas, igual que el índice de la migración 0002', async () => {
  // El código se guarda normalizado, pero el marcador viaja por la red y puede volver
  // como lo escribió alguien. Comparar sin normalizar dejaría pasar de nuevo lo ya hecho.
  const db = base();
  for (const codigo of ['AAA111', 'BBB222']) alta(db, { codigo });
  assert.deepEqual(await codigosDe(db, 'aaa111'), ['BBB222']);
});

test('desde ilegible se trata como «desde el principio», no como error', async () => {
  /**
   * El marcador vive en `localStorage` del navegador y viaja tal cual por la red. Si algo lo
   * corrompe —una extensión, una edición a mano, un bug futuro— hacer fallar la pasada
   * entera sería peor que repetir unos minutos de trabajo idempotente.
   *
   * El comentario del código ya lo decía; esto es lo que lo verifica.
   */
  const db = base();
  for (const codigo of ['AAA111', 'BBB222']) alta(db, { codigo });
  for (const basura of ['con espacio', 'no válido #', '???', 'x'.repeat(200)]) {
    assert.deepEqual(await codigosDe(db, basura), ['AAA111', 'BBB222'], JSON.stringify(basura));
  }
});

test('desde con un código que no existe corta igual, por orden', async () => {
  // El marcador es una posición en el orden, no una fila: no tiene que existir.
  const db = base();
  for (const codigo of ['AAA111', 'CCC333']) alta(db, { codigo });
  assert.deepEqual(await codigosDe(db, 'BBB222'), ['CCC333']);
});

// --------------------------------------------------------------------------
// Orden
// --------------------------------------------------------------------------

test('ordena por código, que es estable entre corridas', async () => {
  // Es lo que hace que el corte por código signifique algo: sin un orden fijo, «seguir
  // desde acá» saltearía productos distintos en cada pasada.
  const db = base();
  for (const codigo of ['CCC333', 'AAA111', 'BBB222']) alta(db, { codigo });
  assert.deepEqual(await codigosDe(db), ['AAA111', 'BBB222', 'CCC333']);
});

// --------------------------------------------------------------------------
// El tope por corrida: lo que mantiene cada corrida por debajo de la
// tolerancia con la que `corridaEnCurso` la da por muerta
// --------------------------------------------------------------------------

/**
 * POR QUÉ HAY UN TOPE, y es lo que más importa de este archivo después de la guarda del
 * arreglo vacío.
 *
 * `corridaEnCurso` (corrida.ts) considera MUERTA cualquier corrida más vieja que
 * `TOLERANCIA_MINUTOS` = 30, para que una pestaña cerrada no bloquee el admin para siempre.
 * La pasada completa son ~60 minutos: pasado el minuto 30, con la corrida legítima todavía
 * viva, el 409 deja de bloquear y una segunda pestaña puede abrir otro recorrido. Dos
 * corridas a 1 pedido por segundo cada una DUPLICAN el paso al proveedor, que es
 * exactamente lo que esa guarda existe para impedir — y sin que nadie se entere.
 *
 * Se corta en tajadas en vez de subir la tolerancia: subirla a 70 minutos haría que una
 * corrida de verdad abandonada bloqueara el admin más de una hora. El cliente cierra una
 * tajada y abre la siguiente, así que ninguna corrida llega a los 30 minutos.
 */
test('el tope corta la lista', async () => {
  const db = base();
  for (const codigo of ['AAA111', 'BBB222', 'CCC333', 'DDD444']) alta(db, { codigo });
  assert.deepEqual(await codigosDe(db, undefined, 2), ['AAA111', 'BBB222']);
});

test('el tope respeta el orden, así que la tajada siguiente empieza donde terminó', async () => {
  // Si el tope no cortara por el mismo orden que el marcador, una tajada saltearía fichas.
  const db = base();
  for (const codigo of ['CCC333', 'AAA111', 'DDD444', 'BBB222']) alta(db, { codigo });
  assert.deepEqual(await codigosDe(db, undefined, 2), ['AAA111', 'BBB222']);
  assert.deepEqual(await codigosDe(db, 'BBB222', 2), ['CCC333', 'DDD444']);
});

test('el tope también acota una prueba: pegar 500 códigos no es una excusa', async () => {
  const db = base();
  for (const codigo of ['AAA111', 'BBB222', 'CCC333']) alta(db, { codigo });
  assert.deepEqual(await conCodigos(db, ['CCC333', 'BBB222', 'AAA111'], undefined, 2), [
    'AAA111',
    'BBB222',
  ]);
});

test('sin tope trae todo: el tope es una decisión de quien llama, no un default escondido', async () => {
  const db = base();
  for (const codigo of ['AAA111', 'BBB222', 'CCC333']) alta(db, { codigo });
  assert.deepEqual(await codigosDe(db), ['AAA111', 'BBB222', 'CCC333']);
});

test('un tope inservible se ignora en vez de devolver nada', async () => {
  /**
   * Cero o negativo saldría de un cálculo mal hecho, no de una intención. `LIMIT 0` devolvería
   * una lista vacía, la pantalla diría «no queda nada por revisar» y la pasada terminaría sin
   * hacer NADA, reportando éxito. Es la clase de falla que no deja rastro.
   */
  const db = base();
  for (const codigo of ['AAA111', 'BBB222']) alta(db, { codigo });
  for (const malo of [0, -1, NaN, 1.5]) {
    assert.deepEqual(await codigosDe(db, undefined, malo), ['AAA111', 'BBB222'], String(malo));
  }
});

// --------------------------------------------------------------------------
// `contarParaRevisar`: cuántas quedan en total, no en esta tajada
// --------------------------------------------------------------------------

/**
 * POR QUÉ HACE FALTA APARTE DE LA LISTA. Con tajadas, `productos.length` es el tamaño de la
 * tajada y no el del trabajo. Sin este total, la barra de progreso mediría la tajada y
 * llegaría al 100% tres veces, y el resumen final no podría decir cuántas fichas se
 * revisaron de cuántas — que es lo único que delata un marcador corrupto que salteó un tramo.
 */
test('contarParaRevisar cuenta todas las que quedan, sin importar el tope', async () => {
  const db = base();
  for (const codigo of ['AAA111', 'BBB222', 'CCC333']) alta(db, { codigo });
  assert.equal(await contarParaRevisar(ejecutor(db), {}), 3);
  assert.equal(await contarParaRevisar(ejecutor(db), { tope: 1 }), 3);
});

test('contarParaRevisar respeta el corte por marcador', async () => {
  const db = base();
  for (const codigo of ['AAA111', 'BBB222', 'CCC333']) alta(db, { codigo });
  assert.equal(await contarParaRevisar(ejecutor(db), { desde: 'AAA111' }), 2);
});

test('contarParaRevisar aplica las mismas exclusiones que la lista', async () => {
  // Si contara distinto que la lista, la barra nunca llegaría al final.
  const db = base();
  alta(db, { codigo: 'OK0001' });
  alta(db, { codigo: 'DEL001', estado: 'eliminado' });
  alta(db, { codigo: 'MAN001', proveedor: 'manual' });
  alta(db, { codigo: 'SIN001', urlOrigen: null });
  assert.equal(await contarParaRevisar(ejecutor(db), {}), 1);
});

test('contarParaRevisar en modo prueba cuenta sólo los códigos pedidos', async () => {
  const db = base();
  for (const codigo of ['AAA111', 'BBB222', 'CCC333']) alta(db, { codigo });
  assert.equal(await contarParaRevisar(ejecutor(db), { codigos: ['AAA111', 'CCC333'] }), 2);
  assert.equal(await contarParaRevisar(ejecutor(db), { codigos: [] }), 0);
});

// --------------------------------------------------------------------------
// La prueba de a puñado: correr la pasada sobre unos códigos elegidos a mano
// --------------------------------------------------------------------------

/**
 * POR QUÉ EXISTE ESTE MODO. La pasada completa son ~40 minutos contra el catálogo entero, y
 * es la primera vez que corre. Antes de largar eso conviene mirar el resultado sobre los
 * cuatro códigos donde el problema se midió: si ahí aparecen las fotos que faltaban, la
 * pasada larga se lanza sabiendo lo que va a hacer, y no probándola.
 *
 * Y se prueba contra los datos DE VERDAD, que es lo que una siembra local no puede dar.
 */
test('con códigos, la lista son exactamente esos', async () => {
  const db = base();
  for (const codigo of ['AAA111', 'BBB222', 'CCC333']) alta(db, { codigo });
  assert.deepEqual(await conCodigos(db, ['CCC333', 'AAA111']), ['AAA111', 'CCC333']);
});

test('con códigos, el orden sigue siendo por código y no el que se escribió', async () => {
  // El orden de la lista es lo que recorre la pantalla, y tiene que ser predecible.
  const db = base();
  for (const codigo of ['AAA111', 'BBB222', 'CCC333']) alta(db, { codigo });
  assert.deepEqual(await conCodigos(db, ['CCC333', 'BBB222', 'AAA111']), [
    'AAA111',
    'BBB222',
    'CCC333',
  ]);
});

test('con códigos, se ignora el marcador: una prueba no es progreso de la pasada', async () => {
  /**
   * El marcador dice hasta dónde llegó la PASADA COMPLETA. Una prueba a mano no avanza eso,
   * y si el corte se aplicara, pedir un código anterior al marcador devolvería nada — que
   * es exactamente el caso de «probemos de nuevo los cuatro» después de una corrida larga.
   */
  const db = base();
  for (const codigo of ['AAA111', 'ZZZ999']) alta(db, { codigo });
  assert.deepEqual(await conCodigos(db, ['AAA111'], 'ZZZ999'), ['AAA111']);
});

test('con códigos en minúscula, machea igual', async () => {
  // Se pegan a mano en un campo de texto. El índice de la migración 0002 compara con
  // `upper()` y acá se hace lo mismo.
  const db = base();
  alta(db, { codigo: 'AAA111' });
  assert.deepEqual(await conCodigos(db, ['aaa111', ' AaA111 ']), ['AAA111']);
});

test('un código que no existe simplemente no aparece', async () => {
  // Quién lo pidió y no salió lo informa el endpoint comparando contra `codigosPedidos`:
  // sin eso, un código mal tipeado se vería igual que uno que ya está completo.
  const db = base();
  alta(db, { codigo: 'AAA111' });
  assert.deepEqual(await conCodigos(db, ['AAA111', 'NOEXISTE9']), ['AAA111']);
});

/**
 * ESTA ES LA GUARDA QUE MÁS IMPORTA DE TODO EL ARCHIVO.
 *
 * `codigos: []` tiene que significar NADA, nunca «todo». Si un campo vacío en la pantalla
 * mandara un arreglo vacío y eso cayera en el camino de la lista completa, un click de
 * prueba largaría una corrida de 40 minutos sobre el catálogo entero contra producción. La
 * diferencia entre «no me pasaron el parámetro» y «me lo pasaron vacío» es toda la
 * diferencia acá.
 */
test('codigos vacío devuelve NADA, no el catálogo entero', async () => {
  const db = base();
  for (const codigo of ['AAA111', 'BBB222']) alta(db, { codigo });
  assert.deepEqual(await conCodigos(db, []), []);
  assert.deepEqual(await conCodigos(db, ['', '   ']), []);
  // Y sin el parámetro sí trae todo, que es el otro lado de la misma moneda.
  assert.deepEqual(await codigosDe(db), ['AAA111', 'BBB222']);
});

test('con códigos, las tres exclusiones siguen valiendo', async () => {
  /**
   * Pedirlo a mano no habilita nada: un eliminado sigue afuera, y uno sin ficha también.
   * Si la prueba pudiera saltear las exclusiones, sería una prueba de otra cosa.
   */
  const db = base();
  alta(db, { codigo: 'DEL001', estado: 'eliminado' });
  alta(db, { codigo: 'MAN001', proveedor: 'manual' });
  alta(db, { codigo: 'SIN001', urlOrigen: null });
  alta(db, { codigo: 'OK0001' });
  assert.deepEqual(await conCodigos(db, ['DEL001', 'MAN001', 'SIN001', 'OK0001']), ['OK0001']);
});

test('un código ilegible se descarta y no tumba la prueba', async () => {
  // Se pega texto a mano: un `#` colado no puede hacer fallar la corrida de los otros tres.
  const db = base();
  alta(db, { codigo: 'AAA111' });
  assert.deepEqual(await conCodigos(db, ['AAA111', 'no válido #']), ['AAA111']);
});

// --------------------------------------------------------------------------
// `codigosPedidos`: lo que se pidió, normalizado. Es con lo que el endpoint
// descubre qué código no apareció.
// --------------------------------------------------------------------------

test('codigosPedidos normaliza, deduplica y conserva el orden de aparición', async () => {
  assert.deepEqual(codigosPedidos([' aaa111 ', 'BBB222', 'AAA111']), ['AAA111', 'BBB222']);
});

test('codigosPedidos descarta lo vacío y lo ilegible, sin lanzar', async () => {
  // Lanzar acá haría que un carácter de más en el campo perdiera la prueba entera.
  assert.deepEqual(codigosPedidos(['', '   ', 'no válido #', 'OK0001']), ['OK0001']);
});

// --------------------------------------------------------------------------
// `partirCodigos`: el texto del campo, partido. Vive acá y no en el cliente
// porque es una decisión, y las decisiones se prueban sin navegador.
// --------------------------------------------------------------------------

test('partirCodigos acepta como se pegue: comas, espacios, saltos de línea', async () => {
  /**
   * Se pega desde una planilla, desde un chat o a mano. Exigir un formato sería una trampa:
   * el síntoma de un separador no soportado es «no encontró ninguno», que no señala la causa.
   */
  const esperado = ['8735032', '8735036', '8134028', '8134029'];
  assert.deepEqual(partirCodigos('8735032, 8735036, 8134028, 8134029'), esperado);
  assert.deepEqual(partirCodigos('8735032 8735036 8134028 8134029'), esperado);
  assert.deepEqual(partirCodigos('8735032\n8735036\n8134028\n8134029'), esperado);
  assert.deepEqual(partirCodigos('8735032;8735036\n 8134028 ,\t8134029  '), esperado);
});

test('partirCodigos de un texto vacío devuelve un arreglo vacío', async () => {
  // Y ese vacío es el que la pantalla usa para NO largar nada. Ver la nota del botón.
  assert.deepEqual(partirCodigos(''), []);
  assert.deepEqual(partirCodigos('   \n , ; \t '), []);
});
