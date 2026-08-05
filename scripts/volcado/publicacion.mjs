/**
 * Marca el estado de una publicacion desde la GitHub Action (SPEC-etapa2 §11.3).
 *
 *   node scripts/volcado/publicacion.mjs corriendo
 *   node scripts/volcado/publicacion.mjs ok      --productos 8 --commit abc123
 *   node scripts/volcado/publicacion.mjs error   --mensaje "..."
 *
 * POR QUE ESCRIBE EN D1 Y NO HACE UN POST AL ADMIN, como dice §11.2:
 *
 * La Action no puede pasar Cloudflare Access — no hay navegador ni PIN. Un endpoint
 * de vuelta en el admin exigiria un service token o excluir una ruta de la politica:
 * superficie de autenticacion nueva justo en la pieza mas protegida del sistema.
 *
 * La Action, en cambio, YA tiene credenciales de escritura sobre D1 para el volcado.
 * Escribir la fila directo logra lo mismo que §11.3 pide — que la falla sea visible
 * para quien no entra a GitHub — sin abrir ninguna puerta.
 *
 * Si no hay id de publicacion, NO falla: el workflow tambien corre a mano desde la
 * pestana Actions, y ahi no hay ninguna fila que actualizar.
 */
import { ejecutorD1, leerConfigD1 } from './consultar.mjs';
import { ejecutorWrangler } from './ejecutor-wrangler.mjs';

const ESTADOS = new Set(['corriendo', 'ok', 'error']);

function argumento(nombre) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}

const estado = process.argv[2];
if (!ESTADOS.has(estado)) {
  console.error(`Estado invalido: ${estado}. Validos: ${[...ESTADOS].join(', ')}.`);
  process.exit(1);
}

const id = Number(process.env.ID_PUBLICACION ?? '');
if (!Number.isInteger(id) || id <= 0) {
  console.log('Sin ID_PUBLICACION: no hay fila que actualizar (corrida manual). Se omite.');
  process.exit(0);
}

/** Mismo criterio de transporte que el volcado: API HTTP en la Action, wrangler en local. */
const completas = ['CLOUDFLARE_ACCOUNT_ID', 'D1_DATABASE_ID', 'CLOUDFLARE_API_TOKEN'].every(
  (k) => (process.env[k] ?? '').trim() !== ''
);
const ejecutar = completas
  ? ejecutorD1(leerConfigD1(process.env))
  : ejecutorWrangler({ base: 'ybe-catalogo', config: 'db/wrangler.jsonc' });

const ahora = new Date().toISOString();

if (estado === 'corriendo') {
  // Sin `terminada_en`: todavia no termino.
  await ejecutar(`UPDATE publicaciones SET estado = 'corriendo' WHERE id = ?`, [id]);
} else {
  /**
   * El mensaje se guarda ENTERO, con stack si lo hay: el rol tecnico lo necesita.
   * Quien filtra es el admin al mostrarlo (`errorLegible` en publicaciones.ts), no
   * quien escribe. Guardar recortado perderia la unica pista que queda de un build
   * que fallo hace tres dias.
   */
  await ejecutar(
    `UPDATE publicaciones
        SET estado = ?, terminada_en = ?, productos = ?, run_url = ?, commit_sha = ?, error = ?
      WHERE id = ?`,
    [
      estado,
      ahora,
      Number(argumento('productos') ?? 0) || 0,
      argumento('run') ?? null,
      argumento('commit') ?? null,
      estado === 'error' ? (argumento('mensaje') ?? 'El build falló sin dejar mensaje.') : null,
      id,
    ]
  );
}

console.log(`Publicacion ${id} marcada como ${estado}.`);
