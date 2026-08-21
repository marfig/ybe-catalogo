import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { Ejecutar } from '../grilla.ts';
import {
  candidatoPorId,
  candidatosPorIds,
  contarAusentes,
  contarBarribles,
  desmarcarBaja,
  listarAusentes,
  marcar,
  proximosABarrer,
} from './cola.ts';
import { loteSqlite } from '../d1.ts';

/**
 * Contra el ESQUEMA REAL con `node:sqlite`, que es el mismo motor que D1. Un orden
 * de cola que deje productos sin revisar se ve acá y no dentro de seis meses.
 */
const MIGRACIONES = [
  '0001_esquema_inicial.sql',
  '0002_codigo_insensible_a_mayusculas.sql',
  '0003_aviso_cambio_en_origen.sql',
  '0004_papelera.sql',
  '0005_barrido_de_bajas.sql',
].map((n) => readFileSync(new URL(`../../../../db/migrations/${n}`, import.meta.url), 'utf8'));

const AYER = '2026-08-10T09:00:00Z';
const HOY = '2026-08-11T09:00:00Z';
const MANANA = '2026-08-12T09:00:00Z';

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

interface Semilla {
  codigo: string;
  estado?: string;
  proveedor?: string;
  revisado?: string | null;
  ausente?: string | null;
}

function sembrar(db: DatabaseSync, filas: Semilla[]): void {
  for (const f of filas) {
    const estado = f.estado ?? 'publicado';
    db.prepare(
      `INSERT INTO productos
         (codigo, proveedor, estado, slug, url_origen, revisado_en_origen, ausente_desde,
          creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      f.codigo,
      f.proveedor ?? 'chenson',
      estado,
      // El esquema exige slug en todo estado que no sea `importado`.
      estado === 'importado' ? null : f.codigo.toLowerCase(),
      `https://www.chenson.com.py/producto/1-${f.codigo.toLowerCase()}`,
      f.revisado ?? null,
      f.ausente ?? null,
      AYER,
      AYER
    );
  }
}

const codigos = (filas: { codigo: string }[]) => filas.map((f) => f.codigo);

test('primero lo que nunca se revisó', async () => {
  const db = base();
  sembrar(db, [
    { codigo: 'CG001', revisado: AYER },
    { codigo: 'CG002', revisado: null },
    { codigo: 'CG003', revisado: HOY },
  ]);

  const cola = await proximosABarrer(ejecutor(db), { limite: 10 });
  assert.equal(cola[0].codigo, 'CG002');
});

test('después, lo más viejo primero', async () => {
  const db = base();
  sembrar(db, [
    { codigo: 'CG001', revisado: HOY },
    { codigo: 'CG002', revisado: AYER },
    { codigo: 'CG003', revisado: MANANA },
  ]);

  assert.deepEqual(codigos(await proximosABarrer(ejecutor(db), { limite: 10 })), [
    'CG002',
    'CG001',
    'CG003',
  ]);
});

test('a igual antigüedad, los publicados van primero', async () => {
  /**
   * Una baja en un producto que está en la calle es un cliente pidiendo algo que no
   * existe. Una baja en uno «por aprobar» es curaduría que alguien se ahorra: no es
   * lo mismo y el orden lo tiene que decir.
   */
  const db = base();
  sembrar(db, [
    { codigo: 'CG001', estado: 'importado' },
    { codigo: 'CG002', estado: 'publicado' },
    { codigo: 'CG003', estado: 'aprobado' },
  ]);

  assert.equal((await proximosABarrer(ejecutor(db), { limite: 10 }))[0].codigo, 'CG002');
});

test('el desempate por publicado NO manda sobre la antigüedad', async () => {
  /**
   * LA TRAMPA QUE HACE INÚTIL EL BARRIDO. Si «publicado» ordenara antes que la fecha,
   * cada corrida volvería a revisar los mismos publicados —ya frescos— y el resto del
   * catálogo no llegaría nunca a su turno.
   */
  const db = base();
  sembrar(db, [
    { codigo: 'CG001', estado: 'publicado', revisado: HOY },
    { codigo: 'CG002', estado: 'importado', revisado: AYER },
  ]);

  assert.equal((await proximosABarrer(ejecutor(db), { limite: 10 }))[0].codigo, 'CG002');
});

test('no se le pregunta al proveedor por un producto cargado a mano', async () => {
  const db = base();
  sembrar(db, [
    { codigo: 'CG001', proveedor: 'manual' },
    { codigo: 'CG002', proveedor: 'chenson' },
  ]);

  assert.deepEqual(codigos(await proximosABarrer(ejecutor(db), { limite: 10 })), ['CG002']);
});

test('SÓLO se barre lo que salió del proveedor, y es una lista blanca', async () => {
  /**
   * EL CASO QUE OBLIGÓ A CAMBIAR LA REGLA. La condición era `proveedor <> 'manual'`, o sea
   * una lista NEGRA: cualquier origen nuevo entraba a la cola por olvido.
   *
   * Y apareció uno. Los 177 productos que la migración del catálogo viejo trae con
   * `proveedor = 'catalogo-viejo'` son exactamente los que el proveedor YA NO PUBLICA: con
   * la lista negra, el barrido les preguntaría todos los días, recibiría `ausente` siempre,
   * y quedarían 177 marcados de baja para siempre. Un aviso permanente que es siempre falso
   * enseña a ignorar el lugar donde después aparece el de verdad.
   *
   * Con lista blanca, el que se agrega mañana tampoco entra hasta que alguien lo decida.
   */
  const db = base();
  sembrar(db, [
    { codigo: 'CG001', proveedor: 'chenson' },
    { codigo: 'CG002', proveedor: 'manual' },
    { codigo: 'CG003', proveedor: 'catalogo-viejo' },
    { codigo: 'CG004', proveedor: 'lo-que-venga-manana' },
  ]);

  assert.deepEqual(codigos(await proximosABarrer(ejecutor(db), { limite: 10 })), ['CG001']);
});

test('la cola automatica y lo tildado NO tienen la misma regla, a proposito', async () => {
  /**
   * ESTE TEST AFIRMABA LO CONTRARIO Y ESTABA MAL. Decia que un producto del catalogo viejo
   * tampoco se podia barrer de a uno, «para que las dos puertas tengan la misma regla». La
   * simetria sonaba bien y el resultado era que tildar un producto y mandarlo a revisar
   * respondia «no hay nada que revisar» sobre algo que el proveedor conoce perfectamente.
   *
   * Son dos cosas distintas y ahora se lee asi:
   *
   *   la cola automatica  — un PRESUPUESTO que rota solo. Gasta un pedido por segundo, y
   *                         sumarle 174 productos que casi siempre van a volver `ausente`
   *                         llena el filtro de bajas con lo que ya se sabe.
   *   lo tildado          — una PREGUNTA de una persona sobre productos concretos. No hay
   *                         presupuesto que administrar, y quien decide es quien tildo.
   */
  const db = base();
  sembrar(db, [
    { codigo: 'CG700', proveedor: 'chenson' },
    { codigo: '8732209', proveedor: 'catalogo-viejo' },
    { codigo: 'AMANO', proveedor: 'manual' },
  ]);
  const ejecutar = ejecutor(db);

  // La rotacion automatica: solo lo que salio del proveedor.
  assert.deepEqual(codigos(await proximosABarrer(ejecutar, { limite: 10 })), ['CG700']);

  // Tildado: los tres, cada uno resoluble de a uno.
  const ids = await ejecutar<{ id: number; codigo: string }>('SELECT id, codigo FROM productos');
  for (const f of ids) {
    assert.equal((await candidatoPorId(ejecutar, f.id))?.codigo, f.codigo, f.codigo);
  }
});

test('la papelera no se barre', async () => {
  const db = base();
  sembrar(db, [
    { codigo: 'CG001', estado: 'eliminado' },
    { codigo: 'CG002', estado: 'publicado' },
  ]);

  assert.deepEqual(codigos(await proximosABarrer(ejecutor(db), { limite: 10 })), ['CG002']);
});

test('el límite corta la corrida', async () => {
  const db = base();
  sembrar(db, [{ codigo: 'CG001' }, { codigo: 'CG002' }, { codigo: 'CG003' }]);

  assert.equal((await proximosABarrer(ejecutor(db), { limite: 2 })).length, 2);
});

test('un candidato que dejó de ser barrible ya no se resuelve', async () => {
  /**
   * La página rinde la cola una vez y se puede quedar abierta horas. Para cuando llega
   * el pedido, ese producto puede haberse eliminado desde otra pestaña — y marcarlo
   * como dado de baja seria trabajar sobre algo que alguien ya decidió sacar.
   */
  const db = base();
  sembrar(db, [
    { codigo: 'CG001' },
    { codigo: 'CG002', estado: 'eliminado' },
    { codigo: 'CG003', proveedor: 'manual' },
  ]);
  const ejecutar = ejecutor(db);
  const ids = await ejecutar<{ id: number; codigo: string }>('SELECT id, codigo FROM productos');
  const idDe = (c: string) => ids.find((f) => f.codigo === c)!.id;

  /**
   * TILDAR ES UNA PREGUNTA EXPLICITA, y el codigo no la discute.
   *
   * Este camino NO filtra por origen ni por estado: si alguien marco un producto y lo mando
   * a revisar, quiere saber que dice el proveedor sobre ese producto. Todos se manejan por
   * su codigo y asi se buscan en el proveedor, incluidos los cargados a mano — que el
   * buscador lo encuentre o no es informacion util, no un motivo para no preguntar.
   *
   * Lo unico que sigue devolviendo `null` es un id que no existe.
   */
  assert.equal((await candidatoPorId(ejecutar, idDe('CG001')))?.codigo, 'CG001');
  assert.equal((await candidatoPorId(ejecutar, idDe('CG002')))?.codigo, 'CG002', 'papelera');
  assert.equal((await candidatoPorId(ejecutar, idDe('CG003')))?.codigo, 'CG003', 'manual');
  assert.equal(await candidatoPorId(ejecutar, 9999), null, 'no existe');
});

test('tildar un producto del catalogo viejo lo manda a revisar', async () => {
  /**
   * EL CASO QUE ROMPI Y ESTE TEST FIJA. Al construir la migracion, `BARRIBLES` paso de
   * lista negra a lista blanca —`proveedor = 'chenson'`— para que los 174 del catalogo
   * viejo no entraran a la cola automatica. Eso tambien los dejo afuera del camino manual,
   * asi que tildarlos devolvia «no hay nada que revisar» sobre productos que el proveedor
   * conoce perfectamente: sus codigos SON codigos del proveedor.
   *
   * Y preguntar sirve: el proveedor repone modelos, y `ausente_desde` vuelve a NULL cuando
   * uno reaparece (ver `presencia.ts`). Es la unica forma de enterarse.
   */
  const db = base();
  sembrar(db, [
    { codigo: '8732209', proveedor: 'catalogo-viejo' },
    { codigo: 'AMANO', proveedor: 'manual' },
    { codigo: 'CG700', proveedor: 'chenson' },
  ]);
  const ejecutar = ejecutor(db);
  const ids = await ejecutar<{ id: number }>('SELECT id FROM productos');

  const cola = await candidatosPorIds(
    ejecutar,
    ids.map((f) => f.id)
  );
  assert.equal(cola.length, 3, 'los tres tildados tienen que entrar');
});

test('una selección a mano se filtra y se ordena como la cola', async () => {
  const db = base();
  sembrar(db, [
    { codigo: 'CG001', revisado: HOY },
    { codigo: 'CG002', revisado: AYER },
    { codigo: 'CG003', proveedor: 'manual' },
  ]);
  const ejecutar = ejecutor(db);
  const ids = await ejecutar<{ id: number; codigo: string }>('SELECT id, codigo FROM productos');

  const cola = await candidatosPorIds(
    ejecutar,
    ids.map((f) => f.id)
  );

  /**
   * CG002 primero aunque se haya tildado despues: el orden lo pone la antiguedad, igual que
   * en la cola automatica. Y CG003 SI entra aunque sea de carga manual — lo tildaron.
   * Va ultimo porque nunca se reviso, y los nunca revisados van primero... no: `revisado`
   * en NULL ordena ANTES, asi que CG003 encabeza.
   */
  assert.deepEqual(codigos(cola), ['CG003', 'CG002', 'CG001']);
});

test('una selección vacía no consulta nada', async () => {
  assert.deepEqual(await candidatosPorIds(ejecutor(base()), []), []);
});

test('el total a barrer no cuenta lo que no se barre', async () => {
  const db = base();
  sembrar(db, [
    { codigo: 'CG001' },
    { codigo: 'CG002', estado: 'eliminado' },
    { codigo: 'CG003', proveedor: 'manual' },
    { codigo: 'CG004', estado: 'importado' },
  ]);

  assert.equal(await contarBarribles(ejecutor(db)), 2);
});

test('presente: se anota la revisión y se refresca la ficha del origen', async () => {
  const db = base();
  sembrar(db, [{ codigo: 'CG001', revisado: AYER }]);
  const ejecutar = ejecutor(db);
  const [{ id }] = await ejecutar<{ id: number }>('SELECT id FROM productos');

  await marcar(ejecutar, id, {
    presencia: 'presente',
    ahora: HOY,
    url: 'https://www.chenson.com.py/producto/999-cg001',
    codigo: 'CG001',
  });

  const [p] = await ejecutar<{ revisado_en_origen: string; ausente_desde: null; url_origen: string }>(
    'SELECT revisado_en_origen, ausente_desde, url_origen FROM productos'
  );
  assert.equal(p.revisado_en_origen, HOY);
  assert.equal(p.ausente_desde, null);
  // El proveedor le cambia el `idColor` cuando le mueve los colores: la URL guardada
  // queda vieja y nada lo notaría.
  assert.equal(p.url_origen, 'https://www.chenson.com.py/producto/999-cg001');
});

test('ausente: se anota desde cuándo', async () => {
  const db = base();
  sembrar(db, [{ codigo: 'CG001' }]);
  const ejecutar = ejecutor(db);
  const [{ id }] = await ejecutar<{ id: number }>('SELECT id FROM productos');

  await marcar(ejecutar, id, { presencia: 'ausente', ahora: HOY, url: null, codigo: 'CG001' });

  const [p] = await ejecutar<{ revisado_en_origen: string; ausente_desde: string }>(
    'SELECT revisado_en_origen, ausente_desde FROM productos'
  );
  assert.equal(p.revisado_en_origen, HOY);
  assert.equal(p.ausente_desde, HOY);
});

test('ausente de nuevo: la fecha es la PRIMERA vez, no la última', async () => {
  /**
   * Es un «desde». Pisarlo en cada corrida haría que un producto dado de baja hace
   * tres meses dijera siempre «hace un rato», que es justo el dato con el que alguien
   * decide si ya es hora de sacarlo.
   */
  const db = base();
  sembrar(db, [{ codigo: 'CG001', ausente: AYER }]);
  const ejecutar = ejecutor(db);
  const [{ id }] = await ejecutar<{ id: number }>('SELECT id FROM productos');

  await marcar(ejecutar, id, { presencia: 'ausente', ahora: HOY, url: null, codigo: 'CG001' });

  const [p] = await ejecutar<{ revisado_en_origen: string; ausente_desde: string }>(
    'SELECT revisado_en_origen, ausente_desde FROM productos'
  );
  assert.equal(p.ausente_desde, AYER);
  assert.equal(p.revisado_en_origen, HOY);
});

test('un producto que vuelve a aparecer deja de estar dado de baja', async () => {
  // Pasa: el proveedor repone un modelo. La marca no puede ser de una sola dirección.
  const db = base();
  sembrar(db, [{ codigo: 'CG001', ausente: AYER }]);
  const ejecutar = ejecutor(db);
  const [{ id }] = await ejecutar<{ id: number }>('SELECT id FROM productos');

  await marcar(ejecutar, id, { presencia: 'presente', ahora: HOY, url: null, codigo: 'CG001' });

  const [p] = await ejecutar<{ ausente_desde: null }>('SELECT ausente_desde FROM productos');
  assert.equal(p.ausente_desde, null);
});

test('INDETERMINADO no toca nada: ni marca, ni cuenta como revisado', async () => {
  /**
   * No saber no es una respuesta. Anotarlo como revisado lo mandaría al fondo de la
   * cola y el producto se quedaría sin mirar de verdad hasta la vuelta entera del
   * catálogo, escondiendo que el proveedor estuvo caído.
   */
  const db = base();
  sembrar(db, [{ codigo: 'CG001', revisado: AYER }]);
  const ejecutar = ejecutor(db);
  const [{ id }] = await ejecutar<{ id: number }>('SELECT id FROM productos');

  await marcar(ejecutar, id, {
    presencia: 'indeterminado',
    ahora: HOY,
    url: null,
    codigo: 'CG001',
  });

  const [p] = await ejecutar<{ revisado_en_origen: string; ausente_desde: null }>(
    'SELECT revisado_en_origen, ausente_desde FROM productos'
  );
  assert.equal(p.revisado_en_origen, AYER);
  assert.equal(p.ausente_desde, null);
});

test('el conteo de bajas ignora la papelera', async () => {
  /**
   * Un producto ya eliminado que además no está en el proveedor no es trabajo
   * pendiente: el aviso del Inicio tiene que contar sólo lo accionable.
   */
  const db = base();
  sembrar(db, [
    { codigo: 'CG001', ausente: AYER },
    { codigo: 'CG002', ausente: AYER, estado: 'eliminado' },
    { codigo: 'CG003' },
  ]);

  assert.equal(await contarAusentes(ejecutor(db)), 1);
});

test('las bajas se listan de la más vieja a la más nueva', async () => {
  // Lo que lleva más tiempo dado de baja es lo que más urge sacar del catálogo.
  const db = base();
  sembrar(db, [
    { codigo: 'CG001', ausente: HOY },
    { codigo: 'CG002', ausente: AYER },
    { codigo: 'CG003' },
  ]);

  assert.deepEqual(codigos(await listarAusentes(ejecutor(db))), ['CG002', 'CG001']);
});

// --------------------------------------------------------------------------
// desmarcarBaja
// --------------------------------------------------------------------------

/**
 * La salida MANUAL de la marca de baja.
 *
 * Hasta que existió, `ausente_desde` sólo la borraba `marcar()` al encontrar el
 * producto presente en el proveedor. Si el proveedor de verdad no lo tiene —una
 * corrida de prueba, un código que su buscador no matchea— no había forma de sacarlo
 * del listado desde el admin: hubo que correr un UPDATE a mano sobre D1 de producción.
 * Eso es lo que esta función deja de pedir.
 */
const lote = (db: DatabaseSync) => loteSqlite(db);
const opciones = (db: DatabaseSync) => ({ lote: lote(db), ahora: HOY });

test('desmarcarBaja limpia la marca y lo reporta como hecho', async () => {
  const db = base();
  sembrar(db, [{ codigo: 'CG001', ausente: AYER }]);
  const [{ id }] = await ejecutor(db)<{ id: number }>('SELECT id FROM productos');

  const [r] = await desmarcarBaja(ejecutor(db), [id], opciones(db));

  assert.equal(r.desenlace, 'hecho');
  assert.equal(r.codigo, 'CG001');
  const [fila] = await ejecutor(db)<{ ausente_desde: string | null }>(
    'SELECT ausente_desde FROM productos'
  );
  assert.equal(fila.ausente_desde, null);
});

test('desmarcarBaja NO toca actualizado_en', async () => {
  /*
   * Mismo criterio que `marcar()`: `actualizado_en` alimenta el aviso de «hay cambios
   * sin publicar» del Inicio (§11.3), y esta marca no cambia NADA de lo que el sitio
   * muestra. Moverlo pediría publicar por una corrección que no publicó nada.
   */
  const db = base();
  sembrar(db, [{ codigo: 'CG001', ausente: AYER }]);
  const [{ id }] = await ejecutor(db)<{ id: number }>('SELECT id FROM productos');

  await desmarcarBaja(ejecutor(db), [id], opciones(db));

  const [fila] = await ejecutor(db)<{ actualizado_en: string }>(
    'SELECT actualizado_en FROM productos'
  );
  assert.equal(fila.actualizado_en, AYER);
});

test('desmarcarBaja sobre uno que no estaba marcado es omitido, no hecho', async () => {
  // No hay nada que corregir: es el desenlace `omitido` de §10.3, no un fallo.
  const db = base();
  sembrar(db, [{ codigo: 'CG001', ausente: null }]);
  const [{ id }] = await ejecutor(db)<{ id: number }>('SELECT id FROM productos');

  const [r] = await desmarcarBaja(ejecutor(db), [id], opciones(db));

  assert.equal(r.desenlace, 'omitido');
  assert.match(r.motivo ?? '', /baja/i);
});

test('desmarcarBaja NO devuelve la revisión: revisado_en_origen queda', async () => {
  // Es el registro honesto de que se miró. Borrarlo mandaría el producto al frente de
  // la cola del barrido, que es trabajo inventado.
  const db = base();
  sembrar(db, [{ codigo: 'CG001', revisado: AYER, ausente: AYER }]);
  const [{ id }] = await ejecutor(db)<{ id: number }>('SELECT id FROM productos');

  await desmarcarBaja(ejecutor(db), [id], opciones(db));

  const [fila] = await ejecutor(db)<{ revisado_en_origen: string }>(
    'SELECT revisado_en_origen FROM productos'
  );
  assert.equal(fila.revisado_en_origen, AYER);
});

test('desmarcarBaja: un id que no existe es fallo, y no arrastra a los demás', async () => {
  const db = base();
  sembrar(db, [{ codigo: 'CG001', ausente: AYER }]);
  const [{ id }] = await ejecutor(db)<{ id: number }>('SELECT id FROM productos');

  const rs = await desmarcarBaja(ejecutor(db), [id, 9999], opciones(db));

  assert.equal(rs.find((r) => r.id === id)?.desenlace, 'hecho');
  assert.equal(rs.find((r) => r.id === 9999)?.desenlace, 'fallo');
});

test('desmarcarBaja sin ids no escribe ni lanza', async () => {
  const db = base();
  assert.deepEqual(await desmarcarBaja(ejecutor(db), [], opciones(db)), []);
});
