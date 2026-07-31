import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  urlImagen,
  srcSetImagen,
  anchoMayor,
  validarBaseR2,
  SIZES_CARD,
  type Imagen,
} from './imagenes.ts';

const R2 = 'https://cdn.ybe.test';
const COMPLETA: Imagen = { base: 'catalogo/406b4fe1006d642b', anchos: [300, 600] };
const SOLO_300: Imagen = { base: 'catalogo/aaaabbbbccccdddd', anchos: [300] };

test('urlImagen: concatena base de R2, clave y ancho', () => {
  assert.equal(urlImagen(R2, COMPLETA, 600), `${R2}/catalogo/406b4fe1006d642b/w600.webp`);
  assert.equal(urlImagen(R2, COMPLETA, 300), `${R2}/catalogo/406b4fe1006d642b/w300.webp`);
});

test('urlImagen: tolera barra final en la base sin duplicarla', () => {
  // PUBLIC_R2_BASE lo escribe una persona en .env; una barra de mas no puede
  // producir //catalogo/...
  assert.equal(urlImagen(`${R2}/`, COMPLETA, 600), `${R2}/catalogo/406b4fe1006d642b/w600.webp`);
});

test('urlImagen: funciona con una base relativa para desarrollo local', () => {
  // En dev las imagenes salen de public/img-dev con la MISMA estructura de
  // claves, asi que pasar a R2 es solo cambiar esta variable.
  assert.equal(urlImagen('/img-dev', COMPLETA, 300), '/img-dev/catalogo/406b4fe1006d642b/w300.webp');
});

test('urlImagen: rechaza un ancho que la imagen no tiene', () => {
  // Pedir w600 de un origen que solo soporta w300 generaria un <img> roto.
  assert.throws(() => urlImagen(R2, SOLO_300, 600), /600/);
});

test('srcSetImagen: emite los dos anchos cuando existen', () => {
  assert.equal(
    srcSetImagen(R2, COMPLETA),
    `${R2}/catalogo/406b4fe1006d642b/w300.webp 300w, ${R2}/catalogo/406b4fe1006d642b/w600.webp 600w`
  );
});

test('srcSetImagen: emite SOLO los anchos que existen', () => {
  // Regla de §5.5: un origen de 450 px no genera w600, y el srcset no puede
  // apuntar a un archivo inexistente.
  const s = srcSetImagen(R2, SOLO_300);
  assert.equal(s, `${R2}/catalogo/aaaabbbbccccdddd/w300.webp 300w`);
  assert.ok(!s.includes('w600'), 'no debe referenciar un w600 que no se genero');
});

test('srcSetImagen: los anchos salen ordenados de menor a mayor', () => {
  const desordenada: Imagen = { base: 'catalogo/1111222233334444', anchos: [600, 300] };
  const s = srcSetImagen(R2, desordenada);
  assert.ok(s.indexOf('300w') < s.indexOf('600w'), 'el srcset debe ir de menor a mayor');
});

test('anchoMayor: devuelve el mayor disponible, para el src de fallback', () => {
  assert.equal(anchoMayor(COMPLETA), 600);
  assert.equal(anchoMayor(SOLO_300), 300);
});

test('SIZES_CARD describe el ancho real de la card en cada breakpoint', () => {
  // Sin sizes correcto el navegador asume 100vw y baja el w600 siempre,
  // desperdiciando datos en movil.
  assert.match(SIZES_CARD, /min-width/);
  assert.match(SIZES_CARD, /vw/);
});

// --------------------------------------------------------------------------
// validarBaseR2 — un PUBLIC_R2_BASE mal seteado no puede fallar en silencio
// --------------------------------------------------------------------------

test('validarBaseR2: acepta una URL absoluta y una ruta de raiz', () => {
  assert.equal(validarBaseR2('https://cdn.ybe.test'), 'https://cdn.ybe.test');
  assert.equal(validarBaseR2('https://pub-abc123.r2.dev'), 'https://pub-abc123.r2.dev');
  assert.equal(validarBaseR2('/img-dev'), '/img-dev');
});

test('validarBaseR2: detecta una ruta de Windows mutilada por Git Bash', () => {
  // Git Bash (MSYS) traduce cualquier argumento con pinta de ruta POSIX:
  //   PUBLIC_R2_BASE=/img-dev  ->  C:/Program Files/Git/img-dev
  // El sintoma es una pagina llena de imagenes rotas SIN ningun error, asi que
  // se detecta explicitamente y se nombra la causa en el mensaje.
  assert.throws(() => validarBaseR2('C:/Program Files/Git/img-dev'), /Git Bash|MSYS/);
  assert.throws(() => validarBaseR2(String.raw`C:\Users\x\img-dev`), /Git Bash|MSYS/);
});

test('validarBaseR2: rechaza una ruta relativa sin barra inicial', () => {
  // 'img-dev' se resolveria relativo a la pagina actual: andaria en la home y
  // se rompería en /productos/x.
  assert.throws(() => validarBaseR2('img-dev'), /barra|absoluta/i);
});

test('validarBaseR2: rechaza vacio', () => {
  assert.throws(() => validarBaseR2(''), /vacio|vacía|vacia/i);
  assert.throws(() => validarBaseR2('   '), /vacio|vacía|vacia/i);
});

test('urlImagen: valida la base antes de construir la URL', () => {
  assert.throws(() => urlImagen('C:/Program Files/Git/img-dev', COMPLETA, 600), /Git Bash|MSYS/);
});
