# Decisiones abiertas y riesgos

Puntos que este documento **no resuelve por su cuenta** porque son decisiones de
producto, no hallazgos técnicos — necesitan una respuesta del usuario antes de
empezar Fase 1 (o al menos antes de las fases que dependen de cada una).

> **Actualización 2026-09-07** — el usuario respondió D1, D2, D4 y D7
> directamente. Quedan resueltas acá abajo (✅ RESUELTO) y el resto de los
> documentos (00, 02, 04, 05, 06) ya están actualizados para reflejarlas. D3,
> D5 y D6 siguen abiertas.

## D1 — ✅ RESUELTO: no hay "teléfono del dueño" nuevo, es `phone` (principal) vs `phone2` (secundario)

Malentendido de la primera vuelta de este plan: el pedido nunca fue un campo
nuevo de "teléfono del dueño" — se refiere a los dos teléfonos que **ya existen**
en la pestaña Hotel de Configuración (`settings/index.vue:140-146`, sección
"Contacto"): `phone` (Teléfono principal) y `phone2` (Teléfono 2). Decisión del
usuario: **`phone` (principal) pasa a ser requerido explícito**, `phone2` sigue
opcional.

**No hace falta ninguna columna nueva ni migración.** `phone` ya se recicla del
registro (`signup.ts:152`) — el wizard solo necesita marcarlo como campo
requerido en el paso 1, y el backend necesita sumarlo a los campos requeridos
del checklist de perfil (doc 06). Se actualizaron doc 02 (tabla B) y doc 06
(lista de campos requeridos) — ya no aparece `ownerPhone` en ningún lado del
plan.

## D2 — ✅ RESUELTO: progreso combinado en una sola franja, un solo destino

Decisión del usuario: en el dashboard **solo va una barra de progreso elegante
con el porcentaje** — "visualización rápida" nada más, sin desglose de pasos ahí
mismo. El botón de esa franja manda a **una sola pantalla** donde se ven todos
los pasos (hechos y pendientes) — tanto los de perfil (identidad, ubicación,
políticas, etc.) como los operativos (habitaciones, tarifas, canales, equipo),
no dos franjas ni dos pantallas separadas como proponía la Alternativa A
original del doc 04.

Instrucción explícita del usuario para esa pantalla: **"usa el mismo sistema que
está usando el actual"** — reusar el patrón de interacción que ya tiene
`OnboardingGuide.vue` hoy (lista de pasos, cada uno expandible, check verde si
está hecho, texto de "cómo se hace" al abrir, botón de acción), en vez de un
wizard lineal forzado de "Paso 1 de 7 → Siguiente → Atrás". Esto **reemplaza el
diseño de wizard modal lineal del doc 05 original** por un "Centro de
configuración" tipo acordeón — ver doc 05 actualizado.

Consecuencia técnica: el backend deja de tener dos conceptos separados
(`steps` operativo + `profile` nuevo) y pasa a tener **una sola lista de pasos**
(`OnboardingStep[]` extendido) que mezcla los de perfil y los operativos bajo el
mismo contrato — ver doc 06 actualizado.

## D4 — ✅ RESUELTO: habitaciones/tarifas/canales/equipo son botones, no pasos del wizard

Confirmado por el usuario: "sería lo mejor poner botones hacia esas pantallas".
Los 4 pasos operativos existentes (rooms, rates, channels, team) siguen siendo
exactamente lo que son hoy en `OnboardingUseCase` — un botón que manda a su
pantalla real (Habitaciones, Tarifas, Canal Manager, Equipo) — dentro del mismo
"Centro de configuración" acordeón de D2, no como pasos con formulario inline.
Los pasos de PERFIL (identidad, contacto, ubicación, políticas, amenities) sí
abren su mini-formulario inline al expandirse — esa es la diferencia entre "paso
con contenido propio" y "paso que es un enlace a otra pantalla", ambos
conviviendo en la misma lista con el mismo look & feel.

## D7 — ✅ RESUELTO: `settings/index.vue` (Configuración) NO se elimina, es permanente

Cambio de planes explícito del usuario: "la vista de configuraciones no la
podemos eliminar ahí viven muchas cosas nativas de esa vista, lo máximo que
podemos hacer es migrar opciones para donde correspondan".

Aclaración importante: **el plan nunca propuso eliminar `settings/index.vue`**
— la opción de "mover TODO settings/index.vue al Centro de configuración" ya
estaba explícitamente descartada en la tabla comparativa de doc 03 ("Rompe la
edición post-alta... alcance mucho mayor... No — fuera de alcance"). Lo que sí
había una frase ambigua (doc 00, "no se re-arquitecturiza settings/index.vue
entero de una") que podía leerse como "no de una sola vez, pero eventualmente
sí" — **esa lectura queda descartada de forma explícita y permanente**: no hay
ningún plan, ni en esta ronda ni en una futura, de vaciar Configuración más
allá de los campos ya identificados como públicos en doc 02 (la pestaña
Ubicación completa + `accommodationType`/`starRating`/`logo`/`website`).

**Regla dura para toda implementación futura de este plan**: Configuración
sigue siendo la pantalla de edición administrativa continua del hotel —
Condiciones, Niños, Tipos de habitación, Emergencias, RRHH, Amenities,
Integraciones y la identidad administrativa del Hotel se quedan ahí para
siempre. El Centro de configuración (doc 05) y Página pública son destinos
**adicionales** para casos de uso específicos (alta guiada, contenido
público), no reemplazos de Configuración.

Sin impacto en el resto del plan: F1 ya solo migraba los campos puntuales
mencionados arriba, no proponía nada más agresivo — no hace falta modificar
`07-plan-fases-implementacion.md` ni `tareas/`.

## D3 — ✅ RESUELTO: las dos "amenities de hotel" son duplicación real — se unifican en `hotel_amenities`

Investigado en la tarea 0.4 (ver auditoría 01.6 para el detalle completo con
paths/líneas): es el caso (a) — duplicación real de arquitectura, no dos
conceptos distintos. Confirmado:

- `hotel_amenities` (tabla relacional, catálogo de 35 keys en 3 categorías,
  soporta personalizadas) — editada desde Configuración → Amenities.
- `hotels.amenities` (columna JSON, catálogo de 20 keys sin categorías) —
  editada desde Página pública → General.
- **`getPublicHotelInfo` (el motor de reservas público) solo lee la columna
  JSON** — todo lo cargado en Configuración → Amenities (la tabla más
  completa) nunca aparece en la página pública del hotel. Bug funcional real
  detectado, no solo confusión de UI.

**Decisión**: `hotel_amenities` (tabla) se adopta como fuente única — es la
más completa, ya tiene categorías, y ya soporta amenities personalizadas.
Cambios necesarios (se agregan como tareas nuevas al paquete de F1, ver
`tareas/tareas.md`):
1. `getPublicHotelInfo` pasa a leer `hotel_amenities` (vía el mismo
   `AmenitiesService.listHotelAmenities`) en vez de `hotel.amenities`.
2. `pagina-publica/general.vue` deja de usar `SettingsService.patchHotel({amenities})`
   y pasa a consumir `GET`/`PUT /api/amenities/hotel` (mismos endpoints que ya
   usa Configuración → Amenities) — un solo catálogo, un solo lugar de
   verdad, visible/editable desde los dos lados sin duplicar.
3. La columna `hotels.amenities` queda huérfana — no se dropea en este
   refactor (fuera de alcance tocar schema solo por esto), pero deja de
   escribirse desde cualquier lado.

El wizard (paso 6 de Amenities, F3.10) usa `hotel_amenities` directamente —
ya no hay ambigüedad sobre qué catálogo mostrar.

## D4 — ¿El wizard incluye o no un paso hacia habitaciones/tarifas?

Recomendación del plan (docs 00, 05, 07): el wizard termina en un paso "Listo"
con un CTA hacia Habitaciones si ese onboarding operativo sigue pendiente, pero
**no incluye pasos de carga de habitaciones/tarifas dentro del propio wizard**.

Alternativa: extender el wizard a 9-10 pasos incluyendo carga mínima de
habitaciones (al menos 1) y una tarifa base, para que el hotel salga del wizard
100% operativo, no solo con el perfil completo.

**Trade-off**: la alternativa da una sensación más "todo en un solo lugar", pero
la carga de habitaciones ya tiene una pantalla dedicada razonable (según la
propia guía de onboarding actual, ese paso está bien calibrado — auditoría 01.2)
y meterla dentro de un modal wizard puede quedar apretada para hoteles con
muchas habitaciones desde el día uno. Se recomienda la opción del plan (CTA, no
paso incluido) salvo que el usuario prefiera lo contrario.

## D5 — ¿Se permite ocultar/descartar la franja del dashboard?

Ver doc 04. Recomendación: no ofrecer la opción de ocultar (la franja es tan
discreta que no debería necesitar descarte) — pero si se prefiere mantenerla por
consistencia con otros patrones del panel, el descarte debe persistir en backend,
no solo en memoria de sesión como hoy (bug de UX menor pero real, doc 01.2).

## D6 — Copy definitivo

Todo el copy de doc 05 es un punto de partida razonable, no texto aprobado.
Antes de Fase 3, revisar tono/wording con el usuario — en particular el nombre
del wizard en sí ("Asistente de configuración", "Completar mi hotel", etc. — el
plan usa "Completar configuración" como placeholder).

## Riesgos técnicos a vigilar durante la implementación

- **R1 — Default de impuestos sesgado a RD** (doc 02.E, doc 06.3): mitigado por
  diseño del wizard (nunca deja pasar el paso en silencio), pero un hotel que
  NUNCA pasa por el wizard (completa todo manualmente desde Configuración,
  saltando el wizard por completo) sigue expuesto al default silencioso ahí. Fuera
  de alcance total arreglarlo en Configuración misma — se documenta como deuda
  conocida, no se resuelve en este refactor salvo que el usuario lo pida.
- **R2 — Regresión de tests existentes** al mover ubicación (`settings-location-
  fields.test.ts`, `settings-geocoding.test.ts`, `settings-plan-pin.test.ts` si
  toca algún campo compartido) — mitigado en el plan de Fase 1 (migrar tests, no
  descartarlos).
- **R3 — Analyzer de arckode-framework**: cualquier módulo/archivo nuevo tiene
  que respetar los límites del analyzer (ej. líneas por archivo, visto en la
  memoria del proyecto sobre `subscriptions/service.ts` acercándose a 200
  líneas) — vigilar tamaño de `pages/configuracion-inicial/index.vue` y sus
  steps, partiendo en componentes chicos por diseño ya ayuda acá.
- **R4 — Multi-tenancy**: todos los endpoints reusados ya filtran por `hotelId`
  del token (patrón estándar del proyecto) — no se identificó ningún riesgo
  nuevo de aislamiento de datos en este plan. Ya no aplica la nota sobre
  `ownerPhone` (D1 resuelto: no hay endpoint/columna nueva).
