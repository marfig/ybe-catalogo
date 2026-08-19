import { useEffect, useRef, useState } from 'preact/hooks';

import { fotoVecina, topeDeAmpliacion } from '../../lib/galeria.ts';
import { DIAMETRO_LENTE, FACTOR_LENTE, SOMBRA_LENTE, encuadreDeLente } from '../../lib/lente.ts';
import {
  SIZES_FICHA,
  anchoMayor,
  srcSetImagen,
  urlImagen,
  type Imagen,
} from '../../lib/imagenes.ts';
import { construirEnlaceWa } from '../../lib/whatsapp.ts';
import SinFoto from '../SinFoto.tsx';

export interface VarianteIsla {
  sku: string;
  color: string;
  colorHex?: string | undefined;
  imagenes: Imagen[];
}

interface Props {
  nombre: string;
  /** URL canonica absoluta. Va SIEMPRE en el mensaje de WhatsApp (SPEC §9.7). */
  url: string;
  variantes: VarianteIsla[];
  r2Base: string;
  telefono: string;
  /** Codigo del producto. Va rotulado en el mensaje de WhatsApp (SPEC-etapa2 §5.3). */
  codigo?: string | undefined;
}

/**
 * Selector de color de la ficha.
 *
 * Con output 'static' la pagina esta prerenderizada y Astro.url.searchParams no
 * tiene valor en build (SPEC §9.6). Por eso:
 *   - el HTML sale con variantes[0] activa y es funcional sin JS
 *   - ?variante=<sku> se lee al montar, del lado del cliente
 *   - el canonical NO cambia nunca (SPEC §7.1)
 *
 * La isla renderiza galeria + swatches + boton porque controla los tres: mover
 * el DOM de otros componentes por querySelector seria fragil.
 */
export default function SelectorVariante({
  nombre,
  url,
  variantes,
  r2Base,
  telefono,
  codigo,
}: Props) {
  const [iVariante, setIVariante] = useState(0);
  const [iImagen, setIImagen] = useState(0);

  /**
   * `montado` existe para no prometer lo que el HTML del servidor no puede cumplir.
   *
   * La isla se rinde en el servidor para que la ficha funcione sin JavaScript (§9.6), y el
   * visor necesita JavaScript: `showModal()` no tiene equivalente en HTML. Asi que el boton
   * que lo abre aparece recien despues de hidratar — misma regla que el campo de fotos del
   * admin, que se inyecta desde JS porque sin canvas no podria subir nada.
   *
   * El `<img>` de la ficha NO cambia entre el servidor y el cliente: el boton es una capa
   * encima. Si cambiara, el navegador podria volver a pedir la imagen principal, que es el
   * LCP de esta pagina.
   */
  const [montado, setMontado] = useState(false);
  const [ampliada, setAmpliada] = useState(false);
  const visor = useRef<HTMLDialogElement>(null);

  /**
   * ¿Hay un puntero con el que se pueda apuntar de verdad?
   *
   * DECIDE CUÁL DE LOS DOS GESTOS SE OFRECE, y se pregunta por el PUNTERO y no por el ancho
   * de la pantalla: un portátil táctil de 15 pulgadas es ancho y no tiene hover, y ahí una
   * lupa que aparece donde tocaste tapa justo lo que querías ver.
   *
   *   puntero fino  → la lupa, que sigue al cursor
   *   táctil        → el visor a pantalla completa, que se abre tocando
   *
   * Empieza en `false` para que el primer render —el del servidor, y el de hidratación— no
   * prometa la lupa: si el `matchMedia` dice que no, nunca aparece.
   */
  const [punteroFino, setPunteroFino] = useState(false);

  const caja = useRef<HTMLDivElement>(null);
  const lente = useRef<HTMLDivElement>(null);
  const ampliadaEnLente = useRef<HTMLImageElement>(null);
  const fondoVisor = useRef<HTMLDivElement>(null);

  useEffect(() => setMontado(true), []);

  useEffect(() => {
    const consulta = window.matchMedia('(hover: hover) and (pointer: fine)');
    setPunteroFino(consulta.matches);

    // Se escucha el cambio: enchufar un mouse a una tablet, o pasar a modo tableta en un
    // convertible, cambia la respuesta sin recargar la página.
    const alCambiar = (e: MediaQueryListEvent) => setPunteroFino(e.matches);
    consulta.addEventListener('change', alCambiar);
    return () => consulta.removeEventListener('change', alCambiar);
  }, []);

  // Al montar, respetar ?variante=<sku> si apunta a una variante existente.
  useEffect(() => {
    const sku = new URLSearchParams(window.location.search).get('variante');
    if (!sku) return;
    const i = variantes.findIndex((v) => v.sku === sku);
    if (i > 0) {
      setIVariante(i);
      setIImagen(0);
    }
  }, []);

  /**
   * Abrir y cerrar el `<dialog>` de verdad, y no con una clase de CSS.
   *
   * `showModal()` da gratis tres cosas que a mano se hacen mal: la capa superior —queda
   * arriba de todo sin pelear con `z-index`—, el foco atrapado adentro mientras esta
   * abierto, y Esc. Ademas devuelve el foco al boton que lo abrio al cerrarse, que es lo
   * que hace que se pueda usar con el teclado sin perderse.
   */
  useEffect(() => {
    const d = visor.current;
    if (!d) return;
    if (ampliada && !d.open) d.showModal();
    if (!ampliada && d.open) d.close();
  }, [ampliada]);

  /**
   * El fondo no se scrollea mientras el visor esta abierto.
   *
   * `showModal()` bloquea los clics del fondo pero no la rueda del mouse ni el arrastre en
   * tactil: sin esto, mover el dedo para ver la foto corre la pagina de atras y al cerrar
   * aparecés en otro lugar del que estabas.
   */
  useEffect(() => {
    if (!ampliada) return;
    const raiz = document.documentElement;
    const previo = raiz.style.overflow;
    raiz.style.overflow = 'hidden';
    return () => {
      raiz.style.overflow = previo;
    };
  }, [ampliada]);

  const variante = variantes[iVariante];
  if (!variante) return null;

  const imagenes = variante.imagenes;
  const imagen = imagenes[iImagen] ?? imagenes[0];

  /** Moverse entre las fotos de ESTE color. Da la vuelta en los extremos. */
  function mover(paso: 1 | -1) {
    setIImagen((i) => fotoVecina(i, imagenes.length, paso));
  }

  /**
   * La lupa sigue al cursor.
   *
   * SE ESCRIBE EN EL DOM A MANO Y NO POR ESTADO, y es la única vez que este archivo lo hace.
   * `mousemove` dispara decenas de veces por segundo: un `setState` por evento re-renderiza
   * la isla entera —galería, miniaturas, selector de color y el enlace de WhatsApp— para
   * mover un círculo. Acá se toca sólo el estilo de dos nodos.
   *
   * LA LUPA SIGUE AL CURSOR SIN ACOTARSE, y lo que se recorta contra el borde de la foto es
   * el círculo —el marco de la ficha ya es `overflow-hidden`—.
   *
   * Se probó acotarla para que el círculo entrara siempre completo, y con la lupa chica
   * funcionaba. Con los 347 px del proveedor deja de funcionar: sobre una columna de 530
   * quedan 183 px de recorrido, así que la lupa se siente trabada. Lo que sí se acota es el
   * DESPLAZAMIENTO de la imagen ampliada, que es lo que evita ver vacío adentro del vidrio.
   */
  function seguirConLaLupa(e: MouseEvent) {
    const c = caja.current;
    const l = lente.current;
    const img = ampliadaEnLente.current;
    if (!c || !l || !img) return;

    const marco = c.getBoundingClientRect();
    const lado = marco.width;

    // El tamaño de la imagen ampliada depende del lado renderizado, que sólo se conoce acá:
    // la columna de la ficha cambia con el viewport.
    const ampliado = lado * FACTOR_LENTE;
    img.style.width = `${ampliado}px`;
    img.style.height = `${ampliado}px`;

    const cursorX = e.clientX - marco.left;
    const cursorY = e.clientY - marco.top;

    // Centrada en el cursor, sin acotar: el círculo se recorta contra el marco de la foto.
    l.style.left = `${cursorX - DIAMETRO_LENTE / 2}px`;
    l.style.top = `${cursorY - DIAMETRO_LENTE / 2}px`;

    const { x, y } = encuadreDeLente({
      cursorX,
      cursorY,
      lado,
      diametro: DIAMETRO_LENTE,
      factor: FACTOR_LENTE,
    });
    img.style.left = `${x}px`;
    img.style.top = `${y}px`;
  }

  function mostrarLupa(mostrar: boolean) {
    if (lente.current) lente.current.hidden = !mostrar;
  }

  function elegir(i: number) {
    setIVariante(i);
    setIImagen(0);
    const sku = variantes[i]?.sku;
    if (!sku) return;
    // replaceState y no pushState: cambiar de color no deberia llenar el
    // historial ni romper el boton "atras" del navegador.
    const u = new URL(window.location.href);
    if (i === 0) u.searchParams.delete('variante');
    else u.searchParams.set('variante', sku);
    window.history.replaceState({}, '', u);
  }

  const enlaceWa = construirEnlaceWa({
    telefono,
    nombre,
    url,
    color: variantes.length > 1 ? variante.color : undefined,
    codigo,
  });

  return (
    <div class="flex flex-col gap-4">
      {imagen ? (
        <div
          ref={caja}
          class={`bg-superficie border-borde relative overflow-hidden rounded border ${
            punteroFino ? 'cursor-crosshair' : ''
          }`}
          {...(punteroFino
            ? {
                // Se posiciona en el mismo evento de entrada: si esperara al primer
                // `mousemove`, el círculo aparece un fotograma sin nada adentro.
                onMouseEnter: (e: MouseEvent) => {
                  mostrarLupa(true);
                  seguirConLaLupa(e);
                },
                onMouseLeave: () => mostrarLupa(false),
                onMouseMove: seguirConLaLupa,
              }
            : {})}
        >
          <div class="aspect-square w-full">
            <img
              src={urlImagen(r2Base, imagen, anchoMayor(imagen))}
              srcset={srcSetImagen(r2Base, imagen)}
              sizes={SIZES_FICHA}
              width={anchoMayor(imagen)}
              height={anchoMayor(imagen)}
              alt={`${nombre} — ${variante.color}`}
              loading="eager"
              class="h-full w-full object-contain"
            />
          </div>

          {/**
           * LA LUPA. Un vidrio circular con la misma foto ampliada adentro.
           *
           * `object-contain` en la de adentro igual que en la de afuera, y sobre una caja
           * cuadrada de `lado * factor`: así el recuadro que deja una foto que no es cuadrada
           * —hay unas veinte de 800×600— cae en el mismo lugar y la lupa no muestra la región
           * corrida. Es la razón de que sea un `<img>` y no un `background-image`, donde esa
           * cuenta habría que hacerla a mano.
           *
           * `max-w-none` NO es decorativo: el preflight de Tailwind le pone
           * `max-width: 100%` a todo `<img>`, que acá significaría «no más grande que la
           * lupa» y le comería el ampliado justo a la única imagen que lo necesita.
           *
           * Y es la MISMA URL que la foto de la ficha: sale de la caché, no cuesta un request.
           */}
          {punteroFino && (
            <div
              ref={lente}
              hidden
              aria-hidden="true"
              class="pointer-events-none absolute overflow-hidden rounded-full"
              style={{
                width: `${DIAMETRO_LENTE}px`,
                height: `${DIAMETRO_LENTE}px`,
                boxShadow: SOMBRA_LENTE,
              }}
            >
              <img
                ref={ampliadaEnLente}
                src={urlImagen(r2Base, imagen, anchoMayor(imagen))}
                alt=""
                class="absolute max-w-none object-contain"
              />
            </div>
          )}

          {/**
           * El visor a pantalla completa, SÓLO en táctil.
           *
           * Con puntero fino manda la lupa: dos gestos para lo mismo sobre la misma foto es
           * uno de más. En un celular no hay lupa posible —no hay hover— y ahí el visor es
           * la única forma de sacar la foto de entre el precio y la descripción.
           *
           * Va ENCIMA y no envuelve al `<img>`: así el elemento de la imagen es idéntico
           * antes y después de hidratar y el navegador no la vuelve a pedir, que importa
           * porque es el LCP de esta página. Ver la nota de `montado`.
           */}
          {montado && !punteroFino && (
            <button
              type="button"
              onClick={() => setAmpliada(true)}
              aria-label={`Ver la foto de ${variante.color} en grande`}
              class="absolute inset-0 cursor-zoom-in"
            >
              {/* El icono es la unica pista de que la foto se puede abrir: sin el, el
                  visor existe y nadie se enteraria. `aria-hidden` porque el boton ya
                  tiene su nombre accesible. */}
              <span
                class="bg-superficie/90 text-texto-suave border-borde absolute right-2 bottom-2 rounded-full border p-2"
                aria-hidden="true"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-4.5-4.5M11 8v6M8 11h6" />
                </svg>
              </span>
            </button>
          )}
        </div>
      ) : (
        <SinFoto />
      )}

      {imagenes.length > 1 && (
        <ul class="flex gap-2">
          {imagenes.map((img, i) => (
            <li key={img.base}>
              <button
                type="button"
                onClick={() => setIImagen(i)}
                aria-label={`Ver imagen ${i + 1} de ${imagenes.length}`}
                aria-current={i === iImagen}
                class={`bg-superficie h-16 w-16 overflow-hidden rounded border ${
                  i === iImagen ? 'border-primario' : 'border-borde'
                }`}
              >
                <img
                  src={urlImagen(r2Base, img, Math.min(...img.anchos))}
                  width={300}
                  height={300}
                  alt=""
                  loading="lazy"
                  class="h-full w-full object-contain"
                />
              </button>
            </li>
          ))}
        </ul>
      )}

      {variantes.length > 1 && (
        <div class="flex flex-col gap-2">
          <p class="text-sm">
            Color: <strong>{variante.color}</strong>
          </p>
          <ul class="flex flex-wrap gap-2">
            {variantes.map((v, i) => (
              <li key={v.sku}>
                <button
                  type="button"
                  onClick={() => elegir(i)}
                  aria-current={i === iVariante}
                  title={v.color}
                  class={`flex items-center gap-2 rounded border px-2 py-1 text-sm ${
                    i === iVariante
                      ? 'border-primario text-texto'
                      : 'border-borde text-texto-suave'
                  }`}
                >
                  {/* Sin colorHex el selector cae a boton con texto (SPEC §4.2) */}
                  {v.colorHex && (
                    <span
                      class="border-borde h-4 w-4 shrink-0 rounded-full border"
                      style={{ background: v.colorHex }}
                      aria-hidden="true"
                    />
                  )}
                  {v.color}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <a
        href={enlaceWa}
        target="_blank"
        rel="noopener"
        class="bg-primario flex items-center justify-center gap-2 rounded px-4 py-3 font-medium text-white"
      >
        {/* Fondo --color-primario con texto blanco = 6.95:1, AA. El verde de
            WhatsApp daria 1.83:1 con blanco encima (SPEC §3.2). */}
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
          <path
            d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21 5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zm5.79 14.01c-.24.68-1.4 1.3-1.93 1.35-.53.05-1.03.24-3.47-.72-2.94-1.16-4.79-4.22-4.94-4.42-.14-.19-1.17-1.56-1.17-2.98 0-1.41.74-2.11 1-2.4.26-.29.57-.36.77-.36.19 0 .39 0 .55.01.19.01.43-.07.67.51.24.58.82 2 .89 2.14.07.14.12.31.02.5-.09.19-.19.31-.38.53-.19.22-.3.31-.44.5-.14.19-.28.4-.12.68.16.29.72 1.19 1.55 1.93 1.06.95 1.95 1.25 2.24 1.39.29.14.46.12.63-.07.17-.19.72-.84.91-1.13.19-.29.39-.24.65-.14.26.09 1.66.78 1.95.93.29.14.48.22.55.34.07.12.07.7-.17 1.38z"
          />
        </svg>
        Consultar por WhatsApp
      </a>

      {/**
       * El visor.
       *
       * Se rinde SOLO despues de hidratar y solo si hay foto: un `<dialog>` cerrado en el
       * HTML del servidor es invisible, pero seria markup que nunca va a poder abrirse.
       *
       * `onClose` sincroniza el estado con la realidad del elemento, y hace falta de
       * verdad: Esc lo cierra por su cuenta, sin pasar por ningun `onClick` nuestro. Sin
       * esto el estado quedaria en «abierta» sobre un visor cerrado, y el segundo clic en
       * la foto no haria nada.
       */}
      {montado && !punteroFino && imagen && (
        <dialog
          ref={visor}
          onClose={() => setAmpliada(false)}
          onClick={(e) => {
            // Un clic en el fondo tiene al `<dialog>` como blanco; uno en la foto o en los
            // botones tiene al hijo. Es lo que distingue «cerrar» de «usar».
            if (e.target === visor.current) setAmpliada(false);
          }}
          onKeyDown={(e) => {
            if (imagenes.length < 2) return;
            if (e.key === 'ArrowRight') {
              e.preventDefault();
              mover(1);
            }
            if (e.key === 'ArrowLeft') {
              e.preventDefault();
              mover(-1);
            }
          }}
          aria-label={`${nombre} — ${variante.color}`}
          class="m-auto max-h-none max-w-none bg-transparent p-0 backdrop:bg-black/80"
        >
          {/**
           * LOS CONTROLES VAN ENCIMA DE LA FOTO, no en una fila abajo.
           *
           * En un celular la altura es lo escaso: una fila de botones al pie le sacaba a la
           * foto unos 60 px de los ~700 que hay, y la foto es lo unico que se vino a ver.
           * Flotando sobre las esquinas no le quitan nada.
           *
           * El `onClick` con la guarda de `target` es el cierre por fondo, y hace falta
           * ACA y no solo en el `<dialog>`: este `<div>` cubre los 100dvh x 100vw, asi que
           * no queda ni un pixel del dialogo al descubierto para recibir ese clic. Tocar el
           * aire alrededor de la foto cierra; tocar la foto no, que es lo que permite hacer
           * pinch sin que se cierre en la cara.
           */}
          <div
            ref={fondoVisor}
            onClick={(e) => {
              if (e.target === fondoVisor.current) setAmpliada(false);
            }}
            class="relative flex h-[100dvh] w-[100vw] items-center justify-center p-3"
          >
            {/**
             * El tope de ampliacion sale de la imagen y no de la pantalla: 600 px de origen
             * estirados a un monitor de 1.400 son los mismos pixeles mas gordos. Con el
             * tope, en una pantalla grande la foto queda centrada con aire alrededor.
             *
             * La misma URL que la ficha, para que salga de la cache y no cueste un request.
             */}
            <img
              src={urlImagen(r2Base, imagen, anchoMayor(imagen))}
              width={anchoMayor(imagen)}
              height={anchoMayor(imagen)}
              alt={`${nombre} — ${variante.color}`}
              class="max-h-full max-w-full object-contain"
              style={{ maxWidth: `${topeDeAmpliacion(imagen)}px` }}
            />

            {/**
             * Fondo negro translucido con texto blanco, y no los colores del sitio: lo que
             * hay detras de estos botones es una foto cualquiera, asi que el contraste no
             * puede depender de que la foto sea clara. `min-h-11` son los 44 px que necesita
             * un dedo.
             *
             * DICE «CERRAR» Y NO ES UNA «×», y no es solo preferencia. Una `×` de texto no
             * esta centrada dentro de su propia caja de glifo, asi que `place-items-center`
             * la centra correctamente y IGUAL se ve corrida — el defecto es de la tipografia,
             * no del layout, y por eso no se arregla con clases. Una palabra no tiene ese
             * problema, y de paso no hay que adivinar que significa.
             */}
            <button
              type="button"
              onClick={() => setAmpliada(false)}
              class="absolute top-4 right-4 min-h-11 rounded-full bg-black/60 px-4 text-sm font-medium text-white"
            >
              Cerrar
            </button>

            {imagenes.length > 1 && (
              <>
                {/**
                 * Las flechas son SVG y no los glifos `‹` `›`, por el mismo motivo que el
                 * boton de arriba dejo de ser una `×`: un glifo tipografico no esta centrado
                 * en su caja y termina corrido dentro del circulo. Un `<svg>` tiene geometria
                 * exacta y queda centrado siempre.
                 */}
                <button
                  type="button"
                  onClick={() => mover(-1)}
                  aria-label="Foto anterior"
                  class="absolute top-1/2 left-2 grid min-h-11 min-w-11 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white"
                >
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M15 6l-6 6 6 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => mover(1)}
                  aria-label="Foto siguiente"
                  class="absolute top-1/2 right-2 grid min-h-11 min-w-11 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white"
                >
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
                {/* `aria-live` porque al cambiar de foto no se mueve el foco: sin esto,
                    apretar la flecha no anuncia nada. */}
                <p
                  class="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-sm text-white"
                  aria-live="polite"
                >
                  {iImagen + 1} de {imagenes.length}
                </p>
              </>
            )}
          </div>
        </dialog>
      )}
    </div>
  );
}
