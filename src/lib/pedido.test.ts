import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FORMAS_PAGO,
  construirMensajePedido,
  enlacePedidoWa,
  leerContextoPedido,
  urlDeFormulario,
  validarPedido,
  type DatosPedido,
} from './pedido.ts';

const TEL = '595971878090';
const URL_PROD = 'https://ybe.test/productos/cartera-de-fiesta-con-strass';

const COMPLETO: DatosPedido = {
  nombre: 'Juan Pérez',
  telefono: '0981123456',
  direccion: 'Av. España 1234 c/ Brasil',
  ciudad: 'Asunción',
  referencia: 'Portón blanco, al lado de la farmacia',
  cantidad: 2,
  pago: 'transferencia',
  factura: false,
  ruc: '',
  razonSocial: '',
  notas: 'Entregar por la tarde',
};

/** El mismo pedido, pero con factura. Es el caso que agrega dos campos obligatorios. */
const CON_FACTURA: DatosPedido = {
  ...COMPLETO,
  factura: true,
  ruc: '80012345-6',
  razonSocial: 'Comercial Pérez S.A.',
};

// --------------------------------------------------------------------------
// El enlace del boton «Pedi ahora» de la ficha
// --------------------------------------------------------------------------

test('el enlace del formulario lleva el slug del producto', () => {
  const u = new URL(urlDeFormulario({ slug: 'cartera-de-fiesta' }), 'https://ybe.test');
  assert.equal(u.pathname, '/pedir');
  assert.equal(u.searchParams.get('p'), 'cartera-de-fiesta');
});

test('con una sola variante no se cuelgan sku ni color en la URL', () => {
  const u = new URL(urlDeFormulario({ slug: 'mochila' }), 'https://ybe.test');
  assert.equal(u.searchParams.get('v'), null);
  assert.equal(u.searchParams.get('c'), null);
});

test('con variante elegida, sku y color viajan en la URL', () => {
  const u = new URL(
    urlDeFormulario({ slug: 'mochila', sku: 'CG85527-AZ', color: 'Azul marino' }),
    'https://ybe.test'
  );
  assert.equal(u.searchParams.get('v'), 'CG85527-AZ');
  assert.equal(u.searchParams.get('c'), 'Azul marino');
});

// --------------------------------------------------------------------------
// Leer el contexto del lado del formulario
// --------------------------------------------------------------------------

test('el contexto se recupera de la query string', () => {
  const ctx = leerContextoPedido('?p=mochila&v=CG1-AZ&c=Azul%20marino');
  assert.deepEqual(ctx, { slug: 'mochila', sku: 'CG1-AZ', color: 'Azul marino' });
});

test('ida y vuelta: lo que arma la ficha es lo que lee el formulario', () => {
  const contexto = { slug: 'cartera-de-fiesta', sku: 'CG9-RJ', color: 'Rojo' };
  const u = new URL(urlDeFormulario(contexto), 'https://ybe.test');
  assert.deepEqual(leerContextoPedido(u.search), contexto);
});

test('sin producto en la query el contexto es nulo', () => {
  assert.equal(leerContextoPedido('?v=CG1-AZ'), null);
  assert.equal(leerContextoPedido(''), null);
});

// --------------------------------------------------------------------------
// Validacion: que campo falta y por que
// --------------------------------------------------------------------------

test('un pedido completo no tiene errores', () => {
  assert.deepEqual(validarPedido(COMPLETO), {});
});

test('sin nombre, telefono, direccion o ciudad hay un error por campo', () => {
  const errores = validarPedido({
    ...COMPLETO,
    nombre: '',
    telefono: '',
    direccion: '',
    ciudad: '',
  });
  assert.ok(errores.nombre, 'falta el error de nombre');
  assert.ok(errores.telefono, 'falta el error de telefono');
  assert.ok(errores.direccion, 'falta el error de direccion');
  assert.ok(errores.ciudad, 'falta el error de ciudad');
});

test('el blanco no cuenta como dato cargado', () => {
  assert.ok(validarPedido({ ...COMPLETO, nombre: '   ' }).nombre);
});

test('la referencia y las notas son opcionales', () => {
  assert.deepEqual(validarPedido({ ...COMPLETO, referencia: '', notas: '' }), {});
});

test('un telefono con menos digitos que un movil paraguayo se rechaza', () => {
  assert.ok(validarPedido({ ...COMPLETO, telefono: '12345' }).telefono);
});

test('el telefono se acepta con espacios, guiones y parentesis', () => {
  assert.deepEqual(validarPedido({ ...COMPLETO, telefono: '(0981) 123-456' }), {});
});

test('la cantidad no puede ser cero, negativa ni fraccionada', () => {
  assert.ok(validarPedido({ ...COMPLETO, cantidad: 0 }).cantidad);
  assert.ok(validarPedido({ ...COMPLETO, cantidad: -1 }).cantidad);
  assert.ok(validarPedido({ ...COMPLETO, cantidad: 1.5 }).cantidad);
});

test('la cantidad vacia del input —NaN— se reporta como error, no explota', () => {
  assert.ok(validarPedido({ ...COMPLETO, cantidad: Number.NaN }).cantidad);
});

// --------------------------------------------------------------------------
// La forma de pago
// --------------------------------------------------------------------------

test('sin elegir forma de pago hay error: no hay default que adivinar', () => {
  assert.ok(validarPedido({ ...COMPLETO, pago: null }).pago);
});

test('las tres formas de pago son validas', () => {
  assert.deepEqual(validarPedido({ ...COMPLETO, pago: 'efectivo' }), {});
  assert.deepEqual(validarPedido({ ...COMPLETO, pago: 'transferencia' }), {});
  assert.deepEqual(validarPedido({ ...COMPLETO, pago: 'qr' }), {});
});

test('la forma de pago va rotulada en el mensaje, en palabra y no en clave', () => {
  const enEfectivo = construirMensajePedido({
    producto: PRODUCTO,
    datos: { ...COMPLETO, pago: 'efectivo' },
  });
  assert.ok(enEfectivo.includes('Pago: Efectivo'), enEfectivo);

  const porTransferencia = construirMensajePedido({
    producto: PRODUCTO,
    datos: { ...COMPLETO, pago: 'transferencia' },
  });
  assert.ok(porTransferencia.includes('Pago: Transferencia'), porTransferencia);
});

test('sin forma de pago el mensaje no deja el rotulo colgado', () => {
  const texto = construirMensajePedido({ producto: PRODUCTO, datos: { ...COMPLETO, pago: null } });
  assert.ok(!texto.includes('Pago:'));
});

test('las formas de pago que se ofrecen son exactamente tres', () => {
  assert.deepEqual(
    FORMAS_PAGO.map((f) => f.valor),
    ['efectivo', 'transferencia', 'qr']
  );
});

test('el QR se rotula en el mensaje como QR y no como «Qr»', () => {
  const texto = construirMensajePedido({ producto: PRODUCTO, datos: { ...COMPLETO, pago: 'qr' } });
  assert.ok(texto.includes('Pago: QR'), texto);
});

// --------------------------------------------------------------------------
// La factura: dos campos que solo existen si se la pide
// --------------------------------------------------------------------------

test('sin factura, RUC y razon social vacios no son error', () => {
  assert.deepEqual(validarPedido({ ...COMPLETO, factura: false, ruc: '', razonSocial: '' }), {});
});

test('con factura, RUC y razon social pasan a ser obligatorios', () => {
  const errores = validarPedido({ ...COMPLETO, factura: true, ruc: '', razonSocial: '' });
  assert.ok(errores.ruc, 'falta el error de ruc');
  assert.ok(errores.razonSocial, 'falta el error de razonSocial');
});

test('con factura completa no hay errores', () => {
  assert.deepEqual(validarPedido(CON_FACTURA), {});
});

test('el RUC EXIGE el guion del digito verificador', () => {
  assert.deepEqual(validarPedido({ ...CON_FACTURA, ruc: '80012345-6' }), {});
  assert.ok(validarPedido({ ...CON_FACTURA, ruc: '800123456' }).ruc, 'sin guion debe fallar');
});

test('los puntos de miles se aceptan: el guion es lo que se exige, no el formato', () => {
  assert.deepEqual(validarPedido({ ...CON_FACTURA, ruc: '4.567.890-1' }), {});
  assert.deepEqual(validarPedido({ ...CON_FACTURA, ruc: ' 80012345 - 6 ' }), {});
});

test('el digito verificador es UNO solo', () => {
  assert.ok(validarPedido({ ...CON_FACTURA, ruc: '80012345-' }).ruc, 'guion sin digito');
  assert.ok(validarPedido({ ...CON_FACTURA, ruc: '80012345-67' }).ruc, 'dos digitos');
});

test('un RUC sin digitos suficientes se rechaza aunque traiga guion', () => {
  assert.ok(validarPedido({ ...CON_FACTURA, ruc: '123-4' }).ruc);
  assert.ok(validarPedido({ ...CON_FACTURA, ruc: 'no-tengo' }).ruc);
  assert.ok(validarPedido({ ...CON_FACTURA, ruc: '-6' }).ruc);
});

test('la razon social en blanco no cuenta como cargada', () => {
  assert.ok(validarPedido({ ...CON_FACTURA, razonSocial: '   ' }).razonSocial);
});

test('con factura, el mensaje lleva el RUC y la razon social rotulados', () => {
  const texto = construirMensajePedido({ producto: PRODUCTO, datos: CON_FACTURA });
  assert.ok(texto.includes('RUC: 80012345-6'), texto);
  assert.ok(texto.includes('Razón social: Comercial Pérez S.A.'), texto);
});

test('sin factura, el mensaje no menciona RUC ni razon social', () => {
  const texto = construirMensajePedido({ producto: PRODUCTO, datos: COMPLETO });
  assert.ok(!texto.includes('RUC'));
  assert.ok(!texto.includes('Razón social'));
});

test('los datos de factura no se filtran si se destildo despues de cargarlos', () => {
  // El estado de la isla conserva lo tipeado al destildar —para no perderlo si se
  // vuelve a tildar—, asi que quien arma el mensaje es el que tiene que respetar el
  // «no quiero factura».
  const texto = construirMensajePedido({
    producto: PRODUCTO,
    datos: { ...CON_FACTURA, factura: false },
  });
  assert.ok(!texto.includes('80012345-6'));
  assert.ok(!texto.includes('Comercial Pérez'));
});

// --------------------------------------------------------------------------
// El mensaje del pedido
// --------------------------------------------------------------------------

const PRODUCTO = {
  nombre: 'Cartera de fiesta con strass',
  codigo: 'CG85527' as string | undefined,
  url: URL_PROD,
  color: 'Rojo' as string | undefined,
};

test('el mensaje lleva el producto, el codigo y todos los datos del cliente', () => {
  const texto = construirMensajePedido({ producto: PRODUCTO, datos: COMPLETO });

  for (const esperado of [
    'Cartera de fiesta con strass',
    'CG85527',
    'Juan Pérez',
    '0981123456',
    'Av. España 1234 c/ Brasil',
    'Asunción',
    'Portón blanco, al lado de la farmacia',
    'Entregar por la tarde',
    URL_PROD,
  ]) {
    assert.ok(texto.includes(esperado), `falta "${esperado}" en el mensaje`);
  }
});

test('la URL canonica queda al final, para que la vista previa no se parta', () => {
  const texto = construirMensajePedido({ producto: PRODUCTO, datos: COMPLETO });
  assert.ok(texto.trimEnd().endsWith(URL_PROD));
});

test('cantidad 1 no se rotula: es el caso normal y solo agrega ruido', () => {
  const texto = construirMensajePedido({ producto: PRODUCTO, datos: { ...COMPLETO, cantidad: 1 } });
  assert.ok(!texto.includes('Cantidad'));
});

test('cantidad mayor a 1 se rotula', () => {
  const texto = construirMensajePedido({ producto: PRODUCTO, datos: { ...COMPLETO, cantidad: 3 } });
  assert.ok(/Cantidad: 3/.test(texto));
});

test('los campos opcionales vacios no dejan rotulos colgados', () => {
  const texto = construirMensajePedido({
    producto: PRODUCTO,
    datos: { ...COMPLETO, referencia: '', notas: '' },
  });
  assert.ok(!texto.includes('Referencia:'));
  assert.ok(!texto.includes('Nota:'));
});

test('sin codigo el mensaje sigue sirviendo, sin el rotulo vacio', () => {
  const texto = construirMensajePedido({
    producto: { ...PRODUCTO, codigo: undefined },
    datos: COMPLETO,
  });
  assert.ok(!texto.includes('Código:'));
  assert.ok(texto.includes('Cartera de fiesta con strass'));
});

test('sin color el encabezado no queda con el guion colgado', () => {
  const texto = construirMensajePedido({
    producto: { ...PRODUCTO, color: undefined },
    datos: COMPLETO,
  });
  assert.ok(!texto.includes('—'));
});

// --------------------------------------------------------------------------
// El enlace de envio
// --------------------------------------------------------------------------

test('el enlace de envio es un wa.me con el mensaje codificado', () => {
  const enlace = enlacePedidoWa({ telefono: TEL, producto: PRODUCTO, datos: COMPLETO });
  const u = new URL(enlace);
  assert.equal(u.origin + u.pathname, `https://wa.me/${TEL}`);
  assert.equal(
    u.searchParams.get('text'),
    construirMensajePedido({ producto: PRODUCTO, datos: COMPLETO })
  );
});

// --------------------------------------------------------------------------
// La miniatura de la variante elegida
// --------------------------------------------------------------------------

test('la foto de la variante elegida viaja en la URL', () => {
  /**
   * MISMO MOTIVO QUE EL COLOR, y es un bug que ya se reporto: `/pedir` resuelve el
   * producto contra `/indice.json`, que lleva UNA sola miniatura por producto —la de
   * `variantes[0]`, para el buscador—. Sin este parametro, elegir el negro y tocar
   * «Pedi ahora» mostraba la foto del primer color.
   */
  const u = new URL(
    urlDeFormulario({ slug: 'mochila', sku: 'CG1-N', color: 'Negro', imagen: 'a1b2c3d4e5f60718' }),
    'https://ybe.test'
  );
  assert.equal(u.searchParams.get('t'), 'a1b2c3d4e5f60718');
});

test('sin foto no se cuelga el parametro', () => {
  // Una variante puede no tener ninguna: el placeholder de §5.4 es un caso normal.
  const u = new URL(urlDeFormulario({ slug: 'mochila', sku: 'CG1-N' }), 'https://ybe.test');
  assert.equal(u.searchParams.get('t'), null);
});

test('la foto se recupera del contexto', () => {
  const ctx = leerContextoPedido('?p=mochila&v=CG1-N&t=a1b2c3d4e5f60718');
  assert.equal(ctx?.imagen, 'a1b2c3d4e5f60718');
});

test('un hash que no es un hash se IGNORA, no viaja al <img>', () => {
  /**
   * La URL la puede editar cualquiera y con este valor se arma una clave de R2. Un
   * hash con barras apuntaria fuera del prefijo `catalogo/`. Se descarta y el
   * formulario cae en la miniatura del indice, que es la que estaba antes de esto.
   */
  for (const malo of ['../otro', 'A1B2C3D4E5F60718', 'abc', 'a1b2c3d4e5f60718/x', '']) {
    const ctx = leerContextoPedido(`?p=mochila&t=${encodeURIComponent(malo)}`);
    assert.equal(ctx?.imagen, undefined, JSON.stringify(malo));
  }
});

test('un hash invalido no tira abajo el resto del contexto', () => {
  // El pedido se puede seguir haciendo sin foto. Descartar el producto entero por una
  // miniatura seria cambiar un defecto visual por una pantalla vacia.
  const ctx = leerContextoPedido('?p=mochila&v=CG1-N&c=Negro&t=../otro');
  assert.deepEqual(ctx, { slug: 'mochila', sku: 'CG1-N', color: 'Negro' });
});
