import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construirEnlaceWa, normalizarTelefono } from './whatsapp.ts';

const TEL = '595971878090';
const URL_PROD = 'https://ybe.test/productos/cartera-de-fiesta-con-strass';

function textoDe(enlace: string): string {
  return decodeURIComponent(new URL(enlace).searchParams.get('text') ?? '');
}

// --------------------------------------------------------------------------
// El mensaje SIEMPRE lleva nombre y URL canonica (SPEC §9.7)
// --------------------------------------------------------------------------

test('el mensaje incluye siempre el nombre y la URL canonica', () => {
  const enlace = construirEnlaceWa({
    telefono: TEL,
    nombre: 'Cartera de fiesta con strass',
    url: URL_PROD,
  });
  const texto = textoDe(enlace);
  assert.ok(texto.includes('Cartera de fiesta con strass'), 'falta el nombre');
  assert.ok(texto.includes(URL_PROD), 'falta la URL canonica');
});

test('con color, el mensaje lo incluye ademas del nombre y la URL', () => {
  const texto = textoDe(
    construirEnlaceWa({ telefono: TEL, nombre: 'Mochila urbana', url: URL_PROD, color: 'Azul marino' })
  );
  assert.ok(texto.includes('Mochila urbana'));
  assert.ok(texto.includes('Azul marino'));
  assert.ok(texto.includes(URL_PROD));
});

test('sin color no aparece un separador colgado', () => {
  const texto = textoDe(construirEnlaceWa({ telefono: TEL, nombre: 'Mochila urbana', url: URL_PROD }));
  assert.ok(!texto.includes('—'), 'no debe quedar el guion de separacion sin color');
});

// --------------------------------------------------------------------------
// Forma del enlace
// --------------------------------------------------------------------------

test('el enlace apunta a wa.me con el telefono en el path', () => {
  const enlace = construirEnlaceWa({ telefono: TEL, nombre: 'X', url: URL_PROD });
  const u = new URL(enlace);
  assert.equal(u.origin, 'https://wa.me');
  assert.equal(u.pathname, `/${TEL}`);
});

test('el texto va URL-encodeado: saltos y acentos no rompen el enlace', () => {
  const enlace = construirEnlaceWa({
    telefono: TEL,
    nombre: 'Riñonera 18" & correa',
    url: URL_PROD,
  });
  // Que se pueda parsear como URL ya prueba que esta bien escapado.
  assert.doesNotThrow(() => new URL(enlace));
  assert.ok(textoDe(enlace).includes('Riñonera 18" & correa'));
  assert.ok(!enlace.includes(' '), 'el enlace no puede tener espacios crudos');
  assert.ok(!enlace.includes('\n'), 'el enlace no puede tener saltos crudos');
});

// --------------------------------------------------------------------------
// El codigo en el mensaje (SPEC-etapa2 §5.3, fase 2.7)
// --------------------------------------------------------------------------

test('el mensaje lleva el codigo, rotulado', () => {
  /**
   * Es el caso de uso central del negocio: del otro lado del chat no se puede tener
   * que adivinar de que producto se habla. El codigo va ROTULADO y en su propia
   * linea: quien atiende escanea la conversacion, no la lee.
   */
  const enlace = construirEnlaceWa({
    telefono: TEL,
    nombre: 'Mochila urbana',
    url: URL_PROD,
    codigo: 'CG85527',
  });

  assert.ok(textoDe(enlace).includes('Código: CG85527'));
});

test('el codigo no reemplaza al nombre ni a la URL', () => {
  // Las tres cosas cumplen funciones distintas: el nombre se lee, el codigo se busca
  // en el sistema, y la URL es la que se abre.
  const texto = textoDe(
    construirEnlaceWa({
      telefono: TEL,
      nombre: 'Mochila urbana',
      url: URL_PROD,
      codigo: 'CG85527',
    })
  );

  assert.ok(texto.includes('Mochila urbana'));
  assert.ok(texto.includes(URL_PROD));
  assert.ok(texto.includes('CG85527'));
});

test('el codigo va con el color, no en vez del color', () => {
  const texto = textoDe(
    construirEnlaceWa({
      telefono: TEL,
      nombre: 'Mochila urbana',
      url: URL_PROD,
      color: 'Negro',
      codigo: 'CG85527',
    })
  );

  assert.ok(texto.includes('Mochila urbana — Negro'));
  assert.ok(texto.includes('Código: CG85527'));
});

test('sin codigo el mensaje sigue armandose, sin la linea vacia', () => {
  /**
   * `codigo` es opcional a proposito: si un dia una ficha se rinde sin el, el boton
   * principal del sitio NO puede quedar roto — ni mostrar «Código:» sin nada al lado,
   * que se lee como un error del sitio.
   */
  const texto = textoDe(construirEnlaceWa({ telefono: TEL, nombre: 'X', url: URL_PROD }));

  assert.ok(!texto.includes('Código'));
  assert.ok(texto.includes('X'));
  assert.ok(texto.includes(URL_PROD));
});

test('un codigo en blanco se trata como ausente', () => {
  const texto = textoDe(
    construirEnlaceWa({ telefono: TEL, nombre: 'X', url: URL_PROD, codigo: '   ' })
  );
  assert.ok(!texto.includes('Código'));
});

test('el codigo va antes de la URL: lo ultimo del mensaje es el enlace', () => {
  // La URL al final es lo que la mayoria de los clientes de chat convierten en
  // preview. Meter texto despues la parte al medio.
  const texto = textoDe(
    construirEnlaceWa({ telefono: TEL, nombre: 'X', url: URL_PROD, codigo: 'CG1' })
  );
  assert.ok(texto.indexOf('Código: CG1') < texto.indexOf(URL_PROD));
  assert.ok(texto.trimEnd().endsWith(URL_PROD));
});

// --------------------------------------------------------------------------
// normalizarTelefono — el formato de wa.me (SPEC §9.7)
// --------------------------------------------------------------------------

test('normalizarTelefono: saca +, espacios, guiones y parentesis', () => {
  assert.equal(normalizarTelefono('+595 971 878-090'), TEL);
  assert.equal(normalizarTelefono('(595) 971878090'), TEL);
  assert.equal(normalizarTelefono('+595971878090'), TEL);
  assert.equal(normalizarTelefono(TEL), TEL);
});

test('normalizarTelefono: rechaza un numero sin codigo de pais', () => {
  // 0971... es el formato local paraguayo. Sin el 595, wa.me abre un chat
  // equivocado o ninguno, y el boton principal del sitio queda roto en silencio.
  assert.throws(() => normalizarTelefono('0971878090'), /codigo de pais/);
  assert.throws(() => normalizarTelefono('971878090'), /codigo de pais/);
});

test('normalizarTelefono: rechaza vacio o basura', () => {
  assert.throws(() => normalizarTelefono(''), /vacio|codigo de pais/);
  assert.throws(() => normalizarTelefono('no-un-telefono'), /vacio|codigo de pais/);
});

test('construirEnlaceWa: el telefono se normaliza, un + configurado no rompe', () => {
  const enlace = construirEnlaceWa({ telefono: '+595971878090', nombre: 'X', url: URL_PROD });
  assert.equal(new URL(enlace).pathname, `/${TEL}`);
});
