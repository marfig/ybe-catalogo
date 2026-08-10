import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

import {
  crearPublicacion,
  describirPublicacion,
  haceCuanto,
  hayPublicacionEnCurso,
  ultimaPublicacion,
} from './publicaciones.ts';
import type { Ejecutar } from './grilla.ts';

/**
 * Tests del estado visible de la publicación (SPEC-etapa2 §11.3).
 *
 * «Un check rojo en GitHub no existe para quien no entra a GitHub.» Esta es la pieza
 * que hace seguro el auto-publish con una persona no técnica, así que lo que se
 * prueba es lo que ESA persona ve, no lo que pasó por dentro.
 */

const MIGRACION = readFileSync(
  new URL('../../../db/migrations/0001_esquema_inicial.sql', import.meta.url),
  'utf8'
);

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

const T = (iso: string) => new Date(iso).getTime();
const AHORA = '2026-08-05T18:00:00Z';

// --------------------------------------------------------------------------
// haceCuanto — el tiempo en castellano, no un timestamp
// --------------------------------------------------------------------------

test('haceCuanto: segundos, minutos, horas y dias', () => {
  const casos: Array<[string, string]> = [
    ['2026-08-05T17:59:20Z', 'hace 40 segundos'],
    ['2026-08-05T17:58:00Z', 'hace 2 minutos'],
    ['2026-08-05T17:00:00Z', 'hace 1 hora'],
    ['2026-08-05T16:00:00Z', 'hace 2 horas'],
    ['2026-08-04T18:00:00Z', 'hace 1 día'],
    ['2026-08-02T18:00:00Z', 'hace 3 días'],
  ];
  for (const [desde, esperado] of casos) {
    assert.equal(haceCuanto(desde, AHORA), esperado, `fallo con ${desde}`);
  }
});

test('haceCuanto: menos de 10 segundos se dice "recién"', () => {
  // "hace 3 segundos" en una pantalla que no se auto-refresca envejece mal.
  assert.equal(haceCuanto('2026-08-05T17:59:57Z', AHORA), 'recién');
});

test('haceCuanto: una fecha futura no dice "hace -5 minutos"', () => {
  // Pasa con relojes desfasados. Un negativo en la cara del usuario es un bug a la
  // vista; "recién" es honesto y no asusta.
  assert.equal(haceCuanto('2026-08-05T18:05:00Z', AHORA), 'recién');
});

test('haceCuanto: una fecha ilegible no rompe la pantalla', () => {
  assert.equal(haceCuanto('no soy una fecha', AHORA), 'en un momento indeterminado');
});

// --------------------------------------------------------------------------
// describirPublicacion — la tabla de §11.3
// --------------------------------------------------------------------------

const pub = (extra: Record<string, unknown> = {}) => ({
  id: 1,
  estado: 'ok',
  disparada_por: 'marvin@ybe.com.py',
  disparada_en: '2026-08-05T16:00:00Z',
  terminada_en: '2026-08-05T16:02:00Z',
  productos: 8,
  run_url: 'https://github.com/x/y/actions/runs/1',
  commit_sha: 'abc123',
  error: null,
  ...extra,
});

test('sin publicaciones todavia, lo dice sin alarmar', () => {
  const d = describirPublicacion(null, AHORA);
  assert.equal(d.tono, 'neutro');
  assert.match(d.titulo, /todavía|nunca/i);
});

test('pendiente y corriendo se ven igual: "Publicando…"', () => {
  /**
   * Para quien opera son el mismo momento: el trabajo esta en curso. La diferencia
   * entre "encolado" y "arrancado" es vocabulario de CI.
   *
   * La fecha va DENTRO del plazo de vencimiento a proposito. Antes usaba el default de
   * `pub()` —dos horas— y quedo rojo al agregarle vencimiento al cartel: dos horas en
   * `corriendo` ya no es «publicando», es «no llego respuesta». El test tenia razon en
   * lo que afirmaba y su fixture era el que habia envejecido.
   */
  for (const estado of ['pendiente', 'corriendo']) {
    const d = describirPublicacion(
      pub({ estado, disparada_en: '2026-08-05T17:57:00Z', terminada_en: null }),
      AHORA
    );
    assert.equal(d.tono, 'en-curso', estado);
    assert.match(d.titulo, /Publicando/i);
    assert.match(d.detalle, /hace 3 minutos/);
  }
});

test('ok cuenta desde que TERMINO, no desde que arranco', () => {
  // "Publicado hace 2 horas" es cuando el catalogo quedo en el sitio, no cuando se
  // apreto el boton. Con un build lento la diferencia se nota.
  const d = describirPublicacion(
    pub({ disparada_en: '2026-08-05T14:00:00Z', terminada_en: '2026-08-05T16:00:00Z' }),
    AHORA
  );
  assert.equal(d.tono, 'ok');
  assert.match(d.titulo, /Publicado hace 2 horas/);
  assert.match(d.detalle, /8 productos/);
});

test('ok sin terminada_en cae a disparada_en en vez de romper', () => {
  const d = describirPublicacion(
    pub({ disparada_en: '2026-08-05T16:00:00Z', terminada_en: null }),
    AHORA
  );
  assert.match(d.titulo, /Publicado hace 2 horas/);
});

test('ok con un solo producto no dice "1 productos"', () => {
  const d = describirPublicacion(pub({ productos: 1 }), AHORA);
  assert.match(d.detalle, /1 producto\b/);
});

test('error avisa que el equipo tecnico ya sabe y dice que hacer mientras', () => {
  const d = describirPublicacion(pub({ estado: 'error', error: 'algo' }), AHORA);
  assert.equal(d.tono, 'error');
  assert.match(d.titulo, /No se pudo publicar/i);
  assert.match(d.detalle, /equipo t[eé]cnico/i);
  // "Que hacer mientras": sin eso, quien opera queda parado sin saber si perdio el
  // trabajo. No lo perdio: sigue guardado y se puede reintentar.
  assert.match(d.detalle, /sigue guardado|volver a intentar|no se perdi/i);
});

test('el error NO muestra el stack ni el volcado de Zod', () => {
  // §11.3 es explicito. Para quien opera, un error de Zod se traduce a algo
  // accionable, no a un volcado con rutas de archivos.
  const stack =
    'ZodError: Invalid enum value at productos[3].categorias[1]\n    at parse (/app/node_modules/zod/lib/index.js:1:1)';
  const d = describirPublicacion(pub({ estado: 'error', error: stack }), AHORA);
  assert.doesNotMatch(d.detalle, /node_modules|ZodError|at parse/);
  assert.doesNotMatch(d.titulo, /node_modules|ZodError/);
});

test('el mensaje corto del error SI se muestra si es legible', () => {
  // Un mensaje escrito para humanos es la mejor pista. Lo que se filtra es el stack.
  const d = describirPublicacion(
    pub({ estado: 'error', error: 'Revisá las categorías del producto CG85527' }),
    AHORA
  );
  assert.match(d.detalle, /CG85527/);
});

test('el run de Actions viaja aparte, para el rol tecnico', () => {
  const d = describirPublicacion(pub({ estado: 'error', error: 'x' }), AHORA);
  assert.equal(d.runUrl, 'https://github.com/x/y/actions/runs/1');
});

// --------------------------------------------------------------------------
// La tabla
// --------------------------------------------------------------------------

test('crearPublicacion deja una fila pendiente con quien la disparo', async () => {
  const db = base();
  const id = await crearPublicacion(ejecutor(db), {
    email: 'marvin@ybe.com.py',
    ahora: AHORA,
  });

  const fila = db.prepare(`SELECT * FROM publicaciones WHERE id = ?`).get(id) as Record<
    string,
    unknown
  >;
  assert.equal(fila.estado, 'pendiente');
  // §6: queda registro de QUIEN publico que.
  assert.equal(fila.disparada_por, 'marvin@ybe.com.py');
  assert.equal(fila.disparada_en, AHORA);
});

test('ultimaPublicacion trae la mas reciente, no la primera', async () => {
  const db = base();
  await crearPublicacion(ejecutor(db), { email: 'a@a', ahora: '2026-08-01T10:00:00Z' });
  await crearPublicacion(ejecutor(db), { email: 'b@b', ahora: '2026-08-05T10:00:00Z' });

  const u = await ultimaPublicacion(ejecutor(db));
  assert.equal(u!.disparada_por, 'b@b');
});

test('ultimaPublicacion devuelve null si no hubo ninguna', async () => {
  assert.equal(await ultimaPublicacion(ejecutor(base())), null);
});

test('hayPublicacionEnCurso detecta pendiente y corriendo', async () => {
  // Sin esto, cinco clicks nerviosos crean cinco filas y el admin muestra un estado
  // que no se corresponde con ningun run.
  //
  // El `ahora` va SIEMPRE explicito. Sin pasarlo, la funcion usa el reloj real y el
  // test compara una fecha fija contra "hoy": paso el dia que se escribio y fallo al
  // siguiente, cuando la publicacion quedo vencida por el paso de las horas.
  const db = base();
  assert.equal(await hayPublicacionEnCurso(ejecutor(db), AHORA), false);

  await crearPublicacion(ejecutor(db), { email: 'a@a', ahora: AHORA });
  assert.equal(await hayPublicacionEnCurso(ejecutor(db), AHORA), true);

  db.prepare(`UPDATE publicaciones SET estado = 'ok'`).run();
  assert.equal(await hayPublicacionEnCurso(ejecutor(db), AHORA), false);
});

test('una publicacion vieja y colgada NO bloquea para siempre', async () => {
  // Si la Action muere sin reportar, la fila queda en "corriendo" eternamente. Sin
  // vencimiento, el boton de publicar no vuelve nunca y no hay forma de salir sin
  // tocar la base.
  const db = base();
  await crearPublicacion(ejecutor(db), { email: 'a@a', ahora: '2026-08-05T10:00:00Z' });
  // Ocho horas despues: ningun build tarda eso.
  assert.equal(await hayPublicacionEnCurso(ejecutor(db), '2026-08-05T18:00:00Z'), false);
});

// --------------------------------------------------------------------------
// El cartel tambien caduca, no solo el bloqueo (§11.3)
// --------------------------------------------------------------------------

test('una publicacion en curso VENCIDA no dice mas "Publicando…"', () => {
  /**
   * EL BUG QUE ESTO CIERRA, visto dos veces en produccion el 2026-08-07 y el 08-10.
   *
   * `hayPublicacionEnCurso` ya vencia, asi que el BOTON volvia. Pero el CARTEL no
   * vencia: seguia diciendo «Publicando…» indefinidamente. El sitio ya estaba
   * publicado y el admin decia que estaba trabajando.
   *
   * Peor: el caso real fue una Action que fallo por falta de credenciales — y el paso
   * que reporta el fallo necesita las MISMAS credenciales, asi que no pudo escribir
   * que fallo. Cuando el camino de error depende del mismo secreto que el camino
   * feliz, el vencimiento del lado del lector es la unica red que queda.
   */
  const dosHorasDespues = '2026-08-05T16:00:00Z';
  const d = describirPublicacion(
    pub({ estado: 'corriendo', disparada_en: '2026-08-05T14:00:00Z', terminada_en: null }),
    dosHorasDespues
  );

  assert.notEqual(d.tono, 'en-curso');
  assert.ok(!/Publicando/i.test(d.titulo), `no deberia decir Publicando: ${d.titulo}`);
  assert.match(d.detalle, /no llegó|no llego|sin respuesta|volver a intentar/i);
});

test('vencida se lee como problema, no como exito', () => {
  // Pintarla de `ok` seria peor que el bug: diria que se publico algo que no se sabe.
  const d = describirPublicacion(
    pub({ estado: 'pendiente', disparada_en: '2026-08-05T14:00:00Z', terminada_en: null }),
    '2026-08-05T16:00:00Z'
  );
  assert.equal(d.tono, 'error');
});

test('dentro del plazo sigue diciendo "Publicando…"', () => {
  // Un build tarda minutos: el vencimiento no puede alarmar durante el trabajo normal.
  const d = describirPublicacion(
    pub({ estado: 'corriendo', disparada_en: '2026-08-05T14:00:00Z', terminada_en: null }),
    '2026-08-05T14:03:00Z'
  );
  assert.equal(d.tono, 'en-curso');
  assert.match(d.titulo, /Publicando/i);
});

test('el vencimiento del cartel y el del boton son el MISMO plazo', () => {
  /**
   * Si fueran dos numeros distintos habria una ventana donde el boton esta libre y el
   * cartel dice que hay algo en curso, o al reves. Se comparan por comportamiento
   * porque la constante no se exporta.
   */
  const arranque = '2026-08-05T14:00:00Z';
  const casiUnaHora = '2026-08-05T14:59:00Z';
  const pasadaLaHora = '2026-08-05T15:01:00Z';

  const antes = describirPublicacion(
    pub({ estado: 'corriendo', disparada_en: arranque, terminada_en: null }),
    casiUnaHora
  );
  const despues = describirPublicacion(
    pub({ estado: 'corriendo', disparada_en: arranque, terminada_en: null }),
    pasadaLaHora
  );

  assert.equal(antes.tono, 'en-curso', 'a los 59 minutos todavia esta en curso');
  assert.equal(despues.tono, 'error', 'pasada la hora ya no');
});
