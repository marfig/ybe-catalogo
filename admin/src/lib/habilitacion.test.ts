import { test } from 'node:test';
import assert from 'node:assert/strict';

import { esCampoDeFila, esRequisito, habilitacionDe } from './habilitacion.ts';

/** Estado base: sin tocar nada, nada tildado, nada completo. */
const limpio = { sucio: false, seleccionados: 0, completos: 0 };
const con = (cambios: Partial<typeof limpio>) => ({ ...limpio, ...cambios });

// --------------------------------------------------------------------------
// esRequisito: la puerta entre el DOM y la decision
// --------------------------------------------------------------------------

test('esRequisito acepta TODOS los requisitos que existen', () => {
  /**
   * ESTE TEST EXISTE POR UN BUG REAL.
   *
   * `grilla-cliente.ts` filtraba los `data-requiere` con un `r === 'seleccion' ||
   * r === 'guardado'` escrito a mano. Al agregar `cambios` y `completos`, esa lista quedo
   * vieja y los dos botones que solo pedian los requisitos nuevos —«Guardar cambios» y
   * «Aprobar los completos»— quedaron habilitados SIEMPRE. Sin error, sin test rojo.
   *
   * La lista de abajo es la que hay que actualizar al agregar un requisito, y el test
   * falla si `esRequisito` no lo reconoce. No es una duplicacion: es el candado.
   */
  for (const r of ['seleccion', 'guardado', 'cambios', 'completos']) {
    assert.equal(esRequisito(r), true, r);
  }
});

test('esRequisito descarta lo desconocido en vez de reventar', () => {
  // Viene de un atributo del DOM: un `data-requiere` mal tipeado no puede dejar la
  // pantalla inservible.
  for (const r of ['', 'selección', 'guardar', 'toString', 'constructor', '__proto__']) {
    assert.equal(esRequisito(r), false, r);
  }
});

// --------------------------------------------------------------------------
// Sin requisitos
// --------------------------------------------------------------------------

test('un boton sin requisitos esta siempre habilitado', () => {
  assert.deepEqual(habilitacionDe([], limpio), { habilitado: true, motivos: [] });
  assert.equal(habilitacionDe([], con({ sucio: true })).habilitado, true);
});

// --------------------------------------------------------------------------
// seleccion
// --------------------------------------------------------------------------

test('seleccion: bloquea con cero tildados y habilita con uno', () => {
  const sin = habilitacionDe(['seleccion'], con({ sucio: false, seleccionados: 0 }));
  assert.equal(sin.habilitado, false);
  assert.match(sin.motivos[0], /tildado/i);

  assert.equal(
    habilitacionDe(['seleccion'], con({ sucio: false, seleccionados: 1 })).habilitado,
    true
  );
});

test('seleccion no le importa que haya cosas sin guardar', () => {
  // «Eliminar» y «Verificar en el proveedor» no dependen de lo tipeado.
  assert.equal(
    habilitacionDe(['seleccion'], con({ sucio: true, seleccionados: 3 })).habilitado,
    true
  );
});

// --------------------------------------------------------------------------
// guardado
// --------------------------------------------------------------------------

test('guardado: bloquea con cambios sin guardar', () => {
  const sucio = habilitacionDe(['guardado'], con({ sucio: true, seleccionados: 0 }));
  assert.equal(sucio.habilitado, false);
  assert.match(sucio.motivos[0], /sin guardar/i);
});

test('guardado no pide seleccion: es el caso de «Aprobar los completos»', () => {
  // El boton existe para no tener que tildar nada, asi que cero tildados es su estado
  // NORMAL y no puede bloquearlo.
  assert.equal(
    habilitacionDe(['guardado'], con({ sucio: false, seleccionados: 0 })).habilitado,
    true
  );
});

// --------------------------------------------------------------------------
// Los dos juntos: «Aprobar»
// --------------------------------------------------------------------------

test('con los dos requisitos sin cumplir se acumulan LOS DOS motivos', () => {
  // Decir solo uno hace que arreglarlo no alcance y el boton siga gris sin que se
  // entienda que mas falta.
  const r = habilitacionDe(['guardado', 'seleccion'], con({ sucio: true, seleccionados: 0 }));
  assert.equal(r.habilitado, false);
  assert.equal(r.motivos.length, 2);
  assert.ok(r.motivos.some((m) => /sin guardar/i.test(m)));
  assert.ok(r.motivos.some((m) => /tildado/i.test(m)));
});

test('cumplir uno solo no alcanza', () => {
  assert.equal(
    habilitacionDe(['guardado', 'seleccion'], con({ sucio: false, seleccionados: 0 })).habilitado,
    false
  );
  assert.equal(
    habilitacionDe(['guardado', 'seleccion'], con({ sucio: true, seleccionados: 2 })).habilitado,
    false
  );
  assert.equal(
    habilitacionDe(['guardado', 'seleccion'], con({ sucio: false, seleccionados: 2 })).habilitado,
    true
  );
});

// --------------------------------------------------------------------------
// cambios: el inverso de guardado, para «Guardar cambios»
// --------------------------------------------------------------------------

test('cambios: bloquea cuando NO hay nada para guardar', () => {
  // El boton gris dice "tu trabajo esta guardado", que es la pregunta que uno se hace al
  // alejarse del teclado.
  const r = habilitacionDe(['cambios'], limpio);
  assert.equal(r.habilitado, false);
  assert.match(r.motivos[0], /nada para guardar/i);
});

test('cambios: habilita en cuanto hay algo tipeado', () => {
  assert.equal(habilitacionDe(['cambios'], con({ sucio: true })).habilitado, true);
});

test('cambios y guardado son EXACTAMENTE opuestos: nunca los dos habilitados', () => {
  // Si los dos pudieran estar habilitados a la vez, «Guardar» y «Aprobar» estarian
  // ofreciendo lo mismo sobre estados incompatibles.
  for (const sucio of [true, false]) {
    const estado = con({ sucio, seleccionados: 1, completos: 1 });
    const guardar = habilitacionDe(['cambios'], estado).habilitado;
    const aprobar = habilitacionDe(['guardado'], estado).habilitado;
    assert.notEqual(guardar, aprobar, `sucio=${sucio}`);
  }
});

test('cambios no le importa la seleccion ni los completos', () => {
  // Guardar es la salida de emergencia: no puede depender de nada mas que de que haya
  // algo que guardar. Si dependiera, un estado raro dejaria lo tipeado sin forma de
  // persistirse.
  assert.equal(
    habilitacionDe(['cambios'], { sucio: true, seleccionados: 0, completos: 0 }).habilitado,
    true
  );
});

// --------------------------------------------------------------------------
// completos: para «Aprobar los completos»
// --------------------------------------------------------------------------

test('completos: bloquea cuando no hay ninguno listo', () => {
  const r = habilitacionDe(['completos'], limpio);
  assert.equal(r.habilitado, false);
  assert.match(r.motivos[0], /completo/i);
});

test('completos: habilita con al menos uno', () => {
  assert.equal(habilitacionDe(['completos'], con({ completos: 1 })).habilitado, true);
});

test('«Aprobar los completos» real: pide guardado Y completos', () => {
  const requisitos = ['guardado', 'completos'] as const;

  // El caso util: guardado y con algo listo.
  assert.equal(habilitacionDe(requisitos, con({ completos: 3 })).habilitado, true);

  // Hay completos pero el contador esta viejo porque se tipeo algo.
  assert.equal(
    habilitacionDe(requisitos, con({ sucio: true, completos: 3 })).habilitado,
    false
  );

  // Guardado pero no hay nada que aprobar.
  assert.equal(habilitacionDe(requisitos, limpio).habilitado, false);

  // Los dos motivos a la vez.
  assert.equal(habilitacionDe(requisitos, con({ sucio: true })).motivos.length, 2);
});

// --------------------------------------------------------------------------
// Que ensucia el formulario
// --------------------------------------------------------------------------

test('los cuatro campos de una fila ensucian', () => {
  for (const n of ['nombre-12', 'descripcion-12', 'precio-12', 'categoria-12']) {
    assert.equal(esCampoDeFila(n), true, n);
  }
});

test('`destacado-12` ya NO es un campo de fila: salio del formulario', () => {
  // Quedo fuera junto con la curaduria de portada. Si volviera a ensuciar sin tener
  // control que lo rinda, la grilla se marcaria como pendiente por un campo fantasma.
  assert.equal(esCampoDeFila('destacado-12'), false);
});

test('tildar una casilla NO ensucia: elegir no es un cambio pendiente', () => {
  // `id` es la casilla de seleccion y `fila` el oculto que marca que la fila se rindio.
  assert.equal(esCampoDeFila('id'), false);
  assert.equal(esCampoDeFila('fila'), false);
});

test('los controles que no son datos de una fila tampoco ensucian', () => {
  // `secundaria` es la categoria del lote: una eleccion de la accion, no un dato del
  // producto. Si ensuciara, elegirla deshabilitaria los botones de aprobar.
  for (const n of ['secundaria', 'accion', 'volver', 'q', 'estado', 'sin-foto', '']) {
    assert.equal(esCampoDeFila(n), false, n);
  }
});

test('un nombre PARECIDO no cuenta: el id tiene que ser un numero', () => {
  assert.equal(esCampoDeFila('nombre-'), false);
  assert.equal(esCampoDeFila('nombre-abc'), false);
  assert.equal(esCampoDeFila('nombre'), false);
  assert.equal(esCampoDeFila('sobrenombre-12'), false);
  assert.equal(esCampoDeFila('precio-12-extra'), false);
});
