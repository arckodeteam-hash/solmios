# Arquitectura técnica

> **Revisión 2026-09-07** (doc 08, D1/D2/D4): se descarta el `ownerPhone` nuevo
> (era un malentendido — el pedido real era sobre `phone`/`phone2`, que ya
> existen) y se descarta el shape de dos listas separadas (`steps` + `profile`)
> — el usuario pidió una sola pantalla con una sola lista de pasos, mismo
> sistema que el actual. Este documento queda actualizado con eso.

## 1. Backend — extender `OnboardingUseCase` con una lista única de pasos

Archivo: `backend/src/modules/subscriptions/usecases/onboarding.ts`.

El paso `hotel` actual (`hotelReady = Boolean(hotel?.phone || hotel?.address)`,
línea 70) — el único mal calibrado — se reemplaza por **6 pasos de perfil**
granulares, que se agregan a la MISMA lista `steps[]` donde ya viven `rooms`,
`rates`, `channels`, `team` (no dos listas separadas). Se agrega un
discriminador para que el frontend sepa si un paso se completa inline o navega
afuera:

```ts
export interface OnboardingStep {
  key: string
  title: string
  description: string
  how: string
  impact: string
  route: string
  cta: string
  done: boolean
  required: boolean
  count?: number
  kind: 'profile' | 'external'   // NUEVO — 'profile' = se completa inline en el
                                  // Centro de configuración; 'external' = el
                                  // botón navega a su pantalla real (comportamiento
                                  // actual de rooms/rates/channels/team, sin cambios)
}

export interface OnboardingStatus {
  completed: boolean   // todos los pasos REQUERIDOS (de ambos tipos) están hechos
  doneCount: number
  totalCount: number
  steps: OnboardingStep[]   // orden sugerido: perfil primero (bienvenida→identidad→
                             // contacto→ubicación→políticas→amenities), operativos después
}
```

**Pasos de perfil nuevos** (`kind: 'profile'`), con sus campos requeridos según
doc 02 y la decisión D1 de doc 08:

| `key` | Campos que determinan `done` (todos los requeridos de ese paso) | `required` |
|---|---|---|
| `bienvenida` | `name`, `country`, **`phone`** (ahora requerido explícito), `email`, `ownerName` | true |
| `identidad` | `accommodationType`, `currency` (estrellas/logo no bloquean) | true |
| `contacto` | — (paso 100% opcional, `done` = al menos uno de `phone2`/`website`/`ownerTaxId` cargado, pero nunca bloquea `completed`) | false |
| `ubicacion` | `address`, `latitude`, `longitude` | true |
| `politicas` | `taxName`, `taxRate` (cancelación/depósito recomendados, no bloquean) | true |
| `amenities` | — (recomendado: al menos 1 amenity o política de niños tocada; no bloquea `completed`) | false |

Los 4 pasos operativos existentes (`rooms`, `rates`, `channels`, `team`) pasan a
tener `kind: 'external'`, sin cambios en su lógica de `done` — se mantienen tal
cual están hoy en `onboarding.ts`.

### Nota de compatibilidad

`Onboarding.service.ts` (frontend) y el componente que hoy lee `OnboardingStatus`
solo necesitan el campo nuevo `kind` por step — el shape general
(`completed`/`doneCount`/`totalCount`/`steps`) no cambia, así que no rompe nada
que ya lo consuma (`ProfileProgressBar.vue` nuevo lee `doneCount`/`totalCount`
para el porcentaje único de la franja, doc 04).

## 2. Backend — endpoints que el Centro de configuración consume (todos ya existen, no se crean de cero)

| Paso | Método | Endpoint | Notas |
|---|---|---|---|
| Bienvenida, Identidad, Contacto, Ubicación, Políticas (campos de `hotels`) | `PUT` | `/api/settings/hotel` | Ya soporta patch parcial (`SettingsService.patchHotel`) — incluye `phone` ahora marcado requerido en el paso Bienvenida |
| Bienvenida (`ownerName`) | `PUT` | `/api/auth/me` | ✅ Confirmado (tarea 0.2): `usuarios/index.ts:67`, ya existe, autenticado por token (no recibe id). `UpdateProfileSchema` acepta `{name, phone, avatar}` — `StepBienvenida.vue` manda `{name: ownerName}`. No hace falta crear nada. |
| Políticas (política de cancelación con tiers) | `PUT` | `/api/cancellation-policies/base` | Mismo endpoint que usa `CancellationPolicyEditor.vue` hoy |
| Amenities (hotel-level) | `GET`/`PUT` | `/api/amenities/hotel` | ✅ Actualizado tras D3 (doc 08): ya no es `patchHotel({amenities})` — se unifica en el endpoint de la tabla `hotel_amenities`, el mismo que ya usa Configuración → Amenities |
| Amenities (política de niños) | el que ya usa `saveChildPolicy()` en `settings/index.vue` | — | Reusar tal cual |
| Progreso | `GET` | `/api/onboarding/status` (extendido) | Ver punto 1 |

**No se crea ningún endpoint de "guardar borrador"** — decisión de diseño
explicada en doc 03 (cada paso escribe directo en los endpoints reales al
guardarse).

## 3. Backend — fix del default de impuestos sesgado a RD

`backend/src/modules/hoteles/model.ts:68-69` tiene `taxName: 'ITBIS'` / `taxRate:
18.0` como default físico de la columna. Esto no se cambia a nivel de modelo (
cambiar un default de columna es riesgoso para hoteles ya existentes que confían
en ese valor) — el fix es a nivel de **wizard**: el paso 5 nunca deja pasar el
campo de impuestos sin que el usuario lo haya visto explícitamente, incluso
cuando el valor ya está en el default. Ver doc 05, paso 5.

## 4. Frontend — componentes nuevos

```
frontend/src/
├── components/features/dashboard/
│   └── ProfileProgressBar.vue          [NUEVO] — reemplaza el uso de OnboardingGuide.vue en dashboard/index.vue
├── pages/
│   └── configuracion-inicial/          [NUEVO directorio] — pantalla propia, no modal (doc 05)
│       ├── index.vue                   — acordeón de pasos (refactor de OnboardingGuide.vue, mismo patrón de interacción)
│       └── steps/
│           ├── StepBienvenida.vue      — kind:'profile'
│           ├── StepIdentidad.vue       — kind:'profile'
│           ├── StepContacto.vue        — kind:'profile'
│           ├── StepUbicacion.vue       — kind:'profile', reusa la lógica de mapa de settings/index.vue (extraída, ver punto 6)
│           ├── StepPoliticas.vue       — kind:'profile', envuelve <CancellationPolicyEditor>
│           ├── StepAmenities.vue       — kind:'profile'
│           └── StepExternal.vue        — kind:'external', un solo componente genérico para rooms/rates/channels/team (misma UI que ya usa OnboardingGuide.vue hoy para estos 4 — no hace falta uno por paso)
├── composables/
│   └── useOnboardingStep.ts            [NUEVO] — guardado por paso de perfil, manejo de error, estado "guardando"
├── pages/pagina-publica/
│   └── ubicacion.vue                   [NUEVO] — pestaña nueva, mismo patrón que general.vue
├── pages/settings/
│   └── index.vue                       [EDITAR] — saca tab 'location' completo, saca accommodationType/starRating/logo/website del tab 'hotel'
├── config/
│   └── pagina-publica-tabs.ts          [EDITAR] — agrega entrada 'ubicacion'
└── router/index.ts                     [EDITAR] — agrega ruta /panel/configuracion-inicial
```

## 5. Frontend — el problema de "guardado acoplado" (bug 3.1) se resuelve en dos frentes

1. **En Configuración**: al sacar la pestaña Ubicación entera (se muda a Página
   pública, que ya tiene su propio guardado aislado por diseño), el `HOTEL_RULES`
   que valida `saveAll()` deja de incluir los campos de ubicación — reduce el
   acoplamiento entre Hotel/Condiciones (que sigue existiendo entre esas dos, pero
   ya es menor alcance). Si se quiere resolver del todo, hace falta separar
   también el guardado de Condiciones de Hotel — **se marca como mejora
   incremental opcional**, no bloqueante para este refactor (ver doc 07, fases).
2. **En el Centro de configuración**: cada paso tiene su propio guardado aislado
   por diseño desde el día uno (`useOnboardingStep.ts` solo valida y persiste
   los campos de SU paso) — no hereda el problema.

## 6. Frontend — extraer la lógica de mapa a un composable reusable

Hoy toda la lógica de mapa (geocoding, `mapsInteractive`, `syncMarkerFromForm`,
`reverseGeocode`, parseo de links pegados) vive inline en el script de
`settings/index.vue` (~línea 1710-1930). Para que **tanto** `ubicacion.vue`
(Página pública) **como** `StepUbicacion.vue` (wizard) puedan usarla sin
duplicar 200 líneas de lógica de geocoding, se extrae a:

```
frontend/src/composables/useHotelLocationMap.ts   [NUEVO]
```

Recibe `form` (ref reactivo con `country`/`address`/`latitude`/`longitude`/etc.)
y expone `{ mapEl, mapsInteractive, googleMapsEmbedUrl, applyMapsPaste, useMyLocation, syncMarkerFromForm, ... }`
— misma interfaz que ya usa `settings/index.vue`, solo movida a composable.
`settings/index.vue` deja de necesitar esta lógica una vez que Ubicación se muda
del todo (puede directamente importar y delegar en `ubicacion.vue`, o
simplemente el tab desaparece del archivo).

**Acá se corrige el bug 3.2** (mapa no reacciona al país): el composable agrega

```ts
const COUNTRY_CENTER: Record<string, { lat: number; lng: number }> = {
  'República Dominicana': { lat: 18.4861, lng: -69.9312 },
  'México': { lat: 23.6345, lng: -102.5528 },
  // ... resto de COUNTRIES (data/locales.ts) con un centro aproximado
}

watch(() => form.value.country, (country) => {
  // Solo recentra si TODAVÍA no hay coordenadas propias del hotel —
  // nunca pisa un pin que el usuario ya movió a mano.
  if (form.value.latitude && form.value.longitude) return
  const center = COUNTRY_CENTER[country]
  if (center) { mapLat.value = center.lat; mapLng.value = center.lng; recenterMap() }
})
```

Fuente de los centros por país: ✅ confirmado (tarea 0.3) que **no existe nada
así en el repo** (`rg` sobre `frontend/src/data/` y `backend/src/shared/` sin
resultados) — se escribe `COUNTRY_CENTER` desde cero como tabla estática nueva
dentro de `useHotelLocationMap.ts` (no hace falta tocar `data/locales.ts`,
que solo tiene nombre/código de país, sin coordenadas). Cubrir como mínimo los
países de `COUNTRIES` que tengan uso real en la base de hoteles (LatAm +
España como prioridad, resto con un fallback razonable o simplemente sin
entrada — sin entrada, el mapa no se recentra pero tampoco rompe nada, cae al
`DEFAULT_LAT`/`DEFAULT_LNG` actual).

## 7. Migraciones / cambios de DB

**Ninguna.** D1 (doc 08) descartó la columna `ownerPhone` — el requisito real
era marcar `hotels.phone` (ya existente, ya reciclado del registro) como
requerido en el paso Bienvenida. No hace falta tocar `hoteles/model.ts`.

No se necesita ninguna tabla nueva para el Centro de configuración en sí (no
hay estado de borrador que persistir, según decisión de doc 03) — solo el
campo `kind` nuevo en el shape de `OnboardingStep` (punto 1), que no requiere
persistencia propia, se calcula en cada request de `GET /api/onboarding/status`.

## 8. Testing

- `frontend/src/pages/settings/settings-location-fields.test.ts` y
  `settings-geocoding.test.ts` — hoy testean la lógica de ubicación DENTRO de
  `settings/index.vue`. Al extraerse a `ubicacion.vue` + composable, estos tests
  se mueven/reescriben apuntando a los archivos nuevos (mismos casos, nueva
  ubicación) — no se descartan, se migran.
- Tests nuevos: `pages/configuracion-inicial/index.test.ts` (expandir/colapsar
  pasos, guardado aislado por paso, manejo de error, pasos `external` navegan
  correctamente), `useOnboardingStep.test.ts`, `ProfileProgressBar.test.ts`
  (estados 0%/parcial/100%).
- Backend: `onboarding.test.ts` se extiende con casos de los 6 pasos de perfil
  nuevos (combinaciones de campos requeridos faltantes) y el campo `kind` por
  paso.
