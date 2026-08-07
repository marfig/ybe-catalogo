import { useEffect, useState } from 'preact/hooks';

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

  const variante = variantes[iVariante];
  if (!variante) return null;

  const imagenes = variante.imagenes;
  const imagen = imagenes[iImagen] ?? imagenes[0];

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
        <div class="bg-superficie border-borde overflow-hidden rounded border">
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
    </div>
  );
}
