import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { Ejecutar } from '../grilla.ts';
import {
  abrirVuelta,
  cerrarVuelta,
  frescuraDelBarrido,
  planDeVuelta,
  vueltaActual,
} from './vuelta.ts';

const MIGRACIONES = ['0001_esquema_inicial.sql', '0009_vueltas_de_barrido.sql'].map((n) =>
  readFileSync(new URL(`../../../../db/migrations/${n}`, import.meta.url), 'utf8')
);

const AYER = '2026-09-09T09:00:00Z';
const HOY = '2026-09-10T09:00:00Z';

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

test('sin vueltas todavia, no hay vuelta actual', async () => {
  assert.equal(await vueltaActual(ejecutor(base())), null);
});

test('abrir una vuelta la deja en curso', async () => {
  const ejecutar = ejecutor(base());
  const abierta = await abrirVuelta(ejecutar, { ahora: HOY });

  assert.equal(abierta.iniciada_en, HOY);
  assert.equal(abierta.terminada_en, null);
  assert.deepEqual(await vueltaActual(ejecutar), abierta);
});

test('ABRIR ES IDEMPOTENTE: no arranca una vuelta nueva si hay una en curso', async () => {
  /**
   * Cada corrida de 300 pide `/api/scrape/abrir`, y una vuelta son varias corridas. Si
   * abrir empezara una vuelta nueva cada vez, la cuenta regresiva volveria al total en
   * cada corrida y no bajaria jamas — que es el bug que esta tabla vino a cerrar.
   */
  const ejecutar = ejecutor(base());
  const primera = await abrirVuelta(ejecutar, { ahora: AYER });
  const segunda = await abrirVuelta(ejecutar, { ahora: HOY });

  assert.deepEqual(segunda, primera);
  assert.equal(segunda.iniciada_en, AYER, 'la fecha de la vuelta no se corre');
});

test('cerrada una vuelta, la siguiente arranca de cero', async () => {
  const ejecutar = ejecutor(base());
  const primera = await abrirVuelta(ejecutar, { ahora: AYER });
  await cerrarVuelta(ejecutar, primera.id, { ahora: HOY });

  const cerrada = await vueltaActual(ejecutar);
  assert.equal(cerrada?.terminada_en, HOY);

  const segunda = await abrirVuelta(ejecutar, { ahora: HOY });
  assert.notEqual(segunda.id, primera.id);
  assert.equal(segunda.terminada_en, null);
});

test('la vuelta actual es la ULTIMA, este cerrada o abierta', async () => {
  // La pantalla necesita distinguir «nunca se barrio» de «la vuelta anterior se
  // completo», y son dos mensajes distintos. Por eso no alcanza con buscar la abierta.
  const ejecutar = ejecutor(base());
  const primera = await abrirVuelta(ejecutar, { ahora: AYER });
  await cerrarVuelta(ejecutar, primera.id, { ahora: HOY });

  const actual = await vueltaActual(ejecutar);
  assert.equal(actual?.id, primera.id);
  assert.equal(actual?.terminada_en, HOY);
});

test('LA BASE impide dos vueltas abiertas, no una consulta previa', async () => {
  /**
   * `/api/scrape/abrir` lo pueden pedir dos pestañas a la vez, y entre el SELECT y el
   * INSERT de `abrirVuelta` hay una ventana. Con dos vueltas abiertas, la cuenta
   * regresiva dependeria de cual gana el ORDER BY.
   */
  const db = base();
  db.prepare('INSERT INTO barrido_vueltas (iniciada_en) VALUES (?)').run(AYER);

  assert.throws(
    () => db.prepare('INSERT INTO barrido_vueltas (iniciada_en) VALUES (?)').run(HOY),
    /UNIQUE|constraint/i
  );
});

test('si otra pestaña gana la carrera, abrir DEVUELVE SU VUELTA en vez de explotar', async () => {
  /**
   * El indice unico garantiza que no haya dos vueltas abiertas, pero por si solo convierte
   * la carrera en un 500 para la pestaña que pierde. `abrirVuelta` se declara idempotente:
   * quien pide abrir tiene que recibir la vuelta en curso, la haya creado el o no.
   *
   * Se simula con un ejecutor falso porque la carrera real necesita dos conexiones a la
   * vez, y lo que hay que probar es la reaccion al choque, no el choque.
   */
  const otra = { id: 7, iniciada_en: AYER, terminada_en: null };
  let intentos = 0;

  const ejecutar = (async (sql: string) => {
    if (sql.includes('INSERT')) {
      intentos += 1;
      throw new Error('UNIQUE constraint failed: index idx_barrido_vueltas_abierta');
    }
    // El primer SELECT no ve nada; el de despues del choque ya ve la de la otra pestaña.
    return intentos === 0 ? [] : [otra];
  }) as unknown as Ejecutar;

  assert.deepEqual(await abrirVuelta(ejecutar, { ahora: HOY }), otra);
});

test('un INSERT que falla por otra cosa no se disfraza de vuelta ajena', async () => {
  // Tragarse cualquier error dejaria una base rota pareciendo una carrera resuelta.
  const ejecutar = (async (sql: string) => {
    if (sql.includes('INSERT')) throw new Error('no such table: barrido_vueltas');
    return [];
  }) as unknown as Ejecutar;

  await assert.rejects(() => abrirVuelta(ejecutar, { ahora: HOY }), /no such table/);
});

test('cerrar una vuelta que ya no esta abierta no rompe', async () => {
  // El cierre lo dispara el render de la pantalla, y dos pestañas pueden rendirla a la
  // vez sobre la misma vuelta terminada.
  const ejecutar = ejecutor(base());
  const vuelta = await abrirVuelta(ejecutar, { ahora: AYER });
  await cerrarVuelta(ejecutar, vuelta.id, { ahora: HOY });
  await cerrarVuelta(ejecutar, vuelta.id, { ahora: HOY });

  const actual = await vueltaActual(ejecutar);
  assert.equal(actual?.terminada_en, HOY, 'la fecha de cierre es la primera, no la ultima');
});

/**
 * EL PLAN DE LA VUELTA.
 *
 * Esta decision vivia suelta en el frontmatter de `barrido.astro`: seis variables
 * encadenadas —`abiertaAntes`, `pendientesDeLaAbierta`, `recienCompletada`, `enCurso`,
 * `desde`, `pendientes`— sin un solo test. Es EXACTAMENTE el pecado que `barrido.ts`
 * denuncia en su propio comentario y el que dejo pasar los dos bugs anteriores: la
 * aritmetica que nadie puede testear es la que se equivoca callada durante meses.
 *
 * Con la logica aca, la pagina queda como cableado mecanico.
 */
test('sin vueltas todavia: apretar arranca una y el catalogo entero esta pendiente', () => {
  const plan = planDeVuelta({ vuelta: null, pendientesDeLaAbierta: null, total: 1457 });

  assert.deepEqual(plan, {
    desde: undefined,
    pendientes: 1457,
    cerrar: null,
    completada: false,
  });
});

test('vuelta en curso: la cola y el conteo se filtran por su fecha', () => {
  const plan = planDeVuelta({
    vuelta: { id: 3, iniciada_en: AYER, terminada_en: null },
    pendientesDeLaAbierta: 857,
    total: 1457,
  });

  assert.deepEqual(plan, { desde: AYER, pendientes: 857, cerrar: null, completada: false });
});

test('vuelta en curso sin pendientes: SE CIERRA en este render', () => {
  /**
   * El cierre se decide al rendir y no al marcar el ultimo producto: marcar es un
   * endpoint por producto, y preguntar «¿ya esta completa?» ahi serian 300 `COUNT(*)`
   * por corrida para una respuesta que importa una sola vez.
   */
  const plan = planDeVuelta({
    vuelta: { id: 3, iniciada_en: AYER, terminada_en: null },
    pendientesDeLaAbierta: 0,
    total: 1457,
  });

  assert.equal(plan.cerrar, 3, 'hay que cerrar la vuelta 3');
  assert.equal(plan.completada, true, 'y decirlo');
  assert.equal(plan.desde, undefined, 'lo que sigue es una vuelta nueva');
  assert.equal(plan.pendientes, 1457, 'con el catalogo entero pendiente otra vez');
});

test('vuelta ya cerrada: se anuncia el logro y no se vuelve a cerrar', () => {
  const plan = planDeVuelta({
    vuelta: { id: 3, iniciada_en: AYER, terminada_en: HOY },
    pendientesDeLaAbierta: null,
    total: 1457,
  });

  assert.deepEqual(plan, {
    desde: undefined,
    pendientes: 1457,
    cerrar: null,
    completada: true,
  });
});

test('una vuelta cerrada NO se cierra dos veces aunque se recargue la pantalla', () => {
  // Dos pestañas pueden rendir `/barrido` a la vez sobre la misma vuelta terminada.
  const vuelta = { id: 3, iniciada_en: AYER, terminada_en: HOY };
  const primera = planDeVuelta({ vuelta, pendientesDeLaAbierta: null, total: 10 });
  const segunda = planDeVuelta({ vuelta, pendientesDeLaAbierta: null, total: 10 });

  assert.equal(primera.cerrar, null);
  assert.equal(segunda.cerrar, null);
});

test('un catalogo vacio no deja una vuelta abierta para siempre', () => {
  /**
   * Sin barribles, `contarPendientes` da 0 desde el primer momento. Si eso no cerrara la
   * vuelta, quedaria abierta eternamente y el dia que entre el primer producto se lo
   * contaria como pendiente de una vuelta que arranco meses antes.
   */
  const plan = planDeVuelta({
    vuelta: { id: 1, iniciada_en: AYER, terminada_en: null },
    pendientesDeLaAbierta: 0,
    total: 0,
  });

  assert.equal(plan.cerrar, 1);
  assert.equal(plan.pendientes, 0);
});

/**
 * LA FRESCURA DEL BARRIDO, que es lo que el Inicio necesita saber.
 *
 * EL AGUJERO QUE CIERRA, senalado el 2026-09-10 con «y cuando vuelve a revisar el
 * catalogo entero?»: nunca solo, y hasta ahora NADA lo recordaba. El unico aviso del
 * Inicio era «hay N productos que el proveedor ya no publica», y ese aviso es CIRCULAR:
 * las bajas aparecen solo si se barre. Dejando de barrer, el Inicio se queda callado y
 * se lee como que todo esta bien — cuando hace tres meses que nadie le pregunta nada al
 * proveedor.
 *
 * SIN UMBRAL A PROPOSITO. Un «se pone rojo a los 30 dias» seria volver a meter la
 * cadencia que se descarto: no hay cada-cuanto, el barrido se corre cuando se lo pide.
 * Lo que se informa es un hecho —hace cuanto—, y «hace 4 meses» ya alarma solo.
 */
test('sin ninguna vuelta, se dice que nunca se reviso', () => {
  assert.deepEqual(frescuraDelBarrido(null), { tipo: 'nunca' });
});

test('vuelta completada: se informa cuando, para que el Inicio diga hace cuanto', () => {
  assert.deepEqual(frescuraDelBarrido({ id: 1, iniciada_en: AYER, terminada_en: HOY }), {
    tipo: 'completada',
    cuando: HOY,
  });
});

test('una vuelta empezada y sin terminar NO cuenta como catalogo revisado', () => {
  /**
   * Es la distincion que hace util este aviso. Una vuelta abierta hace tres semanas es
   * trabajo a medio hacer, y tratarla como «revisado» seria peor que no avisar: alcanzaria
   * con apretar una vez y abandonar para que el Inicio diga que todo esta al dia.
   */
  assert.deepEqual(frescuraDelBarrido({ id: 1, iniciada_en: AYER, terminada_en: null }), {
    tipo: 'en-curso',
    desde: AYER,
  });
});
