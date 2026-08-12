/**
 * El POST con JSON que comparten los dos recorridos: la importacion de todos los dias y
 * la migracion de una sola vez.
 *
 * Vive aparte porque el `catch` de abajo no es un detalle: en una corrida de media hora,
 * una respuesta que no es JSON es la sesion de Access vencida. Dos copias de esta funcion
 * serian dos lugares donde ese mensaje puede quedar desactualizado.
 */

/**
 * POST con JSON y una sola forma de fallar.
 *
 * Una respuesta que no es JSON no es un caso raro en una corrida larga: es la sesión de
 * Access vencida, que devuelve un redirect a la pantalla de login. Sin este `catch`, el
 * bucle moriría con «Unexpected token <» y nadie entendería por qué.
 */
export async function postJson<T extends { error?: string }>(
  ruta: string,
  cuerpo: unknown
): Promise<T> {
  const respuesta = await fetch(ruta, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });

  try {
    return (await respuesta.json()) as T;
  } catch {
    return {
      error:
        `El servidor respondió ${respuesta.status} y no era una respuesta esperada. ` +
        'Puede que la sesión haya vencido: recargá la página.',
    } as T;
  }
}
