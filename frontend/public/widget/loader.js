// widget/loader.js — Embed script for external hotel websites.
// F2 2.13 (solmi-direct-booking) — Opción A: retrocompat del snippet viejo.
//
// Carga el NUEVO widget SPA (pages/public/booking-widget.vue) dentro de un <iframe>
// apuntando a /book/:slug?embed=1. Sirve el MISMO bundle SPA que la ruta /book/:slug y
// la landing /h/:slug — sin duplicar archivos sueltos en public/widget/.
//
// Uso (snippet que pega el hotelero en su sitio):
//   <script src="https://hotel.zx89.site/widget/loader.js" data-hotel="<slug>"></script>
//
// `data-hotel` es el SLUG público del hotel (no el hotelId). El slug es el identificador
// público estable desde F0 0.1; se edita en Settings → "Página pública" (F0 0.21).
//
// Atributos opcionales:
//   data-container  — id del elemento contenedor (default: 'booking-widget-container').
//                     Si no existe, se crea un <div> antes del <script>. Solo aplica en
//                     data-position="inline" — los otros 3 modos son overlays flotantes,
//                     no necesitan (ni usan) un contenedor del sitio host.
//   data-base       — origin del backend (default: el origin desde el que se sirve este
//                     script, ej. https://hotel.zx89.site). Útil para staging/testing.
//   data-position   — Tarea 3.4 (corrección 2026-08-25). 'inline' (default, retrocompat con
//                     snippets viejos sin este atributo) | 'corner' | 'center' | 'popup'.
//                     Horneado en el snippet, NO se lee del backend en runtime: este script
//                     corre en sitios de TERCEROS sin login/CORS garantizado, y "posición" casi
//                     nunca cambia — un fetch extra solo para esto sería costo de carga en la
//                     web del hotel sin beneficio real. Si el hotelero cambia la posición en el
//                     panel, tiene que volver a copiar/pegar el snippet (mismo criterio que ya
//                     aplica si cambia el slug).
//                       - 'inline'  → comportamiento de siempre: iframe embebido donde vive el
//                                     contenedor (o el <script> mismo).
//                       - 'corner'  → botón flotante abajo-a-la-derecha; al click abre el
//                                     widget en un panel anclado a esa esquina (estilo chat
//                                     widget).
//                       - 'center'  → mismo botón flotante; al click abre el widget en un modal
//                                     centrado con backdrop.
//                       - 'popup'   → igual que 'center', pero se auto-abre UNA vez al cargar
//                                     la página (con backdrop clickeable para cerrar) — el botón
//                                     flotante queda para reabrirlo. Auto-open es una sola vez
//                                     por sessionStorage, no en cada navegación del sitio host.
//
// El iframe se auto-resize cuando el widget emite `booking-widget-resize` (postMessage),
// mismo protocolo que el loader viejo para no romper integraciones que ya lo escuchaban.
// El widget SPA todavía no emite ese evento (vive en F3); mientras tanto, min-height fija
// asegura que el iframe no quede recortado. En los 3 modos overlay, el iframe ocupa 100% del
// panel/modal (que sí tiene una altura fija razonable) en vez de depender del auto-resize.
(function () {
  'use strict';

  var script = document.currentScript;
  var slug = script && script.getAttribute('data-hotel');
  if (!slug) {
    console.error('[BookingWidget] Falta el atributo data-hotel (slug público del hotel)');
    return;
  }

  var position = (script && script.getAttribute('data-position')) || 'inline';
  var VALID_POSITIONS = ['inline', 'corner', 'center', 'popup'];
  if (VALID_POSITIONS.indexOf(position) === -1) position = 'inline';

  // Resolver el origin del backend: explícito (data-base), o derivado del src del propio script.
  var base = (script && script.getAttribute('data-base')) || '';
  if (!base) {
    var src = script && script.getAttribute('src');
    if (src) {
      try { base = new URL(src, window.location.href).origin; } catch (e) { base = ''; }
    }
    if (!base) base = window.location.origin;
  }

  // Deep-link: si el sitio host ya tiene checkIn/checkOut/guests/rooms en su URL, los
  // propagamos al iframe para que el widget arranque en ese contexto.
  var hostQuery = new URLSearchParams(window.location.search);
  var iframeQuery = new URLSearchParams({ embed: '1' });
  ['checkIn', 'checkOut', 'guests', 'rooms'].forEach(function (k) {
    var v = hostQuery.get(k);
    if (v) iframeQuery.set(k, v);
  });

  var iframeUrl = base.replace(/\/$/, '') + '/book/' + encodeURIComponent(slug) + '?' + iframeQuery.toString();

  var iframe = document.createElement('iframe');
  iframe.src = iframeUrl;
  iframe.style.border = 'none';
  iframe.setAttribute('loading', 'lazy');
  iframe.setAttribute('title', 'Motor de reservas');

  // Auto-resize via postMessage (solo tiene efecto real en modo 'inline' — los overlays fijan
  // su propia altura). Misma forma de evento que el loader viejo para mantener compat con
  // integraciones existentes que lo escuchaban.
  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'booking-widget-resize' && typeof e.data.height === 'number') {
      if (position === 'inline') iframe.style.height = e.data.height + 'px';
    }
  });

  if (position === 'inline') {
    mountInline();
  } else {
    mountOverlay(position);
  }

  // ─── Modo 'inline' (comportamiento original, sin cambios) ───────────────────────────────
  function mountInline() {
    var containerId = (script && script.getAttribute('data-container')) || 'booking-widget-container';
    var container = document.getElementById(containerId);
    if (!container) {
      container = document.createElement('div');
      container.id = containerId;
      if (script && script.parentNode) {
        script.parentNode.insertBefore(container, script);
      } else {
        document.body.appendChild(container);
      }
    }
    iframe.style.width = '100%';
    iframe.style.minHeight = '560px';
    iframe.style.borderRadius = '12px';
    iframe.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1)';
    container.appendChild(iframe);
  }

  // ─── Modos 'corner' / 'center' / 'popup' — botón flotante + panel/modal overlay ──────────
  // Vanilla JS con estilos inline (sin Tailwind ni CSS externo disponible: este script corre
  // en el DOM de un sitio de terceros, cualquier cosa que dependa de una hoja de estilos
  // propia del panel no está garantizada acá).
  function mountOverlay(mode) {
    var NAVY = '#0D2B4E';
    var CYAN = '#00B4D8';
    var CYAN_LIGHT = '#48CAE4';
    var isCentered = mode === 'center' || mode === 'popup';

    var launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.setAttribute('aria-label', 'Abrir motor de reservas');
    launcher.textContent = 'Reservar';
    setStyle(launcher, {
      position: 'fixed', bottom: '20px', right: '20px', zIndex: '2147483000',
      background: CYAN, color: NAVY, border: 'none', borderRadius: '999px',
      padding: '14px 24px', fontSize: '14px', fontWeight: '800',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      cursor: 'pointer', boxShadow: '0 8px 20px rgba(0,0,0,0.25)', transition: 'background 0.15s',
    });
    launcher.onmouseenter = function () { launcher.style.background = CYAN_LIGHT; };
    launcher.onmouseleave = function () { launcher.style.background = CYAN; };

    var backdrop = document.createElement('div');
    setStyle(backdrop, {
      position: 'fixed', inset: '0', background: 'rgba(13,43,78,0.45)',
      zIndex: '2147483001', display: 'none',
    });

    var panel = document.createElement('div');
    setStyle(panel, isCentered ? {
      position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
      width: 'min(420px, 92vw)', height: 'min(680px, 88vh)',
      zIndex: '2147483002', display: 'none',
      background: '#fff', borderRadius: '16px', overflow: 'hidden',
      boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
    } : {
      // 'corner': panel anclado a la esquina, estilo chat widget — no tapa toda la pantalla.
      position: 'fixed', bottom: '20px', right: '20px',
      width: 'min(400px, 92vw)', height: 'min(600px, 80vh)',
      zIndex: '2147483002', display: 'none',
      background: '#fff', borderRadius: '16px', overflow: 'hidden',
      boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
    });

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Cerrar');
    closeBtn.textContent = '✕';
    setStyle(closeBtn, {
      position: 'absolute', top: '10px', right: '10px', zIndex: '1',
      width: '28px', height: '28px', borderRadius: '999px', border: 'none',
      background: 'rgba(13,43,78,0.08)', color: NAVY, fontSize: '14px', fontWeight: '700',
      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    });

    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.display = 'block';

    panel.appendChild(closeBtn);
    panel.appendChild(iframe);
    document.body.appendChild(backdrop);
    document.body.appendChild(panel);
    document.body.appendChild(launcher);

    var open = false;
    function setOpen(v) {
      open = v;
      panel.style.display = open ? 'block' : 'none';
      // El backdrop solo aplica a los modos centrados — 'corner' no tapa el resto de la página
      // (mismo criterio que un chat widget: no bloquea la navegación del sitio host).
      if (isCentered) backdrop.style.display = open ? 'block' : 'none';
      launcher.textContent = open ? 'Cerrar' : 'Reservar';
    }
    launcher.addEventListener('click', function () { setOpen(!open); });
    closeBtn.addEventListener('click', function () { setOpen(false); });
    backdrop.addEventListener('click', function () { setOpen(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && open) setOpen(false);
    });

    if (mode === 'popup') {
      // Auto-open UNA sola vez por sessionStorage — no en cada navegación del sitio host
      // (evita el patrón spammy de un popup que reaparece en cada página).
      var FLAG = 'booking-widget-popup-shown:' + slug;
      var alreadyShown = false;
      try { alreadyShown = sessionStorage.getItem(FLAG) === '1'; } catch (e) { /* modo privado */ }
      if (!alreadyShown) {
        setTimeout(function () {
          setOpen(true);
          try { sessionStorage.setItem(FLAG, '1'); } catch (e) { /* silencioso */ }
        }, 1500);
      }
    }
  }

  function setStyle(el, styles) {
    for (var key in styles) {
      if (Object.prototype.hasOwnProperty.call(styles, key)) el.style[key] = styles[key];
    }
  }
})();
