# Tareas: refactor de configuración inicial del hotel — índice

Fuente de verdad: `../00-resumen-ejecutivo.md` a `../08-decisiones-abiertas-y-riesgos.md`
(ya reflejan las correcciones del usuario del 2026-09-07). Este índice no
reinterpreta ninguna decisión — solo organiza `../07-plan-fases-implementacion.md`
en tareas chicas, **una por archivo**, cada una completable en una sola sesión,
con su criterio de aceptación explícito. Mismo formato que ya usa el proyecto en
`openspec/changes/*/tasks.md`.

**Orden obligatorio: F0 → F1 → F2 → F3 → F4 → F5.** Dentro de cada fase, varias
tareas son independientes entre sí — se marca la dependencia real dentro de
cada archivo de tarea, no hay que asumir que el orden numérico es siempre una
dependencia dura.

Cada fase termina con un **Gate de verificación obligatorio**:
```
cd backend && bun run typecheck
cd backend && bun run node_modules/arckode-framework/bin/arckode.js analyze   # ✅ VÁLIDO, 0 violaciones
cd backend && bun test
cd frontend && bun run typecheck   # vue-tsc -b
cd frontend && bun run build       # termina en "✓ built"
```

## F0 — Confirmación y reproducción (sin código de producción)

> Tareas 0.1 a 0.5 empaquetadas en un solo archivo para entregar a una IA de
> trabajo — ver [paquete-01-tareas-1-10.md](./paquete-01-tareas-1-10.md).

- [x] 0.1 — Reproducir el bug de guardado de tipo/estrellas (confirmado en vivo, ver auditoría 01 sección 3.3)
- [x] 0.2 — Confirmar endpoint de editar perfil de usuario (`PUT /api/auth/me`, ya existe)
- [x] 0.3 — Confirmar fuente de centros lat/lng por país (no existe, se crea desde cero)
- [x] 0.4 — Investigar duplicado de amenities (D3 resuelta: duplicación real, se unifica en `hotel_amenities`)
- [ ] 0.5 — Cerrar D5 y D6 con el usuario (pendiente — no bloquea 1.1-1.5)

## F1 — Mover Ubicación (y campos públicos sueltos) a Página pública

> Tareas 1.1 a 1.5 (primer tramo de F1) también van en
> [paquete-01-tareas-1-10.md](./paquete-01-tareas-1-10.md), junto con F0. El
> resto de F1 (1.6 en adelante) sigue en archivos individuales.

- [x] 1.1 — Crear composable de mapa de ubicación (`composables/useHotelLocationMap.ts`, `settings/index.vue` migrado, typecheck limpio)
- [x] 1.2 — Fix de centrado del mapa por país (verificado en vivo: cambiar país recentra el iframe, ej. México → 23.6345,-102.5528)
- [x] 1.3 — Shell de la pestaña Ubicación en Página pública (`pages/pagina-publica/ubicacion.vue`, registrada en `pagina-publica-tabs.ts` e `index.vue` para poder verificarla — adelanta parte de 1.6)
- [x] 1.4 — Completar campos de Ubicación (mapa + dirección + coordenadas + provincia/municipio/localidad/CP, verificado en vivo)
- [x] 1.5 — Guardado aislado de Ubicación (verificado en vivo: guarda y persiste sin depender de Configuración → Hotel/Condiciones)
- [x] 1.6 — Registrar la pestaña Ubicación en el menú (hecho junto con 1.3-1.5)
- [ ] [1.7 — Mover tipo/estrellas/logo/website a Página pública](./f1-07-mover-identidad-publica.md)
- [ ] **1.7b — Unificar amenities (D3, ver doc 08)**: `getPublicHotelInfo` lee `hotel_amenities` (vía `AmenitiesService`) en vez de `hotel.amenities`; `pagina-publica/general.vue` deja de usar `patchHotel({amenities})` y consume `GET`/`PUT /api/amenities/hotel`. Sin task file propio todavía — se hace junto con 1.7 por tocar el mismo archivo.
- [x] 1.8 — Sacar la pestaña Ubicación de Configuración (tab, campos y composable removidos de `settings/index.vue`; `país` reubicado a la pestaña Hotel, sigue editable ahí per doc 03; link "Cambiar" de Página pública actualizado a `?tab=hotel`; verificado en vivo y con typecheck/build/analyze)
- [x] **1.4b — Pulido final de `/panel/pagina-publica?tab=ubicacion` (2026-09-08)**: mapa y autocompletado 100% Google Maps (decisión explícita del usuario, sin proveedores alternativos) — API key real con Places+Geocoding habilitadas cargada en `configuration` (dev local). Bugfix real encontrado y corregido: `initInteractiveMap()`/`initAddressAutocomplete()` se llamaban antes de que `loading` pasara a `false`, así que `mapEl`/`addressInputEl` todavía no existían en el DOM y ambas quedaban sin efecto (mapa caía siempre al iframe no interactivo, autocompletado nunca se conectaba) — movidas al `finally`, después de `loading.value = false` + `nextTick()`. Verificado en vivo: mapa interactivo real (clic y arrastre del pin), autocompletado con sugerencias reales de Google Places, selección completa dirección+coordenadas+provincia+municipio, cero errores de consola.
- [ ] [1.9 — Migrar tests de ubicación](./f1-09-migrar-tests-ubicacion.md) — **ahora más urgente**: `settings-location-fields.test.ts` y `settings-geocoding.test.ts` prueban la pestaña Ubicación que ya no existe en `settings/index.vue`, quedaron obsoletos por 1.8. Además, ⚠️ hallazgo nuevo: los `mount()` de `@vue/test-utils` fallan con `TypeError: WeakMap keys must be objects or non-registered symbols` en TODA la suite de settings — confirmado que es preexistente y no causado por 1.8 (falla igual en `settings-plan-pin.test.ts`, no tocado). Investigar aparte antes de poder migrar/correr estos tests.
- [ ] [1.10 — Gate de verificación F1](./f1-10-gate-verificacion.md)

## F2 — Backend: pasos de perfil dentro de `OnboardingStep[]`

- [ ] [2.1 — Agregar el campo `kind` a `OnboardingStep`](./f2-01-agregar-campo-kind.md)
- [ ] [2.2 — Paso `bienvenida`](./f2-02-paso-bienvenida.md)
- [ ] [2.3 — Paso `identidad`](./f2-03-paso-identidad.md)
- [ ] [2.4 — Paso `contacto`](./f2-04-paso-contacto.md)
- [ ] [2.5 — Paso `ubicacion`](./f2-05-paso-ubicacion.md)
- [ ] [2.6 — Paso `politicas`](./f2-06-paso-politicas.md)
- [ ] [2.7 — Paso `amenities`](./f2-07-paso-amenities.md)
- [ ] [2.8 — Reordenar `steps[]`](./f2-08-reordenar-steps.md)
- [ ] [2.9 — Tests backend de los pasos nuevos](./f2-09-tests-backend-pasos.md)
- [ ] [2.10 — Gate de verificación F2](./f2-10-gate-verificacion.md)

## F3 — El Centro de configuración

- [ ] [3.1 — Composable `useOnboardingStep`](./f3-01-composable-use-onboarding-step.md)
- [ ] [3.2 — Ruta `/panel/configuracion-inicial`](./f3-02-ruta-configuracion-inicial.md)
- [ ] [3.3 — Shell del Centro de configuración](./f3-03-shell-centro-configuracion.md)
- [ ] [3.4 — Expandir/colapsar pasos](./f3-04-expandir-colapsar-pasos.md)
- [ ] [3.5 — `StepBienvenida.vue`](./f3-05-step-bienvenida.md)
- [ ] [3.6 — `StepIdentidad.vue`](./f3-06-step-identidad.md)
- [ ] [3.7 — `StepContacto.vue`](./f3-07-step-contacto.md)
- [ ] [3.8 — `StepUbicacion.vue`](./f3-08-step-ubicacion.md)
- [ ] [3.9 — `StepPoliticas.vue`](./f3-09-step-politicas.md)
- [ ] [3.10 — `StepAmenities.vue`](./f3-10-step-amenities.md)
- [ ] [3.11 — `StepExternal.vue`](./f3-11-step-external.md)
- [ ] [3.12 — Animación de cierre al 100%](./f3-12-animacion-cierre.md)
- [ ] [3.13 — Manejo de error por paso](./f3-13-manejo-error-por-paso.md)
- [ ] [3.14 — Copy final de cada paso](./f3-14-copy-final.md)
- [ ] [3.15 — Tests del Centro de configuración](./f3-15-tests-centro-configuracion.md)
- [ ] [3.16 — Gate de verificación F3](./f3-16-gate-verificacion.md)

## F4 — Reemplazar el widget del dashboard

- [ ] [4.1 — `ProfileProgressBar.vue`](./f4-01-profile-progress-bar.md)
- [ ] [4.2 — Reemplazar `OnboardingGuide` en el dashboard](./f4-02-reemplazar-en-dashboard.md)
- [ ] [4.3 — Retirar `OnboardingGuide.vue`](./f4-03-retirar-onboarding-guide.md)
- [ ] [4.4 — Verificación visual de los 3 estados](./f4-04-verificacion-visual.md)
- [ ] [4.5 — Gate de verificación F4](./f4-05-gate-verificacion.md)

## F5 — Limpieza y documentación

- [ ] [5.1 — Actualizar CLAUDE.md](./f5-01-actualizar-claude-md.md)
- [ ] [5.2 — Documentar la resolución de amenities duplicadas](./f5-02-documentar-resolucion-amenities.md)
- [ ] [5.3 — Gate final completo](./f5-03-gate-final.md)
