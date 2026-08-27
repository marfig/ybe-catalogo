/**
 * El logo de WhatsApp.
 *
 * Se extrajo de `SelectorVariante` cuando apareció el segundo botón que lo necesita
 * —el de enviar el pedido, en `FormularioPedido`—. Un `path` de 700 caracteres copiado
 * en dos islas es la clase de duplicado que nadie corrige: el día que el trazo cambie,
 * una de las dos copias se queda vieja y nadie lo nota.
 *
 * `currentColor` y no el verde: el ícono acompaña al texto del botón, así que hereda su
 * color y no puede desincronizarse del contraste que ese botón calculó.
 */
export default function IconoWhatsApp({ tamano = 20 }: { tamano?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={tamano}
      height={tamano}
      fill="currentColor"
      aria-hidden="true"
      class="shrink-0"
    >
      <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21 5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zm5.79 14.01c-.24.68-1.4 1.3-1.93 1.35-.53.05-1.03.24-3.47-.72-2.94-1.16-4.79-4.22-4.94-4.42-.14-.19-1.17-1.56-1.17-2.98 0-1.41.74-2.11 1-2.4.26-.29.57-.36.77-.36.19 0 .39 0 .55.01.19.01.43-.07.67.51.24.58.82 2 .89 2.14.07.14.12.31.02.5-.09.19-.19.31-.38.53-.19.22-.3.31-.44.5-.14.19-.28.4-.12.68.16.29.72 1.19 1.55 1.93 1.06.95 1.95 1.25 2.24 1.39.29.14.46.12.63-.07.17-.19.72-.84.91-1.13.19-.29.39-.24.65-.14.26.09 1.66.78 1.95.93.29.14.48.22.55.34.07.12.07.7-.17 1.38z" />
    </svg>
  );
}
