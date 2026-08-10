import { useEffect, useRef, useState } from 'preact/hooks';

import { buscar, type EntradaIndice } from '../../lib/buscar.ts';
import { formatearGs } from '../../lib/precio.ts';

/**
 * Buscador por código o nombre del sitio público (SPEC §9.4, SPEC-etapa2 §5.3).
 *
 * ESTA ISLA NO DECIDE QUÉ ENCUENTRA QUÉ. Eso vive en `lib/buscar.ts`, que es puro y
 * tiene tests. Acá está lo que no se puede probar sin un navegador: bajar el índice,
 * el foco, el teclado y el DOM.
 *
 * EL ÍNDICE SE BAJA AL PRIMER USO, no al cargar la página. Con `client:idle` la isla
 * se hidrata cuando el navegador está libre, pero pedir `/indice.json` ahí gastaría
 * datos de todos los visitantes para una función que usa una parte. Se pide al enfocar
 * el campo, que es el primer momento en que sabemos que alguien va a buscar.
 */

interface Props {
  /** Base pública de R2, para las miniaturas. */
  r2Base: string;
}

type Estado = 'quieto' | 'cargando' | 'listo' | 'error';

export default function Buscador({ r2Base }: Props) {
  const [consulta, setConsulta] = useState('');
  const [indice, setIndice] = useState<EntradaIndice[]>([]);
  const [estado, setEstado] = useState<Estado>('quieto');
  const [abierto, setAbierto] = useState(false);
  const contenedor = useRef<HTMLDivElement>(null);

  /** Una sola vez, al primer foco. */
  const cargarIndice = async () => {
    if (estado !== 'quieto') return;
    setEstado('cargando');
    try {
      const r = await fetch('/indice.json');
      if (!r.ok) throw new Error(String(r.status));
      setIndice((await r.json()) as EntradaIndice[]);
      setEstado('listo');
    } catch {
      // Sin índice no hay búsqueda, pero el resto del sitio sigue entero: se navega
      // por categorías, que es como se navegaba antes de que esto existiera.
      setEstado('error');
    }
  };

  // Cerrar al tocar afuera. Sin esto la lista queda tapando la página después de
  // elegir con el mouse en cualquier otro lado.
  useEffect(() => {
    const alTocar = (e: MouseEvent) => {
      if (!contenedor.current?.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener('click', alTocar);
    return () => document.removeEventListener('click', alTocar);
  }, []);

  const resultados = estado === 'listo' ? buscar(indice, consulta) : [];
  const hayConsulta = consulta.trim() !== '';
  const mostrar = abierto && hayConsulta;

  return (
    <div ref={contenedor} class="relative">
      <label class="sr-only" for="q">
        Buscar por código o nombre
      </label>
      {/* El `placeholder` va corto porque el campo mide ~160px en móvil. La frase
          entera vive en el `label` de arriba, que es lo que lee un lector de pantalla. */}
      <input
        id="q"
        type="search"
        autocomplete="off"
        placeholder="Código o nombre"
        value={consulta}
        onFocus={() => {
          void cargarIndice();
          setAbierto(true);
        }}
        onInput={(e) => {
          setConsulta((e.target as HTMLInputElement).value);
          setAbierto(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setAbierto(false);
        }}
        class="border-borde focus:border-acento w-full rounded border bg-white px-3 py-2 text-sm outline-none"
      />

      {/*
        EL DESPLEGABLE ES MÁS ANCHO QUE EL CAMPO, a propósito.

        El input mide ~160px en móvil para caber al lado del logo, y una lista con foto,
        nombre, código y precio no entra en 160px. Se ancla a la DERECHA y se extiende
        hacia la izquierda, con tope de 85vw para no salirse de la pantalla. En
        escritorio vuelve a acompañar el ancho del campo.
      */}
      {mostrar && (
        <div class="border-borde absolute top-full right-0 z-30 mt-1 max-h-96 w-[min(22rem,85vw)] overflow-y-auto rounded border bg-white shadow-lg sm:w-full">
          {estado === 'cargando' && <p class="text-texto-suave p-3 text-sm">Buscando…</p>}

          {estado === 'error' && (
            <p class="text-texto-suave p-3 text-sm">
              No se pudo cargar la búsqueda. Podés navegar por categorías.
            </p>
          )}

          {estado === 'listo' && resultados.length === 0 && (
            <p class="text-texto-suave p-3 text-sm">
              No encontramos nada con «{consulta.trim()}».
            </p>
          )}

          {/* `aria-live`: quien usa lector de pantalla tiene que enterarse de que la
              lista cambio sin tener que salir del campo. */}
          <ul aria-live="polite">
            {resultados.map((r) => (
              <li key={r.i}>
                <a
                  href={`/productos/${r.i}`}
                  class="hover:bg-fondo flex items-center gap-3 p-2 no-underline"
                >
                  {r.t ? (
                    <img
                      src={`${r2Base}/catalogo/${r.t}/w300.webp`}
                      alt=""
                      width="40"
                      height="40"
                      loading="lazy"
                      class="border-borde h-10 w-10 shrink-0 rounded border object-contain"
                    />
                  ) : (
                    <span class="border-borde bg-fondo h-10 w-10 shrink-0 rounded border" />
                  )}

                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm">{r.n}</span>
                    {/* El codigo a la vista: es el dato con el que el cliente pregunta,
                        asi que tiene que poder confirmarlo antes de entrar. */}
                    <span class="text-texto-suave block font-mono text-xs">{r.k}</span>
                  </span>

                  <span class="shrink-0 text-sm whitespace-nowrap">
                    {r.p === null ? 'Consultar' : formatearGs(r.p)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
