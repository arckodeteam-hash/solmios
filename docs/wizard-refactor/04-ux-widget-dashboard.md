# UX — Barra de progreso discreta en el dashboard

Reemplaza `OnboardingGuide.vue`, que hoy es una tarjeta de ancho completo con
borde grueso arriba de los KPIs (`dashboard/index.vue:4`, antes de todo lo demás).

> **Decisión del usuario (2026-09-07, ver doc 08 D2)**: en el dashboard va **una
> sola franja**, de solo visualización rápida — nombre, porcentaje y barra, sin
> desglose de pasos ahí mismo. El detalle de pasos (hechos y pendientes) vive en
> una pantalla aparte a la que se llega con el botón de esta franja. No hay dos
> franjas separadas (perfil vs operativo): un solo porcentaje que cuenta todo.

## Objetivo

Que el hotel vea, de un vistazo, "te falta completar tu configuración" sin que
eso le tape el dashboard operativo (ocupación, check-ins de hoy, etc.) — que es
lo que el usuario realmente necesita ver apenas entra, sobre todo pasados los
primeros días.

## Diseño

Una franja delgada, de una sola línea de alto (~48-56px), integrada al header del
dashboard — no una tarjeta separada con su propio borde y fondo blanco grueso.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ● Configuración: 60% completa   ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░  [Completar →]      │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Texto**: "Configuración: {pct}% completa" — un solo número, sin desglosar
  "perfil" vs "operativo" acá (eso se ve al entrar al Centro de configuración).
- **Barra de progreso**: fina (4-6px), colores del sistema (`cyan` sobre fondo
  `white/15` como ya usa el componente actual — no hace falta reinventar la
  paleta).
- **Botón**: "Completar" — pequeño, pill, a la derecha. Un solo call-to-action:
  abre el Centro de configuración (ver doc 05). No hay acordeón de pasos acá en
  el dashboard — eso es justamente lo que se saca del dashboard para dejar de
  ser intrusivo.
- **Sin ✕ de descarte** — al ser tan discreta (una línea) no compite con el
  resto del dashboard, no hace falta la opción de esconderla (ver doc 08, D5 —
  sigue abierta si se prefiere lo contrario).

## Estados

| Estado | Qué se muestra |
|---|---|
| 0% (recién registrado) | Franja completa, tono neutro — "Empezá por acá" en vez de "0% completa" (más invitación, menos regaño) |
| Parcial | Barra + porcentaje + botón "Completar" |
| 100% (todo lo requerido de perfil + operativo hecho) | La franja **desaparece completamente** — no queda ni un resabio "✓ completo" permanente |
| 100% requerido, pendiente algo opcional (ej. logo, canales) | La franja desaparece igual — lo opcional no debe mantener la franja viva para siempre; se sigue pudiendo completar desde el Centro de configuración (reabrible en cualquier momento) o desde Configuración/Página pública normal |

## Qué cuenta el porcentaje

Un solo número, calculado sobre **todos** los pasos del `OnboardingStep[]`
extendido (doc 06): los de perfil (identidad, contacto, ubicación, políticas,
amenities) y los operativos (habitaciones, tarifas, canales, equipo), cada uno
con su propio criterio de "hecho" — igual que hoy ya hace `OnboardingUseCase`
para los 4 pasos operativos, solo que ahora la lista es más larga porque incluye
los de perfil con criterios granulares (ver doc 06) en vez del único paso
"hotel" mal calibrado que existe hoy.

Los pasos **opcionales** (logo, teléfono 2, sitio web, CIF/NIF/RNC, etc.) NO
cuentan en el porcentaje — solo requeridos y recomendados, mismo criterio que ya
proponía la primera vuelta de este plan.

## Animación de entrada/salida

Al completarse el 100%, la franja se colapsa con una transición corta
(`height` + `opacity`, ~300ms) en vez de desaparecer de golpe.

## Componente

- Nuevo: `frontend/src/components/features/dashboard/ProfileProgressBar.vue`,
  consume `GET /api/onboarding/status` (extendido, doc 06) — un solo
  `doneCount`/`totalCount` sobre la lista combinada.
- Al hacer click en "Completar", navega/abre el Centro de configuración (ver
  doc 05 sobre si es modal o ruta propia — la decisión final queda ahí).
- `OnboardingGuide.vue` se retira del dashboard. Su lógica de acordeón
  (expandir paso, ver "cómo se hace", check verde) **no se descarta** — es
  justamente el patrón que el usuario pidió reusar para el Centro de
  configuración (doc 05), así que el componente se refactoriza/renombra en vez
  de borrarse desde cero.
