import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import type { Ejecutar } from './grilla.ts';
import type { ProductoExistente } from './codigo.ts';
import { fotosPorColor, type FichaExtraida } from './scrape/extractor.ts';
import { iniciarCorrida } from './scrape/corrida.ts';
import type { ResultadoPresencia } from './scrape/presencia.ts';
import {
  clasificar,
  fichaParaRegistro,
  normalizarLista,
  productosDeCorrida,
  resolverCodigo,
} from './reposicion.ts';

/**
 * Tests de la reposición (código por código, contra el proveedor y contra la papelera).
 *
 * LA TRAMPA QUE ESTE ARCHIVO EXISTE PARA CERRAR: `registrarFicha` hace `UPDATE` por
 * código sin mirar `estado`, así que llamarlo solo sobre un producto en la papelera lo
 * actualiza y lo deja `eliminado` para siempre — nunca lo saca de ahí. La prueba
 * «restaura Y resincroniza, las dos cosas» es la que demuestra que `resolverCodigo`
 * hace las DOS llamadas, no una.
 *
 * La carpeta entera de migraciones, en orden, igual que `papelera.test.ts`.
 */
const CARPETA = new URL('../../../db/migrations/', import.meta.url);
const MIGRACIONES = readdirSync(CARPETA)
  .filter((n) => n.endsWith('.sql'))
  .sort()
  .map((n) => readFileSync(new URL(n, CARPETA), 'utf8'));

const AHORA = '2026-09-11T15:00:00Z';

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

/**
 * `productos.scrape_id` referencia `scrapes(id)` de verdad (migración 0001), así que
 * los tests necesitan una corrida real y no un número inventado.
 */
const abrirCorrida = (db: DatabaseSync) =>
  iniciarCorrida(ejecutor(db), { url: 'reposición', paginas: 1, ahora: AHORA, tipo: 'reposicion' });

function producto(
  db: DatabaseSync,
  {
    codigo,
    estado = 'importado',
    slug = null,
    scrapeId = null,
  }: { codigo: string; estado?: string; slug?: string | null; scrapeId?: number | null }
): number {
  const { id } = db
    .prepare(
      `INSERT INTO productos (codigo, proveedor, estado, slug, scrape_id, creado_en, actualizado_en)
       VALUES (?, 'chenson', ?, ?, ?, ?, ?) RETURNING id`
    )
    .get(codigo, estado, slug, scrapeId, AHORA, AHORA) as { id: number };
  return id;
}

const filaDe = (db: DatabaseSync, id: number) =>
  db
    .prepare(`SELECT estado, slug, scrape_id, actualizado_en FROM productos WHERE id = ?`)
    .get(id) as { estado: string; slug: string | null; scrape_id: number | null; actualizado_en: string };

const cuantos = (db: DatabaseSync, tabla: string) =>
  (db.prepare(`SELECT COUNT(*) n FROM ${tabla}`).get() as { n: number }).n;

/** Una presencia armada a mano, sin pegarle al proveedor. */
function presencia(
  tipo: ResultadoPresencia['presencia'],
  { url = null, motivo = '' }: { url?: string | null; motivo?: string } = {}
): ResultadoPresencia {
  return { codigo: 'CG1', presencia: tipo, motivo, url };
}

/** Una ficha armada a mano: lo mínimo que `fichaParaRegistro` necesita. */
function ficha(extra: Partial<FichaExtraida> = {}): FichaExtraida {
  return {
    codigo: 'CG1',
    url: 'https://www.chenson.com.py/producto/1-cg1',
    colorOrigen: '(3) NEGRO',
    fotos: ['https://www.chenson.com.py/img/a.jpg'],
    hermanos: [],
    medidas: null,
    ...extra,
  };
}

// --------------------------------------------------------------------------
// normalizarLista — pura
// --------------------------------------------------------------------------

test('normalizarLista: recorta y pone en mayúsculas cada código', () => {
  const r = normalizarLista(['  cg1  ', 'Cg2']);
  assert.deepEqual(r.codigos, ['CG1', 'CG2']);
  assert.deepEqual(r.invalidos, []);
});

test('normalizarLista: repite el código en distinta forma y no lo duplica', () => {
  const r = normalizarLista(['cg1', 'CG1', ' Cg1 ']);
  assert.deepEqual(r.codigos, ['CG1']);
});

test('normalizarLista: un código inválido es su propio resultado, no revienta la lista', () => {
  const r = normalizarLista(['CG1', 'CG 855', 'CG2']);
  assert.deepEqual(r.codigos, ['CG1', 'CG2']);
  assert.equal(r.invalidos.length, 1);
  assert.equal(r.invalidos[0].original, 'CG 855');
  assert.match(r.invalidos[0].motivo, /espacio/i);
});

test('normalizarLista: una lista vacía es dos listas vacías', () => {
  assert.deepEqual(normalizarLista([]), { codigos: [], invalidos: [] });
});

// --------------------------------------------------------------------------
// clasificar — pura, decide qué hacer con cada código
// --------------------------------------------------------------------------

const PRODUCTO_ELIMINADO: ProductoExistente = {
  id: 1,
  codigo: 'CG1',
  nombre: null,
  slug: 'cg1',
  estado: 'eliminado',
};

const PRODUCTO_PUBLICADO: ProductoExistente = { ...PRODUCTO_ELIMINADO, estado: 'publicado' };
const PRODUCTO_APROBADO: ProductoExistente = { ...PRODUCTO_ELIMINADO, estado: 'aprobado' };

test('clasificar: no existe y el proveedor no lo tiene → no existe en ningún lado', () => {
  assert.deepEqual(clasificar(null, presencia('ausente')), { accion: 'no-existe' });
});

test('clasificar: no existe y el proveedor lo tiene → alta', () => {
  const c = clasificar(null, presencia('presente', { url: 'https://u/ficha' }));
  assert.deepEqual(c, { accion: 'alta', url: 'https://u/ficha' });
});

test('clasificar: en la papelera y el proveedor ya no lo tiene → se queda en la papelera', () => {
  const c = clasificar(PRODUCTO_ELIMINADO, presencia('ausente'));
  assert.deepEqual(c, { accion: 'sigue-en-papelera', producto: PRODUCTO_ELIMINADO });
});

test('clasificar: en la papelera y el proveedor lo tiene → restaurar', () => {
  const c = clasificar(PRODUCTO_ELIMINADO, presencia('presente', { url: 'https://u/ficha' }));
  assert.deepEqual(c, { accion: 'restaurar', producto: PRODUCTO_ELIMINADO, url: 'https://u/ficha' });
});

test('clasificar: ya activo (publicado) y el proveedor lo tiene → resincronizar', () => {
  const c = clasificar(PRODUCTO_PUBLICADO, presencia('presente', { url: 'https://u/ficha' }));
  assert.deepEqual(c, { accion: 'resincronizar', producto: PRODUCTO_PUBLICADO, url: 'https://u/ficha' });
});

test('clasificar: ya activo (aprobado, no publicado) y el proveedor lo tiene → resincronizar también', () => {
  const c = clasificar(PRODUCTO_APROBADO, presencia('presente', { url: 'https://u/ficha' }));
  assert.equal(c.accion, 'resincronizar');
});

test('clasificar: indeterminado NUNCA se trata como ausencia, importe el estado que importe', () => {
  assert.deepEqual(clasificar(null, presencia('indeterminado')), { accion: 'indeterminado' });
  assert.deepEqual(clasificar(PRODUCTO_ELIMINADO, presencia('indeterminado')), { accion: 'indeterminado' });
  assert.deepEqual(clasificar(PRODUCTO_PUBLICADO, presencia('indeterminado')), { accion: 'indeterminado' });
});

test('clasificar: "presente" sin ficha es un contrato roto y se avisa, no se ignora', () => {
  assert.throws(() => clasificar(null, presencia('presente', { url: null })), /presente/i);
});

// --------------------------------------------------------------------------
// fichaParaRegistro — pura, la ficha del proveedor lista para registrarFicha()
// --------------------------------------------------------------------------

test('fichaParaRegistro: arma el color propio primero, sin categoría de origen', () => {
  const f = fichaParaRegistro(ficha());
  assert.equal(f.codigo, 'CG1');
  assert.equal(f.urlOrigen, 'https://www.chenson.com.py/producto/1-cg1');
  assert.equal(f.categoriaOrigen, null, 'el origen no expone categoría por este camino');
  assert.equal(f.colores.length, 1);
  assert.equal(f.colores[0].colorOrigen, '(3) NEGRO');
  assert.equal(f.colores[0].cantidadDeFotos, 1);
});

test('fichaParaRegistro: los hermanos entran después, con su propia cuenta de fotos', () => {
  const f = fichaParaRegistro(
    ficha({
      hermanos: [{ url: 'https://u/h1', colorOrigen: '(T) MARRON', foto: 'https://u/h1.jpg' }],
    })
  );
  assert.equal(f.colores.length, 2);
  assert.equal(f.colores[1].colorOrigen, '(T) MARRON');
  assert.equal(f.colores[1].cantidadDeFotos, 1);
});

test('fichaParaRegistro: las medidas viajan tal cual', () => {
  const f = fichaParaRegistro(ficha({ medidas: 'Medidas: 10 x 20 x 5' }));
  assert.equal(f.medidas, 'Medidas: 10 x 20 x 5');
});

// --------------------------------------------------------------------------
// productosDeCorrida — el worklist sale de una consulta por scrape_id
// --------------------------------------------------------------------------

test('productosDeCorrida: sólo los productos de ESTA corrida', async () => {
  const db = base();
  const id1 = await abrirCorrida(db);
  const id2 = await abrirCorrida(db);
  producto(db, { codigo: 'CG1', scrapeId: id1 });
  producto(db, { codigo: 'CG2', scrapeId: id2 });

  const r = await productosDeCorrida(ejecutor(db), id1);
  assert.deepEqual(r.map((p) => p.codigo), ['CG1']);
});

test('productosDeCorrida: trae el estado de cada fila, tal cual está en la base', async () => {
  // Ya NO alcanza para separar un alta de una restauración —las dos quedan en
  // `importado` desde que `restaurar()` cambió (`papelera.ts`)— pero sigue siendo un
  // dato útil: es lo que distingue el resincronizado de los otros dos.
  const db = base();
  const id = await abrirCorrida(db);
  producto(db, { codigo: 'CG1', estado: 'importado', scrapeId: id });
  producto(db, { codigo: 'CG2', estado: 'publicado', slug: 'cg2', scrapeId: id });

  const r = await productosDeCorrida(ejecutor(db), id);
  assert.deepEqual(
    r.map((p) => [p.codigo, p.estado]),
    [
      ['CG1', 'importado'],
      ['CG2', 'publicado'],
    ]
  );
});

// --------------------------------------------------------------------------
// resolverCodigo — el orquestador de un código
// --------------------------------------------------------------------------

/** Colaboradores fantasma: nunca tocan la red. */
function colaboradores({
  presenciaDevuelta,
  fichaDevuelta = ficha(),
  extraerFallaCon,
}: {
  presenciaDevuelta: ResultadoPresencia;
  fichaDevuelta?: FichaExtraida;
  extraerFallaCon?: Error;
}) {
  return {
    consultarPresencia: async () => presenciaDevuelta,
    // Sin esto, cada test que llega a `extraerFicha` pagaría la cortesía real de un
    // segundo (ver más abajo) y la corrida entera se haría lenta de verdad.
    cortesia: async () => {},
    extraerFicha: async () => {
      if (extraerFallaCon) throw extraerFallaCon;
      return fichaDevuelta;
    },
  };
}

test('resolverCodigo: un código inválido es su propio resultado y no llega a preguntarle a nadie', async () => {
  const db = base();
  const scrapeId = await abrirCorrida(db);
  let sePreguntoAlProveedor = false;

  const r = await resolverCodigo(
    ejecutor(db),
    'CG 855',
    { scrapeId, ahora: AHORA },
    {
      consultarPresencia: async () => {
        sePreguntoAlProveedor = true;
        return presencia('ausente');
      },
    }
  );

  assert.equal(r.desenlace, 'invalido');
  assert.equal(sePreguntoAlProveedor, false);
});

test('resolverCodigo: no existe en el catálogo ni en el proveedor → probable error de tipeo', async () => {
  const db = base();
  const scrapeId = await abrirCorrida(db);
  const r = await resolverCodigo(
    ejecutor(db),
    'CG1',
    { scrapeId, ahora: AHORA },
    colaboradores({ presenciaDevuelta: presencia('ausente') })
  );

  assert.equal(r.desenlace, 'no-existe');
  assert.equal(cuantos(db, 'productos'), 0);
});

test('resolverCodigo: no existe y el proveedor lo tiene → entra como importado', async () => {
  const db = base();
  const scrapeId = await abrirCorrida(db);
  const r = await resolverCodigo(
    ejecutor(db),
    'cg1',
    { scrapeId, ahora: AHORA },
    colaboradores({ presenciaDevuelta: presencia('presente', { url: 'https://u/ficha' }) })
  );

  assert.equal(r.desenlace, 'creado');
  assert.ok(r.productoId);
  const fila = filaDe(db, r.productoId!);
  assert.equal(fila.estado, 'importado');
  assert.equal(fila.scrape_id, scrapeId);
});

test('resolverCodigo: un alta trae las fotos por color, para que el cliente las suba', async () => {
  /**
   * `/api/reposicion/codigo` no baja ni sube ninguna foto —eso lo hace la pestaña,
   * igual que en la importación (§8.1)— pero necesita saber CUÁLES pedir. `colores`
   * es exactamente lo mismo que ya devuelve `/api/scrape/ficha`, calculado con el
   * mismo `fotosPorColor` sobre la misma ficha.
   */
  const db = base();
  const scrapeId = await abrirCorrida(db);
  const fichaConHermano = ficha({
    fotos: ['https://u/negro-1.jpg', 'https://u/negro-2.jpg'],
    hermanos: [{ url: 'https://u/h1', colorOrigen: '(T) MARRON', foto: 'https://u/marron.jpg' }],
  });

  const r = await resolverCodigo(
    ejecutor(db),
    'CG1',
    { scrapeId, ahora: AHORA },
    colaboradores({
      presenciaDevuelta: presencia('presente', { url: 'https://u/ficha' }),
      fichaDevuelta: fichaConHermano,
    })
  );

  assert.equal(r.desenlace, 'creado');
  assert.deepEqual(r.colores, fotosPorColor(fichaConHermano));
  assert.ok(r.colores!.some((c) => c.sku === 'CG1-3' && c.fotos.length === 2));
  assert.ok(r.colores!.some((c) => c.sku === 'CG1-T' && c.fotos.length === 1));
});

test('resolverCodigo: un desenlace que no bajó ninguna ficha no trae colores', async () => {
  const db = base();
  const scrapeId = await abrirCorrida(db);

  const noExiste = await resolverCodigo(
    ejecutor(db),
    'CG1',
    { scrapeId, ahora: AHORA },
    colaboradores({ presenciaDevuelta: presencia('ausente') })
  );
  assert.equal(noExiste.colores, undefined);

  const indeterminado = await resolverCodigo(
    ejecutor(db),
    'CG2',
    { scrapeId, ahora: AHORA },
    colaboradores({ presenciaDevuelta: presencia('indeterminado', { motivo: 'HTTP 503' }) })
  );
  assert.equal(indeterminado.colores, undefined);
});

test('resolverCodigo: en la papelera y el proveedor ya no lo tiene → se queda ahí, no se restaura', async () => {
  const db = base();
  const scrapeId = await abrirCorrida(db);
  const id = producto(db, { codigo: 'CG1', estado: 'eliminado', slug: 'cg1' });

  const r = await resolverCodigo(
    ejecutor(db),
    'CG1',
    { scrapeId, ahora: AHORA },
    colaboradores({ presenciaDevuelta: presencia('ausente') })
  );

  assert.equal(r.desenlace, 'sigue-en-papelera');
  assert.equal(filaDe(db, id).estado, 'eliminado');
});

test('resolverCodigo: LA TRAMPA — en papelera y presente restaura Y resincroniza, las dos cosas', async () => {
  /**
   * Si `resolverCodigo` sólo llamara a `registrarFicha` (el camino corto, y el bug que
   * este archivo existe para impedir), el UPDATE de `registrarFicha` no toca `estado`
   * y el producto quedaría `eliminado` para siempre aunque el proveedor lo siga
   * publicando. Este test falla si alguna vez se "optimiza" sacando el `restaurar()`.
   */
  const db = base();
  const scrapeId = await abrirCorrida(db);
  const id = producto(db, { codigo: 'CG1', estado: 'eliminado', slug: 'cg1' });

  const r = await resolverCodigo(
    ejecutor(db),
    'CG1',
    { scrapeId, ahora: AHORA },
    colaboradores({
      presenciaDevuelta: presencia('presente', { url: 'https://u/ficha' }),
      fichaDevuelta: ficha({ medidas: 'Medidas: 1 x 2 x 3' }),
    })
  );

  assert.equal(r.desenlace, 'restaurado');
  const fila = filaDe(db, id);
  // `importado` y no `publicado`: sale de la papelera pero por «Por aprobar», para
  // que alguien pueda revisar precio y demás datos antes de que se vuelva a ver.
  assert.equal(fila.estado, 'importado', 'restaurar() corrió: salió de la papelera, por aprobar');
  assert.equal(fila.slug, 'cg1', 'la URL de siempre, restaurar() no la toca');
  assert.equal(fila.scrape_id, scrapeId, 'registrarFicha() también corrió');
  assert.equal(fila.actualizado_en, AHORA, 'lo que alimenta cambiosSinPublicar()');
  // Un producto que vuelve de la papelera puede traer un color que no tenía: también
  // necesita sus fotos, no sólo las del que ya estaba.
  assert.ok(r.colores && r.colores.length > 0, 'también trae las fotos por color');
});

test('resolverCodigo: ya activo y presente → resincroniza sin cambiar el estado', async () => {
  const db = base();
  const scrapeId = await abrirCorrida(db);
  const id = producto(db, { codigo: 'CG1', estado: 'aprobado', slug: 'cg1' });

  const r = await resolverCodigo(
    ejecutor(db),
    'CG1',
    { scrapeId, ahora: AHORA },
    colaboradores({ presenciaDevuelta: presencia('presente', { url: 'https://u/ficha' }) })
  );

  assert.equal(r.desenlace, 'resincronizado');
  const fila = filaDe(db, id);
  assert.equal(fila.estado, 'aprobado', 'el estado no lo decide el scrape');
  assert.equal(fila.scrape_id, scrapeId);
  assert.ok(r.colores && r.colores.length > 0, 'un color nuevo sobre uno ya activo también trae fotos');
});

test('resolverCodigo: indeterminado no escribe nada y dice que hay que reintentar', async () => {
  const db = base();
  const scrapeId = await abrirCorrida(db);
  const id = producto(db, { codigo: 'CG1', estado: 'publicado', slug: 'cg1' });

  const r = await resolverCodigo(
    ejecutor(db),
    'CG1',
    { scrapeId, ahora: AHORA },
    colaboradores({ presenciaDevuelta: presencia('indeterminado', { motivo: 'HTTP 503' }) })
  );

  assert.equal(r.desenlace, 'indeterminado');
  assert.equal(r.motivo, 'HTTP 503');
  const fila = filaDe(db, id);
  assert.equal(fila.estado, 'publicado');
  assert.equal(fila.scrape_id, null, 'no se tocó nada: no se supo nada');
});

test('resolverCodigo: si extraerFicha falla en un alta, no queda un producto a medias', async () => {
  const db = base();
  const scrapeId = await abrirCorrida(db);
  const r = await resolverCodigo(
    ejecutor(db),
    'CG1',
    { scrapeId, ahora: AHORA },
    colaboradores({
      presenciaDevuelta: presencia('presente', { url: 'https://u/ficha' }),
      extraerFallaCon: new Error('HTTP 502 al pedir la ficha.'),
    })
  );

  assert.equal(r.desenlace, 'error');
  assert.match(r.motivo, /502/);
  assert.equal(r.url, 'https://u/ficha');
  assert.equal(cuantos(db, 'productos'), 0, 'no se creó nada a medias');
});

test('resolverCodigo: si extraerFicha falla DESPUÉS de restaurar, el restaurar queda hecho', async () => {
  /**
   * Autocurativo: la próxima vez que se reintente este código, el producto ya no está
   * en la papelera, así que `clasificar` lo manda por "resincronizar" y no intenta
   * restaurar de nuevo. Ver el comentario de `resolverCodigo`.
   */
  const db = base();
  const scrapeId = await abrirCorrida(db);
  const id = producto(db, { codigo: 'CG1', estado: 'eliminado', slug: 'cg1' });

  const r = await resolverCodigo(
    ejecutor(db),
    'CG1',
    { scrapeId, ahora: AHORA },
    colaboradores({
      presenciaDevuelta: presencia('presente', { url: 'https://u/ficha' }),
      extraerFallaCon: new Error('HTTP 502 al pedir la ficha.'),
    })
  );

  assert.equal(r.desenlace, 'error');
  assert.equal(filaDe(db, id).estado, 'importado', 'restaurar() ya había corrido, por aprobar');
});

// --------------------------------------------------------------------------
// La cortesía ENTRE las dos llamadas al proveedor de un mismo código
// --------------------------------------------------------------------------
//
// `/api/reposicion/codigo` es UN pedido de la pestaña, pero puede terminar
// haciéndole DOS pedidos al proveedor: la búsqueda de presencia y, si corresponde,
// la ficha. La cortesía del cliente (§7.4) espacía un `/api/reposicion/codigo` del
// siguiente — no ve lo que pasa DENTRO de uno solo. Sin esta espera, un código que
// termina en alta/restaurar/resincronizar le cuesta al proveedor dos pedidos en el
// mismo instante.

test('resolverCodigo: espera entre consultarPresencia y extraerFicha, no las dispara juntas', async () => {
  const db = base();
  const scrapeId = await abrirCorrida(db);
  const orden: string[] = [];

  await resolverCodigo(
    ejecutor(db),
    'CG1',
    { scrapeId, ahora: AHORA },
    {
      consultarPresencia: async () => {
        orden.push('presencia');
        return presencia('presente', { url: 'https://u/ficha' });
      },
      cortesia: async () => {
        orden.push('cortesia');
      },
      extraerFicha: async () => {
        orden.push('ficha');
        return ficha();
      },
    }
  );

  assert.deepEqual(orden, ['presencia', 'cortesia', 'ficha']);
});

test('resolverCodigo: ausente no llega a bajar ninguna ficha y no paga la espera', async () => {
  const db = base();
  const scrapeId = await abrirCorrida(db);
  let esperas = 0;

  await resolverCodigo(
    ejecutor(db),
    'CG1',
    { scrapeId, ahora: AHORA },
    {
      consultarPresencia: async () => presencia('ausente'),
      cortesia: async () => {
        esperas += 1;
      },
    }
  );

  assert.equal(esperas, 0);
});

test('resolverCodigo: indeterminado tampoco paga la espera: nunca llegó a la ficha', async () => {
  const db = base();
  const scrapeId = await abrirCorrida(db);
  let esperas = 0;

  await resolverCodigo(
    ejecutor(db),
    'CG1',
    { scrapeId, ahora: AHORA },
    {
      consultarPresencia: async () => presencia('indeterminado', { motivo: 'HTTP 503' }),
      cortesia: async () => {
        esperas += 1;
      },
    }
  );

  assert.equal(esperas, 0);
});

test('resolverCodigo: un código inválido no llega ni a preguntar, mucho menos a esperar', async () => {
  const db = base();
  const scrapeId = await abrirCorrida(db);
  let esperas = 0;

  await resolverCodigo(
    ejecutor(db),
    'CG 855',
    { scrapeId, ahora: AHORA },
    {
      cortesia: async () => {
        esperas += 1;
      },
    }
  );

  assert.equal(esperas, 0);
});
