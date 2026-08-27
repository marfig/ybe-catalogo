import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import type { EntradaIndice } from '../../lib/buscar.ts';
import { urlImagen, type Imagen } from '../../lib/imagenes.ts';
import {
  FORMAS_PAGO,
  enlacePedidoWa,
  leerContextoPedido,
  validarPedido,
  type ContextoPedido,
  type DatosPedido,
  type ErroresPedido,
  type FormaPago,
} from '../../lib/pedido.ts';
import { formatearGs } from '../../lib/precio.ts';
import { CUENTA_BANCARIA, LEYENDA_PRECIO, SIN_PRECIO } from '../../lib/sitio.ts';
import IconoWhatsApp from '../IconoWhatsApp.tsx';

/**
 * El formulario de pedido (`/pedir`).
 *
 * ES UNA ISLA Y NO UNA PÁGINA POR PRODUCTO, y esa es la decisión de fondo. Una ruta
 * `/pedir/<slug>` generaría una página estática por cada uno de los ~1.500 productos
 * para renderizar el MISMO formulario con tres palabras distintas arriba. Una sola
 * página que lee `?p=<slug>` cuesta un archivo.
 *
 * QUÉ VIVE ACÁ Y QUÉ NO: la forma del mensaje, la validación y el enlace están en
 * `lib/pedido.ts`, que es puro y tiene tests. Acá queda lo que no se puede probar sin
 * navegador — leer la query string, bajar el índice, el estado de los campos.
 *
 * VISIÓN INICIAL: los campos y el envío están puestos para verse y discutirse, no
 * cerrados. El punto que sí conviene mirar antes que el resto es a dónde se manda el
 * pedido: hoy va por WhatsApp con los datos ya cargados, porque el sitio es
 * `output: 'static'` y no hay dónde recibir un POST (ver `enlacePedidoWa`).
 */

interface Props {
  /** Base pública de R2, para la miniatura del producto. */
  r2Base: string;
  /** Teléfono del comercio, ya normalizado por la página. */
  telefono: string;
  /** Origen del sitio, para armar la URL canónica del producto en el mensaje. */
  origen: string;
}

/** Los campos arrancan vacíos menos la cantidad, que casi siempre es 1. */
const VACIO: DatosPedido = {
  nombre: '',
  telefono: '',
  direccion: '',
  ciudad: '',
  referencia: '',
  cantidad: 1,
  // Sin preseleccionar: ver el comentario de `pago` en `DatosPedido`.
  pago: null,
  // Con default, al contrario de `pago`: la asimetría está justificada en `DatosPedido`.
  factura: false,
  ruc: '',
  razonSocial: '',
  notas: '',
};

type Estado = 'cargando' | 'listo' | 'sin-producto';

/**
 * La miniatura se arma con la misma convención que el resto del sitio: el índice
 * guarda sólo el hash, sin prefijo ni ancho.
 *
 * 300 y no 600: es el único ancho que TODA imagen tiene garantizado —el 600 depende
 * de que el origen lo tuviera (`content.config.ts`)—, y acá se renderiza a 64 px.
 */
const ANCHO_MINIATURA = 300;

function imagenDeIndice(hash: string): Imagen {
  return { base: `catalogo/${hash}`, anchos: [ANCHO_MINIATURA] };
}

/**
 * Los íconos de las formas de pago.
 *
 * DE TRAZO Y NO RELLENOS, como la lupa del buscador y las flechas del visor: heredan
 * `currentColor`, así que acompañan al texto de la píldora y no pueden desincronizarse
 * del contraste que esa píldora calculó.
 *
 * Viven acá y no en `lib/pedido.ts` porque son JSX: la lista de formas de pago es un
 * dato puro con tests, y meterle marcado la ataría a Preact para siempre.
 *
 * `aria-hidden`: son decoración. Lo que nombra la opción es el texto al lado.
 */
const TRAZO = {
  viewBox: '0 0 24 24',
  width: 18,
  height: 18,
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.8,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  'aria-hidden': true,
  class: 'shrink-0',
} as const;

/**
 * Efectivo: un billete, EN VERDE. El círculo del medio es lo que lo hace leer como
 * plata, y el verde es lo que hace que se entienda antes de leer la palabra.
 *
 * `emerald-600` y NO `--color-whatsapp`. Los dos son verdes y la tentación de
 * reusar el token es real, pero ese token existe para UNA cosa: que el botón de
 * WhatsApp se reconozca como WhatsApp. Usarlo acá lo convertiría en «el verde», y el
 * día que WhatsApp cambie su verde, este billete cambia con él sin motivo.
 *
 * Sobre --color-fondo da 3.63:1 y sobre la píldora elegida 3.44:1. El mínimo de un
 * objeto gráfico es 3:1 —no 4.5:1, que es el de texto—, así que pasa en los dos
 * fondos. Un verde más vivo (el #25d366 de WhatsApp, por ejemplo) daría 1.9:1 y el
 * billete se perdería contra el blanco.
 */
function IconoEfectivo() {
  return (
    <svg {...TRAZO} class="shrink-0 text-emerald-600">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M5.5 12h.01M18.5 12h.01" />
    </svg>
  );
}

/**
 * Transferencia: la fachada de un banco.
 *
 * Se probó primero con dos flechas cruzadas —«movimiento de un lado a otro», que es
 * lo que la palabra significa literalmente— y no era lo que se necesitaba: una flecha
 * puede ser cualquier cosa que se mueva, y acá hay que decir «de banco a banco» de un
 * vistazo. El frontón con columnas es lo que nadie tiene que aprender.
 *
 * TRES COLUMNAS Y NO CINCO, y el techo es una línea quebrada y no un triángulo
 * relleno: a 18 px cada trazo que se agrega es un trazo que se junta con el de al
 * lado y el ícono se vuelve una mancha. Con tres columnas separadas queda aire entre
 * ellas incluso en la mitad de ese tamaño.
 */
function IconoTransferencia() {
  return (
    <svg {...TRAZO}>
      <path d="M3 9.5 12 4.5l9 5" />
      <path d="M6 10v7M12 10v7M18 10v7" />
      <path d="M3.5 19.5h17" />
    </svg>
  );
}

/**
 * QR: las tres marcas de esquina de un código, sin la trama del medio.
 *
 * Lo que hace reconocible un QR son los tres cuadrados de las esquinas —son los que le
 * dicen al lector dónde está y cómo está girado—, no el ruido del centro. Dibujar la
 * trama a 18 px daría una mancha gris; con las esquinas y unos pocos módulos sueltos se
 * lee como QR incluso al tamaño de un favicon.
 */
function IconoQr() {
  return (
    <svg {...TRAZO}>
      <rect x="3" y="3" width="6.5" height="6.5" rx="1" />
      <rect x="14.5" y="3" width="6.5" height="6.5" rx="1" />
      <rect x="3" y="14.5" width="6.5" height="6.5" rx="1" />
      <path d="M14.5 14.5h2.5M21 14.5v2.5M17 21h4M14.5 18.5v2.5" />
    </svg>
  );
}

/** Qué ícono le toca a cada forma de pago. */
const ICONO_PAGO: Record<FormaPago, () => JSX.Element> = {
  efectivo: IconoEfectivo,
  transferencia: IconoTransferencia,
  qr: IconoQr,
};

export default function FormularioPedido({ r2Base, telefono, origen }: Props) {
  const [contexto, setContexto] = useState<ContextoPedido | null>(null);
  const [entrada, setEntrada] = useState<EntradaIndice | null>(null);
  const [estado, setEstado] = useState<Estado>('cargando');
  const [datos, setDatos] = useState<DatosPedido>(VACIO);

  /**
   * `enviado` distingue «todavía no tocó nada» de «mandó y falta algo».
   *
   * Sin esto, la única forma de mostrar errores es marcarlos mientras escribe: el campo
   * de teléfono queda en rojo desde el primer dígito, cuando lo único que pasa es que
   * la persona no terminó de tipear. Los errores aparecen recién al primer envío.
   */
  const [enviado, setEnviado] = useState(false);

  /**
   * Qué se acaba de copiar, y si salió bien.
   *
   * Se guarda la CLAVE del dato y no un booleano suelto: con dos botones de copiar, un
   * `copiado: true` haría que el cartelito apareciera en los dos a la vez.
   */
  const [copiado, setCopiado] = useState<{ clave: string; ok: boolean } | null>(null);

  // El cartelito se borra solo. Sin esto queda «¡Copiado!» para siempre al lado de un
  // dato que la persona copió hace cinco minutos, y deja de significar algo.
  useEffect(() => {
    if (!copiado) return;
    const t = setTimeout(() => setCopiado(null), 2500);
    return () => clearTimeout(t);
  }, [copiado]);

  useEffect(() => {
    const ctx = leerContextoPedido(window.location.search);
    if (!ctx) {
      setEstado('sin-producto');
      return;
    }
    setContexto(ctx);

    /**
     * El producto se resuelve contra `/indice.json`, que ya existe para el buscador.
     *
     * Si el índice no baja, EL FORMULARIO SIGUE SIRVIENDO: el slug está en la URL y es
     * lo que arma el enlace del producto en el mensaje. Se pierde el nombre y el
     * precio en pantalla, no la posibilidad de pedir.
     */
    (async () => {
      try {
        const r = await fetch('/indice.json');
        if (!r.ok) throw new Error(String(r.status));
        const indice = (await r.json()) as EntradaIndice[];
        setEntrada(indice.find((e) => e.i === ctx.slug) ?? null);
      } catch {
        setEntrada(null);
      } finally {
        setEstado('listo');
      }
    })();
  }, []);

  const errores: ErroresPedido = enviado ? validarPedido(datos) : {};
  const urlProducto = contexto ? `${origen}/productos/${contexto.slug}` : origen;

  function cambiar<C extends keyof DatosPedido>(campo: C, valor: DatosPedido[C]) {
    setDatos((d) => ({ ...d, [campo]: valor }));
  }

  /**
   * Copia un dato al portapapeles.
   *
   * `navigator.clipboard` EXIGE CONTEXTO SEGURO y puede fallar por permisos, así que el
   * fallo no es hipotético. No se lo tapa: se avisa «copialo a mano», que es lo que la
   * persona puede hacer —el dato está a la vista— en vez de quedarse esperando un
   * cartelito que no llega.
   */
  async function copiar(clave: string, valor: string) {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado({ clave, ok: true });
    } catch {
      setCopiado({ clave, ok: false });
    }
  }

  function enviar(e: Event) {
    e.preventDefault();
    setEnviado(true);
    if (Object.keys(validarPedido(datos)).length > 0) return;

    window.location.href = enlacePedidoWa({
      telefono,
      producto: {
        nombre: entrada?.n ?? contexto?.slug ?? '',
        url: urlProducto,
        codigo: entrada?.k,
        color: contexto?.color,
      },
      datos,
    });
  }

  if (estado === 'sin-producto') {
    return (
      <div class="bg-superficie border-borde rounded border p-6">
        <h1 class="text-lg font-semibold">Elegí un producto primero</h1>
        <p class="text-texto-suave mt-2 text-sm">
          El pedido se hace desde la ficha del producto, con el botón «Pedí ahora».
        </p>
        <a href="/" class="bg-accion mt-4 inline-block rounded px-4 py-2 font-medium text-white">
          Ver el catálogo
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} novalidate class="flex flex-col gap-5">
      {/**
       * EL PRODUCTO ARRIBA Y NO AL PIE. Es la confirmación de que se está pidiendo lo
       * que se quiso pedir, y si aparece después de nueve campos ya nadie la mira. En
       * pantalla ancha queda a la derecha, fija al costado de los campos.
       */}
      <div class="bg-superficie border-borde flex items-center gap-3 rounded border p-3">
        {entrada?.t ? (
          <img
            src={urlImagen(r2Base, imagenDeIndice(entrada.t), ANCHO_MINIATURA)}
            width={ANCHO_MINIATURA}
            height={ANCHO_MINIATURA}
            alt=""
            class="h-16 w-16 shrink-0 rounded object-contain"
          />
        ) : (
          <div class="bg-fondo border-borde h-16 w-16 shrink-0 rounded border" aria-hidden="true" />
        )}

        <div class="min-w-0 flex-1">
          {estado === 'cargando' ? (
            <p class="text-texto-suave text-sm">Cargando el producto…</p>
          ) : (
            <>
              <p class="truncate font-medium">{entrada?.n ?? 'Producto del catálogo'}</p>
              <p class="text-texto-suave text-xs">
                {entrada?.k && (
                  <>
                    Código: <code class="text-texto">{entrada.k}</code>
                  </>
                )}
                {contexto?.color && <> · {contexto.color}</>}
              </p>
              <p class="mt-0.5 text-sm font-semibold">
                {entrada?.p != null ? formatearGs(entrada.p) : SIN_PRECIO}
              </p>
            </>
          )}
        </div>

        {contexto && (
          <a href={`/productos/${contexto.slug}`} class="text-texto-suave shrink-0 text-xs underline">
            Ver ficha
          </a>
        )}
      </div>

      {entrada?.p != null && <p class="text-texto-suave -mt-3 text-xs">{LEYENDA_PRECIO}</p>}

      <fieldset class="flex flex-col gap-4">
        <legend class="text-base font-semibold">Tus datos</legend>

        <Campo
          id="nombre"
          etiqueta="Nombre y apellido"
          valor={datos.nombre}
          error={errores.nombre}
          alCambiar={(v) => cambiar('nombre', v)}
          autocomplete="name"
        />

        {/**
         * `type="tel"` y no `text`: en un teléfono abre el teclado numérico, que es la
         * diferencia entre cargar el número de una y buscar los dígitos.
         *
         * No hay `pattern`: el formato paraguayo se escribe de cinco maneras y todas son
         * válidas. Lo que importa —que haya suficientes dígitos— lo mide `validarPedido`.
         */}
        <Campo
          id="telefono"
          etiqueta="Teléfono (WhatsApp)"
          tipo="tel"
          valor={datos.telefono}
          error={errores.telefono}
          alCambiar={(v) => cambiar('telefono', v)}
          autocomplete="tel"
          ayuda="Es el número por el que te vamos a confirmar el pedido."
        />
      </fieldset>

      <fieldset class="flex flex-col gap-4">
        <legend class="text-base font-semibold">Dónde lo entregamos</legend>

        <Campo
          id="direccion"
          etiqueta="Dirección"
          valor={datos.direccion}
          error={errores.direccion}
          alCambiar={(v) => cambiar('direccion', v)}
          autocomplete="street-address"
          ayuda="Calle, número y la esquina más cercana."
        />

        <Campo
          id="ciudad"
          etiqueta="Ciudad o barrio"
          valor={datos.ciudad}
          error={errores.ciudad}
          alCambiar={(v) => cambiar('ciudad', v)}
          autocomplete="address-level2"
        />

        <Campo
          id="referencia"
          etiqueta="Referencia"
          opcional
          valor={datos.referencia ?? ''}
          alCambiar={(v) => cambiar('referencia', v)}
          ayuda="Algo que ayude a encontrarte: un portón, un color, un local al lado."
        />
      </fieldset>

      <fieldset class="flex flex-col gap-4">
        <legend class="text-base font-semibold">El pedido</legend>

        <div class="flex flex-col gap-1">
          <label for="cantidad" class="text-sm font-medium">
            Cantidad
          </label>
          {/* `w-24`: un campo de ancho completo para un número de un dígito le dice a la
              persona que se esperan cuatro cifras. El ancho es parte de la instrucción. */}
          <input
            id="cantidad"
            name="cantidad"
            type="number"
            min="1"
            step="1"
            inputmode="numeric"
            value={String(Number.isFinite(datos.cantidad) ? datos.cantidad : '')}
            onInput={(e) => cambiar('cantidad', (e.target as HTMLInputElement).valueAsNumber)}
            class={`bg-superficie w-24 rounded border px-3 py-2 ${
              errores.cantidad ? 'border-red-600' : 'border-borde'
            }`}
            aria-invalid={errores.cantidad ? 'true' : undefined}
            aria-describedby={errores.cantidad ? 'cantidad-error' : undefined}
          />
          {errores.cantidad && (
            <p id="cantidad-error" class="text-sm text-red-700">
              {errores.cantidad}
            </p>
          )}
        </div>

        {/**
         * RADIOS Y NO UN `<select>`. Son dos opciones: en un desplegable quedan
         * escondidas detrás de un toque y la persona no sabe qué se le ofrece hasta
         * abrirlo. Acá las dos se ven, y elegir es un toque en vez de tres.
         *
         * `<fieldset>` anidado con su `<legend>`: es lo que le da a un grupo de radios
         * un nombre accesible. Sin eso, un lector de pantalla anuncia «Efectivo» sin
         * decir de qué pregunta es una respuesta.
         */}
        <fieldset>
          <legend class="text-sm font-medium">Forma de pago</legend>

          <div
            class="mt-1.5 flex flex-wrap gap-2"
            role="radiogroup"
            aria-invalid={errores.pago ? 'true' : undefined}
            aria-describedby={errores.pago ? 'pago-error' : undefined}
          >
            {FORMAS_PAGO.map((forma) => {
              const elegida = datos.pago === forma.valor;
              const Icono = ICONO_PAGO[forma.valor];
              return (
                /**
                 * El `<input>` real está adentro del `<label>` y oculto con `sr-only`,
                 * no con `display:none`: sigue existiendo para el teclado y para los
                 * lectores de pantalla —flechas para moverse entre opciones, que es
                 * como se espera que funcione un grupo de radios—, y lo que se ve es
                 * la píldora. Un `<div onClick>` habría perdido las dos cosas.
                 */
                <label
                  key={forma.valor}
                  /**
                   * La opción elegida NO se distingue sólo por color: cambia también el
                   * grosor del borde y el peso del texto. Un daltónico y una pantalla en
                   * pleno sol tienen el mismo problema, y ese problema no lo arregla
                   * elegir un azul mejor.
                   */
                  class={`flex min-h-11 cursor-pointer items-center gap-2 rounded px-4 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 ${
                    elegida
                      ? 'border-accion text-texto border-2 bg-blue-50 font-medium'
                      : errores.pago
                        ? 'text-texto-suave border border-red-600'
                        : 'border-borde text-texto-suave border'
                  }`}
                >
                  <input
                    type="radio"
                    name="pago"
                    value={forma.valor}
                    checked={elegida}
                    onChange={() => cambiar('pago', forma.valor as FormaPago)}
                    class="sr-only"
                  />
                  <Icono />
                  {forma.etiqueta}
                </label>
              );
            })}
          </div>

          {errores.pago && (
            <p id="pago-error" class="mt-1 text-sm text-red-700">
              {errores.pago}
            </p>
          )}

          {/**
           * Los datos de la cuenta, SÓLO con transferencia elegida.
           *
           * Adentro del mismo `<fieldset>` y pegados a las píldoras a propósito: es la
           * consecuencia de la opción que se acaba de tocar, y separarlos en otra caja
           * más abajo obligaría a buscarlos.
           *
           * QR no muestra nada acá: ese código se manda por el chat, que es donde se
           * escanea.
           */}
          {datos.pago === 'transferencia' && (
            <div class="border-borde bg-superficie mt-3 rounded border p-3">
              {/**
               * El logo DEBAJO del título, no al costado.
               *
               * Al costado tenía que competir por el ancho con el texto, y eso le ponía
               * un techo de unos 80 px donde la palabra «BANCO» —que en esta marca es un
               * antetítulo chico— se volvía ilegible. En su propia línea puede usar el
               * ancho que necesite.
               *
               * EL LOGO REEMPLAZA AL TEXTO «Banco Atlas», no lo acompaña: decir la misma
               * cosa dos veces al lado no informa, sólo llena.
               *
               * `w-44` (176 px) es EL TECHO REAL Y NO UNA ELECCIÓN ESTÉTICA: el archivo
               * se recortó de una captura de 297 px de ancho, así que del logo hay 178 px
               * de información y nada más. Se guarda a 356 px —el doble— para que en una
               * pantalla retina salga nítido a este tamaño; pasar de acá empieza a
               * agrandar píxeles, no a mostrar detalle. Para más grande hace falta otro
               * archivo de origen.
               *
               * `width`/`height` con las medidas reales del archivo: sin eso el navegador
               * no sabe cuánto lugar reservar y la tarjeta salta cuando el logo carga,
               * justo cuando la persona está leyendo los dígitos.
               *
               * `alt` con el nombre del banco y no vacío: es el único lugar donde se dice
               * a qué banco se transfiere, así que para un lector de pantalla no es
               * decoración — es el dato.
               */}
              <p class="text-sm font-medium">Transferí a esta cuenta</p>
              <img
                src="/banco-atlas.png"
                width="356"
                height="72"
                alt={CUENTA_BANCARIA.banco}
                class="mt-2 h-auto w-44 max-w-full"
              />

              {/**
               * `<dl>` y no una tabla ni párrafos: son pares rótulo/valor, que es
               * literalmente lo que una lista de definiciones describe. Un lector de
               * pantalla anuncia «Cuenta, 555021663» en vez de leer dos textos sueltos y
               * dejar que la persona adivine cuál es de cuál.
               */}
              <dl class="mt-3 flex flex-col gap-2">
                <DatoBancario
                  rotulo="Cuenta"
                  valor={CUENTA_BANCARIA.numero}
                  clave="cuenta"
                  copiado={copiado}
                  alCopiar={copiar}
                />
                <DatoBancario rotulo="Nombre" valor={CUENTA_BANCARIA.titular} />
                <DatoBancario rotulo="C.I." valor={CUENTA_BANCARIA.cedula} />
                <DatoBancario
                  rotulo="Alias"
                  valor={CUENTA_BANCARIA.alias}
                  clave="alias"
                  copiado={copiado}
                  alCopiar={copiar}
                />
              </dl>

              {/**
               * El aviso del comprobante VA AL PIE, y el orden es el de los hechos: leer
               * los datos, transferir, y recién entonces guardar el comprobante. Arriba
               * era una instrucción para un paso que todavía no había llegado.
               *
               * Con una línea divisoria: separa «datos para copiar» de «qué hacer
               * después», que son dos cosas distintas y se estaban leyendo como una lista
               * de cinco renglones.
               */}
              <p class="border-borde text-texto-suave mt-3 border-t pt-2.5 text-xs">
                Guardá el comprobante: te lo vamos a pedir por WhatsApp.
              </p>
            </div>
          )}
        </fieldset>

        {/**
         * La factura: un tilde, y los dos campos aparecen sólo si dice sí.
         *
         * UN CHECKBOX Y NO DOS RADIOS «Sí / No». La pregunta tiene una respuesta por
         * defecto razonable —la mayoría no factura— y un tilde la expresa sin obligar a
         * contestar. En `pago` fue al revés justamente porque ahí no hay default honesto.
         *
         * LOS CAMPOS SE MONTAN Y DESMONTAN, no se deshabilitan: dos inputs grises
         * ocupando lugar le dicen a la persona «esto es para vos» cuando no lo es. Lo
         * TIPEADO se conserva en el estado —no se limpia al destildar—, así que quien
         * duda, destilda y vuelve a tildar no perdió el RUC. Por eso el mensaje consulta
         * `datos.factura` y no la presencia del RUC.
         */}
        <div class="border-borde flex flex-col gap-3 rounded border p-3">
          <label class="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={datos.factura}
              onChange={(e) => cambiar('factura', (e.target as HTMLInputElement).checked)}
              class="accent-accion mt-0.5 h-4 w-4 shrink-0"
            />
            <span>
              <span class="text-sm font-medium">Quiero factura</span>
              <span class="text-texto-suave block text-xs">
                Si no la pedís, el pedido sale sin factura.
              </span>
            </span>
          </label>

          {datos.factura && (
            <div class="flex flex-col gap-4 pt-1">
              <Campo
                id="ruc"
                etiqueta="RUC"
                valor={datos.ruc}
                error={errores.ruc}
                alCambiar={(v) => cambiar('ruc', v)}
                ayuda="Con el guion del dígito verificador. Ej.: 80012345-6."
              />

              <Campo
                id="razonSocial"
                etiqueta="Razón social"
                valor={datos.razonSocial}
                error={errores.razonSocial}
                alCambiar={(v) => cambiar('razonSocial', v)}
                autocomplete="organization"
                ayuda="El nombre exacto que tiene que salir en la factura."
              />
            </div>
          )}
        </div>

        <div class="flex flex-col gap-1">
          <label for="notas" class="text-sm font-medium">
            Nota <span class="text-texto-suave font-normal">(opcional)</span>
          </label>
          <textarea
            id="notas"
            name="notas"
            rows={3}
            value={datos.notas ?? ''}
            onInput={(e) => cambiar('notas', (e.target as HTMLTextAreaElement).value)}
            class="bg-superficie border-borde rounded border px-3 py-2"
            placeholder="Horario de entrega, otro color, cualquier cosa que quieras aclarar."
          />
        </div>
      </fieldset>

      {/**
       * El botón dice A DÓNDE VA y no «Enviar». El pedido se termina en WhatsApp —el
       * mensaje sale ya cargado, sin que la persona escriba nada—, y descubrir eso
       * DESPUÉS de tocar el botón es la clase de sorpresa que hace abandonar un
       * formulario. Verde de marca con texto blanco, igual que en la ficha.
       */}
      <div class="flex flex-col gap-2">
        <button
          type="submit"
          class="bg-whatsapp flex min-h-12 items-center justify-center gap-2 rounded px-4 py-3 font-medium text-white"
        >
          <IconoWhatsApp />
          Enviar el pedido por WhatsApp
        </button>

        {enviado && Object.keys(errores).length > 0 && (
          // Un resumen arriba del botón y no sólo la marca en cada campo: en móvil el
          // campo que falta puede estar tres pantallas más arriba.
          <p role="alert" class="text-sm text-red-700">
            Faltan datos para armar el pedido. Revisá los campos marcados.
          </p>
        )}

        <p class="text-texto-suave text-xs">
          Se abre el chat con el pedido ya escrito. Confirmás el envío ahí.
        </p>
      </div>
    </form>
  );
}

/**
 * Una fila de la cuenta bancaria: rótulo, valor y —si se puede copiar— su botón.
 *
 * EL VALOR VA EN MONOESPACIADO CON CIFRAS TABULARES, y no es decoración. Quien está
 * mirando esto tiene el formulario del banco abierto al lado y compara dígito por
 * dígito; con una tipografía proporcional el `1` es angosto y el `0` ancho, así que dos
 * números distintos se ven del mismo largo. Tabular les da a todos el mismo ancho.
 *
 * EL VALOR NO SE AGRUPA NI SE FORMATEA. Un `555 021 663` se lee mejor y se pega roto en
 * el formulario del banco, que es lo único que importa acá.
 */
function DatoBancario({
  rotulo,
  valor,
  clave,
  copiado,
  alCopiar,
}: {
  rotulo: string;
  valor: string;
  clave?: string | undefined;
  copiado?: { clave: string; ok: boolean } | null;
  alCopiar?: ((clave: string, valor: string) => void) | undefined;
}) {
  const esteCopiado = clave && copiado?.clave === clave ? copiado : null;

  return (
    <div class="flex items-center gap-2">
      <dt class="text-texto-suave w-16 shrink-0 text-xs">{rotulo}</dt>
      <dd class="min-w-0 flex-1 font-mono text-sm tabular-nums">{valor}</dd>

      {clave && alCopiar && (
        <div class="flex shrink-0 items-center gap-2">
          {/**
           * `aria-live="polite"` en un contenedor que SIEMPRE existe, no en el cartelito
           * que aparece y desaparece. Un `aria-live` que se monta junto con su texto no
           * se anuncia: la región tiene que estar ahí de antes para que el lector note
           * que cambió.
           */}
          <span aria-live="polite" class="text-xs">
            {esteCopiado?.ok === true && <span class="text-emerald-700">¡Copiado!</span>}
            {esteCopiado?.ok === false && (
              <span class="text-texto-suave">Copialo a mano</span>
            )}
          </span>

          <button
            type="button"
            onClick={() => alCopiar(clave, valor)}
            /* El nombre accesible dice QUÉ copia. Cuatro botones que dicen «Copiar» son
               cuatro botones idénticos para quien navega por lista de controles. */
            aria-label={`Copiar ${rotulo}`}
            class="border-borde text-texto-suave hover:border-accion hover:text-accion min-h-8 rounded border px-2 text-xs"
          >
            Copiar
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Un campo de texto con su etiqueta, su ayuda y su error.
 *
 * Existe porque los cinco campos de texto comparten exactamente el mismo cableado de
 * accesibilidad —`aria-invalid`, `aria-describedby` apuntando al id correcto— y ese es
 * justo el cableado que se escribe mal cuando se repite cinco veces a mano.
 */
function Campo({
  id,
  etiqueta,
  valor,
  alCambiar,
  error,
  ayuda,
  tipo = 'text',
  opcional = false,
  autocomplete,
}: {
  id: string;
  etiqueta: string;
  valor: string;
  alCambiar: (valor: string) => void;
  error?: string | undefined;
  ayuda?: string | undefined;
  tipo?: string;
  opcional?: boolean;
  autocomplete?: string | undefined;
}) {
  const idAyuda = ayuda ? `${id}-ayuda` : undefined;
  const idError = error ? `${id}-error` : undefined;

  return (
    <div class="flex flex-col gap-1">
      <label for={id} class="text-sm font-medium">
        {etiqueta}
        {opcional && <span class="text-texto-suave font-normal"> (opcional)</span>}
      </label>

      {/* La ayuda va ANTES del campo: leerla después de haber contestado no ayuda. */}
      {ayuda && (
        <p id={idAyuda} class="text-texto-suave text-xs">
          {ayuda}
        </p>
      )}

      <input
        id={id}
        name={id}
        type={tipo}
        value={valor}
        onInput={(e) => alCambiar((e.target as HTMLInputElement).value)}
        autocomplete={autocomplete}
        class={`bg-superficie rounded border px-3 py-2 ${error ? 'border-red-600' : 'border-borde'}`}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={[idAyuda, idError].filter(Boolean).join(' ') || undefined}
      />

      {error && (
        <p id={idError} class="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
