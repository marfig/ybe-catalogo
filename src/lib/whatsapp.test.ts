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
