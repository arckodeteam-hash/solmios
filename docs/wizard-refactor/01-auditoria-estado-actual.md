# Auditoría del estado actual

Todo lo de este documento está verificado leyendo el código real (rutas y líneas
citadas), no supuesto. Fecha de auditoría: 2026-09-07.

## 1. El registro (`frontend/src/pages/auth/register.vue`)

Formulario en 2 pasos que **sí** ya tiene buen diseño (progreso arriba, validación
en vivo, un solo submit al final). Campos que quedan grabados:

| Campo del form | Dónde persiste | Endpoint |
|---|---|---|
| `ownerName` | `users.name` | `POST /api/public/signup` → `signup.ts:171` |
| `email` | `users.email` | ídem |
| `password` | `users.password` (hasheado) | ídem |
| `hotelName` | `hotels.name` | `signup.ts:149` |
| `country` | `hotels.country` | `signup.ts:156` |
| `address` (label del form: "Ciudad") | `hotels.address` | `signup.ts:155` |
| `phone` | `hotels.phone` | `signup.ts:152` |
| `planId` | `subscriptions.planId` | `signup.ts:186` |

`signup.ts` además crea slug público (`buildHotelSlug`), roles por defecto y la fila
de `subscriptions` en trial. **No** pide ni guarda: tipo de alojamiento, estrellas,
logo, coordenadas del mapa, provincia/municipio/CP, moneda, zona horaria,
horario de check-in/out, teléfono 2, sitio web, CIF/NIF/RNC del propietario, WiFi,
política de cancelación/depósito/impuestos, amenities, política de niños.

## 2. La guía del dashboard (`OnboardingGuide.vue` + `Onboarding.service.ts` + backend `onboarding.ts`)

**Esto NO es tan malo como lo describe el pedido original** — ya es una tarjeta
colapsable con barra de progreso, no un texto gigante permanente
(`frontend/src/components/features/OnboardingGuide.vue:9-26`). Pero:

- Ocupa el ancho completo del dashboard arriba de todo (`dashboard/index.vue:4`,
  antes de los KPIs), con borde grueso (`border-2`) — sigue siendo lo primero que
  ve el usuario en cada visita al dashboard hasta que se completa o se descarta.
- El descarte (`dismissed`) es solo de sesión (`ref` en memoria, no persistido) —
  reaparece en cada carga de página hasta que el usuario completa los pasos
  obligatorios.
- **El paso "hotel" está mal calibrado.** Backend
  (`backend/src/modules/subscriptions/usecases/onboarding.ts:70`):
  ```ts
  const hotelReady = Boolean(hotel?.phone || hotel?.address)
  ```
  El registro YA graba `phone` y `address` (tabla de arriba). Es decir: **el paso
  "Completá los datos del hotel" nace marcado como hecho apenas el usuario termina
  el registro**, aunque falten tipo de alojamiento, estrellas, logo, ubicación en el
  mapa, moneda, políticas, amenities — todo lo que de verdad hace falta para que el
  motor de reservas público se vea bien. La guía nunca vuelve a mencionar esos
  campos: el único lugar donde el usuario se entera de que existen es entrando por
  su cuenta a Configuración y recorriendo las 9 pestañas.
- Los otros 4 pasos (rooms, rates, channels, team) están razonablemente calibrados
  (miran datos reales: cantidad de habitaciones, tarifas, canal conectado, más de
  un usuario) y no se tocan en este refactor.

**Conclusión**: el problema no es solo visual — es que la guía actual no tiene
forma de decirle al usuario "te falta completar el perfil del hotel", porque su
noción de "hotel completo" es demasiado laxa. Este es el hueco que el wizard nuevo
tiene que llenar.

## 3. La pantalla de Configuración (`frontend/src/pages/settings/index.vue`, 1936 líneas)

9 pestañas en 2 grupos:

**Config. administrativo**: Hotel · Ubicación · Condiciones · Niños ·
Tipos de habitación · Emergencias · RRHH
**Configuraciones e integraciones**: Amenities · Integraciones

(Página pública, Landing, Reputación, Tracking ya se sacaron de acá en un refactor
anterior — `pagina-publica-tabs.ts` — así que hay precedente directo de mover tabs
de Configuración a Página pública. Ver más abajo.)

### 3.1 Bug confirmado — guardado acoplado entre pestañas

Hay **un solo botón "Guardar" global**, arriba de las pestañas
(`settings/index.vue:50`), que dispara `saveAll()`. `saveAll()`
(`settings/index.vue:1634`) hace esto:

```ts
touchedFields.value = new Set(Object.keys(HOTEL_RULES))
fieldErrors.value = validateAll(form.value as Record<string, unknown>, HOTEL_RULES)
```

`HOTEL_RULES` valida campos de **Hotel + Ubicación + Condiciones simultáneamente**
(nombre, país, dirección, latitud/longitud, depósito, impuestos, etc. —
`useFieldValidation.ts:97`). Si hay un campo inválido en la pestaña Hotel mientras
el usuario está parado en la pestaña Ubicación, `saveAll()` lo salta de vuelta a
Hotel y bloquea el guardado (`settings/index.vue:1645-1652`). Esto es exactamente
la queja del usuario: **"dependencia del guardado de la sección anterior"** — no es
percepción, es el comportamiento real del código.

Además, este mismo botón también manda `HotelService.saveAmenitiesHotel(...)`
(línea 1695), así que tocar la pestaña Amenities y guardar revalida TODO el resto
otra vez.

El resto de las pestañas (Niños, Tipos de habitación, Emergencias, RRHH,
Automatización, PIN, Moneda, Fiscal, Políticas de factura) tienen **cada una su
propio botón "Guardar" independiente** (9 botones distintos en total, contados en
el código: `saveEmergencyContacts`, `saveCurrency`, `saveGuaranteePin`,
`saveAutomation`, `saveFiscalConfig`, `saveChildPolicy`, `saveRoomTypeCapacity`,
`saveInvoicePolicy`, `saveWorkingDays`). Es decir: **la pantalla mezcla dos
paradigmas de guardado en la misma vista** — un save global que acopla 3 pestañas
entre sí, y 9 saves aislados sin relación entre ellos. Ningún usuario nuevo puede
predecir cuál botón necesita tocar para que un cambio se guarde.

### 3.2 Bug confirmado — el mapa no reacciona al país

`settings/index.vue:1722-1734`:

```ts
const DEFAULT_LAT = 18.4861   // Santo Domingo, fijo
const DEFAULT_LNG = -69.9312
const mapLat = computed(() => Number(form.value.latitude) || DEFAULT_LAT)
const mapLng = computed(() => Number(form.value.longitude) || DEFAULT_LNG)
```

No hay ningún `watch(() => form.value.country, ...)` que recentre el mapa. Un hotel
en México ve el mapa arrancar centrado en Santo Domingo hasta que mueve el pin a
mano. El país elegido en el registro (o en la pestaña Ubicación) **no informa en
absoluto** dónde arranca el mapa — confirma el reporte del usuario.

Adicionalmente, el mapa interactivo (clic para mover el pin) **solo existe si hay
una Google Maps JS API key configurada a nivel plataforma**
(`mapsInteractive` se pone en `true` solo dentro de `loadGoogleMaps()` — si no hay
key, cae a un `<iframe>` embed no interactivo, y mover el pin depende de pegar un
link de Google Maps o escribir lat/lng a mano —
`settings/index.vue:344-357, 1712-1721`). Es una limitación conocida y ya
documentada en el propio código como decisión asumida, pero es la causa real de
"la carga del mapa" que reporta el usuario si esa key no está seteada en este
entorno.

### 3.3 ✅ CONFIRMADO EN VIVO (2026-09-07, tarea 0.1) — el guardado global se DESHABILITA por completo, sin decir dónde está el error

El usuario reporta problemas puntuales guardando **tipo de alojamiento** y
**estrellas** (`accommodationType`, `starRating`). Revisando el código:
- Frontend: ambos están en el `v-model` del tab Hotel (`settings/index.vue:83-104`)
  y en la lista `keys` de `saveAll()` (línea 1662).
- Backend: ambos están declarados en el modelo (`hoteles/model.ts:37,45`) y en el
  schema de validación con enum correcto (`hoteles/validators/schema.ts:39,48`).

Reproducido en vivo contra el dev local (`hotel@solmios.com`, hotel de prueba)
con Playwright, confirmando la hipótesis del bug 3.1 — y peor de lo que la
lectura estática sugería:

1. En la pestaña Ubicación, se escribió `200` en Latitud (fuera de rango,
   `HOTEL_RULES` exige -90..90) y se dejó el campo (blur). Aparece el error
   inline correctamente ("Latitud: máximo 90").
2. Se cambió a la pestaña Hotel y se editaron `accommodationType` (→ "Villa /
   Casa") y `starRating` (→ "4 Estrellas").
3. **El botón "Guardar" global aparece DESHABILITADO** (`disabled`, no solo
   "falla al click"), con `title="Corregí los campos marcados en rojo para
   poder guardar"` — un mensaje genérico que **no dice en qué pestaña** está
   el campo con error. Estando parado en Hotel, sin ver Ubicación, no hay forma
   de saber que el bloqueo viene de ahí. El contador "1 campo(s) con errores"
   sí aparece en el header, pero tampoco identifica cuál ni dónde.
4. Recargar la página (descartando los cambios no guardados) confirma que
   nada de esto había llegado a persistirse — el bloqueo es 100% client-side,
   sobre `form.value` en memoria, no sobre datos ya guardados.

**Causa raíz confirmada**: `hasErrors` (que deshabilita el botón,
`settings/index.vue:50`) se computa sobre `fieldErrors`, y `fieldErrors` se
llena progresivamente por cada `touchField()` de CUALQUIER pestaña visitada en
la sesión — no se resetea al cambiar de tab. Un usuario que tipeó algo raro en
Ubicación (o Condiciones) minutos antes, se movió a Hotel para editar
tipo/estrellas, y ahora no puede guardar NADA, sin ningún indicio de que el
problema está en una pestaña que ni siquiera tiene abierta ahora mismo. Esto
explica el reporte del usuario ("no guarda tipo de hotel ni estrellas") sin
necesidad de que haya ningún bug en `accommodationType`/`starRating` en sí —
confirmado que ambos serializan y validan correctamente cuando el guardado
global SÍ se dispara.

**Fix**: ya cubierto por el diseño de F1 (guardado aislado de Ubicación, tarea
1.5) y por el patrón del Centro de configuración (F3: cada paso guarda por su
cuenta, doc 06 sección 5) — ambos eliminan la validación cruzada entre
secciones. Para lo que quede de `saveAll()` en Configuración (Hotel +
Condiciones, después de que Ubicación se mude en F1), sigue existiendo el
mismo acoplamiento entre esas dos pestañas — ver mejora incremental opcional
en doc 06 sección 5, todavía no obligatoria para este refactor.

## 4. Precedente ya existente: "Página pública" (`pagina-publica/`)

Ya existe una sección propia en el menú lateral, con sus propias pestañas
(`config/pagina-publica-tabs.ts`): General · Landing · Media · Apariencia ·
Motor de reservas · Códigos de descuento · Reputación · Tracking.

`pagina-publica/general.vue` es la prueba de que **este mismo movimiento ya se
hizo una vez**: el changelog del propio archivo dice
"extraído de `settings/index.vue` (tab «public», F0 0.21 solmi-direct-booking).
Ahora vive en su propia sección del menú lateral" — y hoy maneja slug público,
título/descripción multi-idioma, amenities de hotel (a nivel edificio) y flags de
reseñas públicas, con su propio guardado independiente (`save()`,
`general.vue:363`) y su propio slug de sección persistente.

**Esto es directamente el patrón a repetir** para mover Ubicación (y otros campos
públicos, ver doc 02) fuera de Configuración.

## 5. Qué es realmente "público" — la fuente de verdad

`backend/src/modules/bookingengine/usecases/public-hotel-info.ts:51-90` es el
endpoint que alimenta el motor de reservas / landing pública
(`GET /api/public/hotels/:slug`). Es una **allow-list explícita** (comentario en el
código: "NUNCA `...hotel`" para no filtrar campos internos) — por lo tanto es la
fuente de verdad más confiable de qué campos son realmente públicos, sin
adivinar. Se usa como base directa para la clasificación del documento 02.

## 6. ✅ CONFIRMADO (2026-09-07, tarea 0.4) — dos sistemas de "amenities de hotel" REALMENTE separados, y el público solo lee uno

- `settings/index.vue` pestaña **Amenities**: catálogo de 35 keys en 3
  categorías (`AmenitiesService.getStaticCatalog()`,
  `backend/src/modules/amenities/service.ts:36-42` — interior: ac, heating,
  kitchen, tv, wifi, minibar, etc.; exterior: pool, gym, spa, restaurant, bar,
  etc.; services: room_service, laundry, concierge, etc.), con soporte de
  amenities personalizadas. Persiste en la **tabla relacional `hotel_amenities`**
  (`hotelId, amenityKey, amenityCategory, isActive` — modelo `HotelAmenities`,
  `backend/src/shared/models.ts:197-206`), vía `PUT /api/amenities/hotel`
  (`AmenitiesService.updateHotelAmenities`).
- `pagina-publica/general.vue` sección **"Amenities del hotel"**: catálogo
  fijo de 20 keys, SIN categorías (`HOTEL_AMENITY_CATALOG`,
  `frontend/src/components/landing/landing-icons.ts:71-92`), que persiste
  directo en la **columna `hotels.amenities` (JSON)** vía
  `SettingsService.patchHotel({ amenities: [...] })`.

**No son la misma fuente leída dos veces — son dos catálogos y dos tablas
genuinamente distintas**, con solapamiento parcial de keys (`pool`, `gym`,
`spa`, `wifi`, `restaurant`, `bar`, `ac`, `heating`, `elevator`, `garden`,
`terrace`, `laundry` coinciden; pero `parking` (público) vs
`parking_free`/`parking_paid` (Configuración) y `wheelchair` vs
`wheelchair_access` NO matchean por nombre; `breakfast`/`beach_access`/
`airport_shuttle` existen SOLO en el catálogo público; `kitchen`/`tv`/
`minibar`/`safe`/`balcony`/`bathtub`/`pool_heated`/`bbq`/`kids_playground`/
`luggage_storage`, entre otros, existen SOLO en el catálogo de Configuración).

**Bug funcional real, no solo confusión de UI**: `getPublicHotelInfo`
(`bookingengine/usecases/public-hotel-info.ts:81`) devuelve
`amenities: hotel.amenities ?? null` — es decir, **el motor de reservas
público SOLO lee la columna JSON `hotels.amenities`** (la que edita Página
pública → General). Todo lo que un hotel tilde en Configuración → Amenities
(tabla `hotel_amenities`, el catálogo más completo y el que más "natural" se
siente elegir primero) **nunca llega a la página pública**. Un hotel que
cargó sus amenities ahí y nunca entró también a Página pública → General ve
su landing sin ninguna amenity, sin ningún error que lo avise.

**Resuelto — decisión tomada (ver doc 08 D3)**: `hotel_amenities` (la tabla
relacional, con categorías y personalizadas) se adopta como fuente única.
`getPublicHotelInfo` pasa a leer de ahí en vez de la columna JSON, y
`pagina-publica/general.vue` deja de escribir `hotels.amenities` — consume
`GET/PUT /api/amenities/hotel` como ya hace Configuración. La columna
`hotels.amenities` queda huérfana (no se dropea en este refactor, fuera de
alcance tocar el schema por esto solo).
