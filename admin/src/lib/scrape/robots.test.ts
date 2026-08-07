import assert from 'node:assert/strict';
import { test } from 'node:test';

import { leerRobots, parsearRobots, permiteRuta } from './robots.ts';

const HOST = 'https://www.chenson.com.py';

test('sin robots.txt no hay exclusiones', () => {
  // Medido: hoy el sitio devuelve 404. El chequeo se hace igual, porque puede
  // aparecer manana y un scraper que no lo relee es un scraper que lo ignora.
  assert.deepEqual(parsearRobots(''), []);
  assert.equal(permiteRuta([], `${HOST}/producto/71163-cg85700`), true);
});

test('respeta un Disallow del grupo genérico', () => {
  const reglas = parsearRobots(['User-agent: *', 'Disallow: /producto/'].join('\n'));
  assert.equal(permiteRuta(reglas, `${HOST}/producto/71163-cg85700`), false);
  assert.equal(permiteRuta(reglas, `${HOST}/lanzamientos/?lz=2026-07-16`), true);
});

test('gana la regla más específica', () => {
  const reglas = parsearRobots(
    ['User-agent: *', 'Disallow: /producto/', 'Allow: /producto/71163-'].join('\n')
  );
  assert.equal(permiteRuta(reglas, `${HOST}/producto/71163-cg85700`), true);
  assert.equal(permiteRuta(reglas, `${HOST}/producto/99999-cg1`), false);
});

test('un grupo que nos nombra gana sobre el genérico', () => {
  // Si el sitio se toma el trabajo de nombrarnos, lo hizo a proposito.
  const reglas = parsearRobots(
    ['User-agent: *', 'Disallow: /', '', 'User-agent: YBECatalogo', 'Disallow: /carrito'].join('\n')
  );
  assert.equal(permiteRuta(reglas, `${HOST}/producto/71163-cg85700`), true);
  assert.equal(permiteRuta(reglas, `${HOST}/carrito`), false);
});

test('un Disallow vacío significa todo permitido', () => {
  const reglas = parsearRobots(['User-agent: *', 'Disallow:'].join('\n'));
  assert.equal(permiteRuta(reglas, `${HOST}/producto/1-cg1`), true);
});

test('los comentarios y los espacios no confunden al parser', () => {
  const reglas = parsearRobots(
    ['# el robots del sitio', 'User-agent: *   # todos', '  Disallow: /interno  '].join('\n')
  );
  assert.deepEqual(reglas, [{ permite: false, ruta: '/interno' }]);
});

test('varios User-agent seguidos comparten el bloque', () => {
  const reglas = parsearRobots(['User-agent: bot-a', 'User-agent: *', 'Disallow: /x'].join('\n'));
  assert.deepEqual(reglas, [{ permite: false, ruta: '/x' }]);
});

test('un 404 se lee como ausencia de reglas, no como error', async () => {
  const buscar = async () => new Response('no', { status: 404 });
  assert.deepEqual(await leerRobots({ buscar: buscar as unknown as typeof fetch }), {
    reglas: [],
    ausente: true,
  });
});

test('si la red falla no se bloquea el scrape', async () => {
  // El paso de 1 request por segundo ya protege al proveedor: caerse porque el
  // robots.txt no cargo seria castigar al usuario por algo que no es suyo.
  const buscar = async () => {
    throw new Error('sin red');
  };
  const r = await leerRobots({ buscar: buscar as unknown as typeof fetch });
  assert.equal(r.ausente, true);
});

test('un robots real se lee y se aplica', async () => {
  const buscar = async () => new Response('User-agent: *\nDisallow: /admin\n', { status: 200 });
  const r = await leerRobots({ buscar: buscar as unknown as typeof fetch });
  assert.equal(r.ausente, false);
  assert.equal(permiteRuta(r.reglas, `${HOST}/admin/x`), false);
  assert.equal(permiteRuta(r.reglas, `${HOST}/producto/1-cg1`), true);
});
