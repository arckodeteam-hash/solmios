# Plan de fases

> **Revisión 2026-09-07**: actualizado tras las decisiones del usuario en doc 08
> (D1, D2, D4) — ya no hay "wizard modal", es un "Centro de configuración" en
> pantalla propia con acordeón de pasos; no hay columna `ownerPhone` nueva; los
> pasos operativos son botones, no formularios inline.

El orden importa: primero se separa la información (Fase 1), después se arregla
lo roto en el nuevo lugar (Fase 2), recién después se construye el Centro de
configuración (Fase 3) y al final se reemplaza el widget del dashboard (Fase 4)
— así en todo momento hay una versión funcional del panel, sin un big-bang que
deje Configuración a medio migrar mientras el Centro de configuración todavía
no existe.

## Fase 0 — Confirmación y reproducción (antes de escribir código)

- [ ] Confirmar las decisiones que siguen abiertas en
      `08-decisiones-abiertas-y-riesgos.md` (D3 amenities duplicadas, D5
      descarte de la franja, D6 copy/nombre final) — D1, D2 y D4 ya están
      resueltas, no bloquean el arranque.
- [ ] Reproducir en vivo el bug de "no guarda tipo de hotel / estrellas"
      reportado por el usuario (auditoría 01, sección 3.3) — confirmar si la
      causa es el guardado acoplado (3.1) u otra cosa antes de asumir el fix.
- [ ] Confirmar si existe endpoint de "editar mi perfil" para `ownerName` del
      lado de `usuarios`, o si hace falta crearlo (doc 06, punto 2).
- [ ] Confirmar si ya existe una fuente de centros lat/lng por país en el repo
      (doc 06, punto 6) antes de escribir una tabla nueva.

## Fase 1 — Mover Ubicación (y campos públicos sueltos) a Página pública

Esto por sí solo ya resuelve una parte real del pedido del usuario ("mandar las
configuraciones que deben ir en página pública para allá") y del bug 3.1 para
esos campos, sin depender de que el Centro de configuración exista todavía.

- [ ] Extraer lógica de mapa a `composables/useHotelLocationMap.ts` (doc 06.6),
      con el fix del centrado por país (bug 3.2).
- [ ] Crear `pages/pagina-publica/ubicacion.vue` (patrón calcado de
      `general.vue`): dirección, mapa, coordenadas, provincia/municipio/
      localidad/CP.
- [ ] Agregar entrada `ubicacion` a `config/pagina-publica-tabs.ts` + redirect
      legacy si `settings/index.vue?tab=location` tenía links guardados en algún
      lado (revisar `OnboardingGuide`/emails/notificaciones que apunten a esa
      ruta).
- [ ] Mover `accommodationType`, `starRating`, `logo`, `website` de la pestaña
      Hotel de Configuración a `pagina-publica/general.vue`.
- [ ] Sacar la pestaña `location` completa de `settings/index.vue`, sacar los 4
      campos de arriba del tab `hotel`, reducir `HOTEL_RULES`/`FIELD_TAB`
      acorde.
- [ ] Actualizar/migrar tests existentes (`settings-location-fields.test.ts`,
      `settings-geocoding.test.ts`) al nuevo archivo.
- [ ] Verificar que `saveAll()` de Configuración sigue funcionando para lo que
      queda (Hotel sin los 4 campos movidos + Condiciones) sin quedar código
      muerto (referencias a `mapEl`, `mapsInteractive`, etc. que ya no se usan).

**Criterio de aceptación de la fase**: un hotel puede editar su ubicación desde
Página pública → Ubicación, ver el mapa centrado según su país sin haber cargado
coordenadas todavía, y guardar sin que le importe el estado de Configuración →
Hotel. `arckode analyze` 0 violaciones, `typecheck` limpio en ambos paquetes,
build de frontend OK.

## Fase 2 — Backend: pasos de perfil dentro de `OnboardingStep[]`

- [ ] Extender `OnboardingUseCase`: agregar el campo `kind: 'profile' | 'external'`
      al shape de `OnboardingStep`, marcar los 4 pasos operativos existentes
      como `'external'`, y agregar los 6 pasos de perfil nuevos como
      `'profile'` (doc 06.1) — reemplaza al paso `hotel` mal calibrado.
- [ ] Marcar `phone` como campo requerido del paso `bienvenida` (D1 de doc 08 —
      no hay columna nueva, solo lógica de checklist).
- [ ] Tests backend de `onboarding.ts` para los 6 pasos de perfil nuevos
      (combinaciones de campos requeridos faltantes) y el campo `kind`.

**Criterio de aceptación**: `GET /api/onboarding/status` devuelve `steps[]` con
10 pasos (6 de perfil + 4 operativos), cada uno con `kind` correcto, y
`doneCount`/`totalCount`/`completed` reflejan el estado real para distintos
hoteles de prueba (0%, parcial, 100% requeridos con opcionales pendientes, 100%
total).

## Fase 3 — El Centro de configuración

- [ ] `useOnboardingStep.ts` — composable de guardado por paso de perfil.
- [ ] `pages/configuracion-inicial/index.vue` — pantalla propia, acordeón de
      pasos (refactor de `OnboardingGuide.vue`, mismo patrón de interacción:
      un paso expandido por vez, check verde, badge opcional/requerido).
- [ ] Los 6 componentes de paso de perfil (doc 05) — `StepUbicacion.vue` reusa
      el composable de mapa de Fase 1, `StepPoliticas.vue` reusa
      `CancellationPolicyEditor.vue` tal cual.
- [ ] `StepExternal.vue` — un componente genérico para los 4 pasos operativos
      (mismo contenido que ya muestra `OnboardingGuide.vue` hoy para
      rooms/rates/channels/team: explicación + botón que navega).
- [ ] Ruta nueva `/panel/configuracion-inicial` en el router.
- [ ] Copy final de cada paso (revisar con el usuario antes de dar por cerrado
      el texto — el de doc 05 es un punto de partida, no el copy definitivo).
- [ ] Manejo de error por paso, estado "guardando", reintento.
- [ ] Animación de cierre al llegar al 100%.
- [ ] Tests de `pages/configuracion-inicial/index.vue` (expandir/colapsar,
      guardado aislado, error, navegación de pasos externos).

**Criterio de aceptación**: un hotel de prueba recién registrado puede abrir el
Centro de configuración, completar los pasos de perfil en cualquier orden
(guardando cada uno por separado), navegar a Habitaciones/Tarifas/Canales/
Equipo desde los pasos operativos, y al completar los requeridos de perfil ve
`completed: true` para ese grupo.

## Fase 4 — Reemplazar el widget del dashboard

- [ ] `ProfileProgressBar.vue` (doc 04): franja única, consume
      `doneCount`/`totalCount`/`completed` de `GET /api/onboarding/status`
      (un solo porcentaje combinado, sin desglosar perfil/operativo en el
      dashboard — D2 de doc 08).
- [ ] Reemplazar `<OnboardingGuide />` por `<ProfileProgressBar />` en
      `dashboard/index.vue:4`; el botón "Completar" navega a
      `/panel/configuracion-inicial`.
- [ ] Verificación visual en navegador (Playwright o manual) de los 3 estados:
      0%, parcial, 100% — confirmar que la franja desaparece sola al completar
      lo requerido, y que no vuelve a aparecer tras recargar si ya está
      completo.

**Criterio de aceptación**: el dashboard de un hotel recién registrado muestra
la franja fina en vez de la tarjeta grande actual; el botón navega al Centro de
configuración; al completar los requeridos, la franja desaparece con la
transición definida.

## Fase 5 — Limpieza y documentación

- [x] Actualizar `CLAUDE.md` (sección de estado SDD) si corresponde marcar este
      cambio como resuelto/en progreso, siguiendo el patrón de otras entradas
      de deuda técnica documentadas ahí.
- [x] Revisar el hallazgo de "dos sistemas de amenities" (doc 01.6, doc 08 D3)
      — resuelto en la tarea 1.7b: `getPublicHotelInfo` pasó a leer `hotel_amenities`
      (la tabla real) en vez de `hotels.amenities` (columna JSON huérfana), y
      `pagina-publica/general.vue` se repuntó al mismo endpoint que ya usaba
      Configuración → Amenities. No quedan "dos sistemas" escribiendo en lugares
      separados — ver doc 08 D3 y tareas.md 1.7b para el detalle completo.
- [x] `arckode analyze` + `typecheck` + `bun test` (backend) + `typecheck` +
      `build` (frontend) — gate final antes de mergear.

## Orden recomendado de PRs

No hace falta un solo PR gigante. Sugerido: Fase 1 sola (PR chico, ya tiene
valor propio) → Fase 2 sola (backend, sin UI nueva todavía, no visible para el
usuario final hasta Fase 4) → Fase 3 (el Centro de configuración, probablemente
el PR más grande) → Fase 4 (activa todo lo anterior de cara al usuario) →
Fase 5. Esto permite mergear y probar en producción cada pieza sin esperar a
que todo el refactor esté terminado, y si algo de Fase 3 tarda más de lo
esperado, Fase 1 y 2 ya aportan valor real solas.
