/**
 * Placeholder para variantes sin imagen (SPEC §5.4).
 *
 * Es un componente Preact y no .astro a proposito: lo necesitan tanto
 * ImagenProducto.astro (la card) como SelectorVariante.tsx (la ficha), y una
 * isla Preact no puede importar un .astro. Astro lo renderiza en el servidor
 * sin hidratar cuando se usa sin directiva client:.
 *
 * Antes existia duplicado en los dos lugares y ya habia divergido.
 *
 * NUNCA se renderiza un <img> roto, y NO se usa logo.png: 1.65 MB para un
 * placeholder es peor que nada, y del PNG no se puede aislar el monograma solo.
 *
 * El icono es un glifo de UI, no la marca: no depende de monograma.svg, que
 * sigue pendiente. Su unico trabajo es que el hueco se lea como una decision
 * ("este producto no tiene foto") y no como una carga fallida.
 *
 * El producto sigue visible y contactable: que no haya foto no lo saca del
 * catalogo.
 */
interface Props {
  /** En la card el espacio es chico: icono mas chico y sin la segunda linea. */
  compacto?: boolean;
}

export default function SinFoto({ compacto = false }: Props) {
  const lado = compacto ? 24 : 32;

  return (
    <div
      class="bg-fondo border-borde text-texto-suave flex aspect-square w-full flex-col items-center justify-center gap-2 rounded border border-dashed"
      role="img"
      aria-label="Producto sin imagen disponible"
    >
      <svg
        viewBox="0 0 24 24"
        width={lado}
        height={lado}
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        class="opacity-50"
      >
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="8.5" cy="9.5" r="1.5" />
        <path d="M21 15l-4.5-4.5L9 18" />
        <path d="M3 3l18 18" />
      </svg>

      <span class={compacto ? 'text-xs' : 'text-sm'}>Sin foto disponible</span>

      {!compacto && (
        <span class="text-xs opacity-75">Consultá por WhatsApp y te la enviamos</span>
      )}
    </div>
  );
}
