import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { Ejecutar } from '../grilla.ts';
import {
  anotarError,
  cerrarCorrida,
  codigoYaVisto,
  contarFicha,
  contarRevisado,
  corridaEnCurso,
  iniciarCorrida,
} from './corrida.ts';
import { registrarFicha } from './registrar.ts';

const MIGRACIONES = [
  '0001_esquema_inicial.sql',
  '0002_codigo_insensible_a_mayusculas.sql',
  '0003_aviso_cambio_en_origen.sql',
  '0004_papelera.sql',
  '0005_barrido_de_bajas.sql',
].map((n) => readFileSync(new URL(`../../../../db/migrations/${n}`, import.meta.url), 'utf8'));

const INICIO = '2026-08-06T15:00:00Z';
const URL_LISTADO = 'https://www.chenson.com.py/lanzamientos/?lz=2026-07-16';

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

test('la corrida se abre en corriendo y con su total de páginas', async () => {
  const e = ejecutor(base());
  const id = await iniciarCorrida(e, { url: URL_LISTADO, paginas: 4, ahora: INICIO });
  const abierta = await corridaEnCurso(e, { ahora: INICIO });

  assert.equal(abierta?.id, id);
  assert.equal(abierta?.estado, 'corriendo');
  assert.equal(abierta?.paginas, 4);
});

test('sin corridas abiertas devuelve null', async () => {
  assert.equal(await corridaEnCurso(ejecutor(base()), { ahora: INICIO }), null);
});

test('una corrida sin tipo declarado es una importación', async () => {
  // Las filas historicas son todas importaciones: el default las cubre sin migrar datos.
  const e = ejecutor(base());
  await iniciarCorrida(e, { url: URL_LISTADO, paginas: 1, ahora: INICIO });
  assert.equal((await corridaEnCurso(e, { ahora: INICIO }))?.tipo, 'importacion');
});

test('un barrido abierto bloquea una importación, y al revés', async () => {
  /**
   * ES EL MOTIVO DE QUE COMPARTAN TABLA. El paso de 1 request por segundo lo marca
   * cada pestaña por su cuenta, asi que dos recorridos a la vez se lo duplican al
   * proveedor aunque uno importe y el otro solo pregunte.
   */
  const e = ejecutor(base());
  await iniciarCorrida(e, { url: 'barrido', paginas: 1, ahora: INICIO, tipo: 'barrido' });

  const abierta = await corridaEnCurso(e, { ahora: INICIO });
  assert.equal(abierta?.tipo, 'barrido');
});

test('el barrido cuenta revisados sin tocar la contabilidad de la importación', async () => {
  /**
   * `nuevos` y `repetidos` significan "productos que entraron al catalogo". El barrido
   * no hace entrar a ninguno: si los moviera, el resumen de §10.2 diria cualquier cosa
   * al mezclarse las corridas.
   */
  const e = ejecutor(base());
  const id = await iniciarCorrida(e, { url: 'barrido', paginas: 1, ahora: INICIO, tipo: 'barrido' });

  await contarRevisado(e, id);
  await contarRevisado(e, id);

  const r = await cerrarCorrida(e, id, { ahora: INICIO });
  assert.equal(r.hallados, 2);
  assert.equal(r.nuevos, 0);
  assert.equal(r.repetidos, 0);
});

test('una corrida cerrada deja de estar en curso', async () => {
  const e = ejecutor(base());
  const id = await iniciarCorrida(e, { url: URL_LISTADO, paginas: 1, ahora: INICIO });
  await cerrarCorrida(e, id, { ahora: '2026-08-06T15:10:00Z' });

  assert.equal(await corridaEnCurso(e, { ahora: '2026-08-06T15:10:00Z' }), null);
});

test('una corrida abandonada no bloquea el admin para siempre', async () => {
  /**
   * El bucle vive en el navegador: si se cierra la pestaña, la fila queda en
   * `corriendo` y nadie la va a cerrar. Sin la tolerancia, el admin no volveria a
   * dejar importar nunca mas.
   */
  const e = ejecutor(base());
  await iniciarCorrida(e, { url: URL_LISTADO, paginas: 4, ahora: INICIO });

  assert.ok(await corridaEnCurso(e, { ahora: '2026-08-06T15:20:00Z' }), 'a los 20 min sigue viva');
  assert.equal(await corridaEnCurso(e, { ahora: '2026-08-06T16:30:00Z' }), null, 'a la hora y media, no');
});

test('el conteo separa nuevos de repetidos', async () => {
  const e = ejecutor(base());
  const id = await iniciarCorrida(e, { url: URL_LISTADO, paginas: 1, ahora: INICIO });

  await contarFicha(e, id, { creado: true });
  await contarFicha(e, id, { creado: true });
  await contarFicha(e, id, { creado: false });

  const r = await cerrarCorrida(e, id, { ahora: INICIO });
  assert.equal(r.hallados, 3);
  assert.equal(r.nuevos, 2);
  assert.equal(r.repetidos, 1);
});

test('una ficha caída se anota y no corta la corrida', async () => {
  const e = ejecutor(base());
  const id = await iniciarCorrida(e, { url: URL_LISTADO, paginas: 1, ahora: INICIO });

  await anotarError(e, id, { url: 'https://www.chenson.com.py/producto/1-cg1', motivo: 'HTTP 502', ahora: INICIO });
  await contarFicha(e, id, { creado: true });

  const r = await cerrarCorrida(e, id, { ahora: INICIO });
  assert.equal(r.errores, 1);
  assert.equal(r.hallados, 1, 'la ficha siguiente entro igual');
  assert.equal(r.estado, 'terminado');
});

test('un motivo larguísimo no rompe la anotación', async () => {
  // Un stack trace entero o un HTML de error no pueden hacer fallar el registro del
  // error: seria perder el dato justo cuando mas se necesita.
  const db = base();
  const e = ejecutor(db);
  const id = await iniciarCorrida(e, { url: URL_LISTADO, paginas: 1, ahora: INICIO });
  await anotarError(e, id, { url: 'u', motivo: 'x'.repeat(5000), ahora: INICIO });

  const fila = db.prepare('SELECT motivo FROM scrape_errores').get() as { motivo: string };
  assert.equal(fila.motivo.length, 500);
});

test('un modelo ya visto en esta corrida no se vuelve a pedir', async () => {
  /**
   * Los colores hermanos se descubren desde la ficha de cualquiera de ellos. Sin este
   * corte, un modelo de 3 colores costaria 3 requests al proveedor para traer lo mismo.
   */
  const db = base();
  const e = ejecutor(db);
  const id = await iniciarCorrida(e, { url: URL_LISTADO, paginas: 1, ahora: INICIO });

  assert.equal(await codigoYaVisto(e, id, 'CG85700'), false);

  await registrarFicha(
    e,
    {
      codigo: 'CG85700',
      urlOrigen: 'https://www.chenson.com.py/producto/71163-cg85700',
      colores: [{ colorOrigen: '(3) NEGRO', url: 'u' }],
    },
    { scrapeId: id, ahora: INICIO }
  );

  assert.equal(await codigoYaVisto(e, id, 'CG85700'), true);
  assert.equal(await codigoYaVisto(e, id, 'cg85700'), true, 'sin distinguir mayusculas');
});

test('un producto de una corrida anterior no cuenta como visto en esta', async () => {
  // Si contara, un segundo scrape del mismo lanzamiento no actualizaria nada.
  const e = ejecutor(base());
  const vieja = await iniciarCorrida(e, { url: URL_LISTADO, paginas: 1, ahora: INICIO });
  await registrarFicha(
    e,
    { codigo: 'CG85700', urlOrigen: 'u', colores: [{ colorOrigen: '(3) NEGRO', url: 'u' }] },
    { scrapeId: vieja, ahora: INICIO }
  );
  await cerrarCorrida(e, vieja, { ahora: INICIO });

  const nueva = await iniciarCorrida(e, { url: URL_LISTADO, paginas: 1, ahora: '2026-08-07T10:00:00Z' });
  assert.equal(await codigoYaVisto(e, nueva, 'CG85700'), false);
});
