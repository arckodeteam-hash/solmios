# Clasificación de campos

Este es el corazón del pedido: para cada dato que hoy vive en Configuración (o que
debería existir), decidir 4 cosas:

1. **¿Ya lo tenemos del registro?** → si sí, el wizard lo muestra pre-cargado para
   confirmar/editar, nunca lo vuelve a pedir en blanco.
2. **¿Es público?** → si lo ve el huésped en el motor de reservas, su lugar
   permanente de edición pasa a ser **Página pública**, no Configuración.
3. **¿Requerido o opcional?** → determina si el wizard lo bloquea (no deja avanzar)
   o lo deja pasar con un "completalo después".
4. **¿En qué paso del wizard aparece?** (ver doc 05 para el detalle de cada paso).

La columna "Público" está tomada de la allow-list real del endpoint
`getPublicHotelInfo` (`bookingengine/usecases/public-hotel-info.ts:51-90`), no de
una suposición — ver auditoría, sección 5.

## Leyenda

- **Reciclado**: ya viene del registro, el wizard lo pre-completa.
- **Público**: aparece en `GET /api/public/hotels/:slug` → destino final = Página
  pública.
- **Requerido**: el wizard no deja terminar sin esto.
- **Recomendado**: el wizard lo pide pero deja "completar después".
- **Opcional**: aparece en el wizard como opcional explícito, o directamente se
  omite del wizard y queda solo en Configuración/Página pública para quien lo
  quiera cargar más adelante.

## A. Identidad del hotel

| Campo | Reciclado | Público | Prioridad | Paso wizard | Destino final (editable después) |
|---|---|---|---|---|---|
| `name` (nombre del hotel) | ✅ (registro) | ✅ | Requerido | 1 — Bienvenida | Configuración → Hotel (identidad no se toca) |
| `accommodationType` (tipo de alojamiento) | ❌ | ✅ | Requerido | 2 — Identidad | **Página pública** (nuevo) |
| `starRating` (estrellas) | ❌ | ✅ | Recomendado | 2 — Identidad | **Página pública** (nuevo) |
| `logo` | ❌ | ✅ | Opcional | 2 — Identidad | **Página pública** (nuevo) — hoy en Configuración → Hotel, se mueve |
| `slug` (URL pública) | autogenerado en signup | ✅ | — (no se edita en wizard) | — | Ya vive en Página pública → General |

## B. Contacto y propietario

| Campo | Reciclado | Público | Prioridad | Paso wizard | Destino final |
|---|---|---|---|---|---|
| `phone` (teléfono principal) | ✅ (registro) | ✅ | **Requerido** — decisión explícita del usuario (doc 08, D1) | 1 — Bienvenida (confirmar) | **Página pública** (issue #79) — antes en Configuración → Hotel, se mueve |
| `email` | ✅ (es el email de login del dueño, pero `hotels.email` es un campo separado — ver nota) | ✅ | Requerido | 1 — Bienvenida | **Página pública** (issue #79) — antes en Configuración → Hotel, se mueve |
| `phone2` (teléfono secundario) | ❌ | ❌ | Opcional | 3 — Contacto | Configuración → Hotel |
| `website` | ❌ | ✅ | Opcional | 3 — Contacto | **Página pública** (nuevo) |
| `ownerName` (nombre del propietario) | ✅ (es el `ownerName` del registro, guardado hoy solo en `users.name`) | ❌ | Requerido | 1 — Bienvenida (confirmar) | Configuración → Hotel |
| `ownerTaxId` (CIF/NIF/RNC) | ❌ | ❌ | Opcional | 3 — Contacto | Configuración → Hotel |

**Nota — email de `hotels`**: el registro solo persiste el email en `users.email`
(login). `hotels.email` (el que ve el huésped en la landing/facturas) queda vacío
hasta que alguien lo carga en Página pública → General (issue #79; antes Configuración). Recomendación: en el paso 1 del
wizard, pre-cargar `hotels.email` con el email del dueño como sugerencia editable
(no forzar que sean el mismo, un hotel puede querer `reservas@hotel.com` en vez del
email personal del dueño) — así igual queda "reciclado" en el sentido de que no
arranca vacío.

**Resuelto (doc 08, D1)**: no existe (ni hace falta) un campo separado de
"teléfono del dueño". El pedido real era sobre `hotels.phone` (Teléfono
principal, sección "Contacto" de la pestaña Hotel) vs `hotels.phone2` (Teléfono
2) — ambos ya existen hoy. `phone` pasa a ser requerido explícito en el wizard;
`phone2` sigue opcional. Ninguna migración ni columna nueva.

## C. Ubicación — TODO se mueve a Página pública

| Campo | Reciclado | Público | Prioridad | Paso wizard | Destino final |
|---|---|---|---|---|---|
| `country` | ✅ (registro) | vía dirección | Requerido | 1 — Bienvenida (confirmar) | Configuración → Hotel (país es dato administrativo/fiscal también, no solo público — se queda) |
| `address` | ✅ (registro, aunque el form de registro lo pide como "Ciudad" — ver nota) | ✅ | Requerido | 4 — Ubicación | **Página pública** (nuevo) |
| `latitude` / `longitude` (pin del mapa) | ❌ | ✅ | Requerido | 4 — Ubicación | **Página pública** (nuevo) |
| `province` | ❌ | ✅ | Recomendado | 4 — Ubicación | **Página pública** (nuevo) |
| `municipality` | ❌ | ✅ | Opcional | 4 — Ubicación | **Página pública** (nuevo) |
| `locality` | ❌ | ✅ | Opcional | 4 — Ubicación | **Página pública** (nuevo) |
| `postalCode` | ❌ | ✅ | Opcional | 4 — Ubicación | **Página pública** (nuevo) |

**Nota — `address` viene "sucio" del registro**: el label del paso 2 del registro
dice "Ciudad" pero el valor se guarda en `hotels.address` (que se supone dirección
completa, calle + número). Esto es una inconsistencia de datos preexistente, no
inventada acá: el wizard, en el paso 4, debe **mostrar ese valor reciclado pero
pedir explícitamente que se complete/corrija como dirección real** ("Vimos que
pusiste `{{valor}}` en el registro — completá la dirección exacta para que el pin
del mapa la encuentre"), no darlo por bueno en silencio.

**✅ Implementado (2026-09-07/08) — interacción de estos campos, decisión del
usuario**: `address` es el único campo que se tipea a mano, ahora con
autocompletado (`google.maps.places.Autocomplete` con key de Google;
Nominatim `/search` como fallback sin key), restringido al país elegido. Al
elegir una sugerencia (o mover el pin, pegar un link, "usar mi ubicación") se
completan de una `latitude`/`longitude`/`province`/`municipality`/`locality`/
`postalCode` — estos 6 campos pasan a ser **de solo lectura en la UI** (nunca
se tipean directo). Cambiar `country` **limpia** los 7 campos de este bloque
(antes solo recentraba el mapa si no había coordenadas propias; ahora limpia
siempre que el país cambie de verdad, post-carga inicial). Implementado en
`composables/useHotelLocationMap.ts` (compartido) y aplicado tanto a
`pagina-publica/ubicacion.vue` como a la pestaña Ubicación de
`settings/index.vue` (todavía no eliminada, tarea 1.8 pendiente) — **el paso
4 del futuro Centro de configuración (`StepUbicacion.vue`, F3.8) debe seguir
este mismo patrón**, no el diseño original de doc 05 con inputs libres.

## D. Configuración operativa/comercial (no pública, o público-parcial)

| Campo | Reciclado | Público | Prioridad | Paso wizard | Destino final |
|---|---|---|---|---|---|
| `currency` (moneda base) | ❌ (default `USD` del modelo) | ✅ | Requerido (afecta cada precio mostrado) | 2 — Identidad | Configuración → Hotel |
| `timezone` | ❌ (default `America/Santo_Domingo`) | ❌ | Recomendado — sugerir por país elegido | 2 — Identidad | Configuración → Hotel |
| `checkIn` / `checkOut` | ❌ (defaults 15:00/12:00, razonables) | ✅ | Opcional (defaults ya sirven) | 2 — Identidad (colapsado, "usar default") | Configuración → Hotel |
| `wifiNetwork` / `wifiPassword` | ❌ | ❌ | Opcional | fuera del wizard | Configuración → Hotel (operativo puro, no aporta al alta) |
| `secondaryCurrency` + tipo de cambio | ❌ | ❌ | Opcional | fuera del wizard | Configuración → Hotel |
| PIN de tarjeta de garantía | ❌ | ❌ | Opcional | fuera del wizard | Configuración → Hotel |
| Automatización (código de puerta, payment request) | ❌ | ❌ | Opcional, depende de TTLock ya conectado | fuera del wizard | Configuración → Hotel |

## E. Políticas de reserva (público-parcial — ver auditoría, la pestaña "Condiciones" mezcla campos públicos y operativos)

| Campo | Reciclado | Público | Prioridad | Paso wizard | Destino final |
|---|---|---|---|---|---|
| `cancellationType` + política con tiers (`CancellationPolicyEditor`) | ❌ (default `flexible`) | ✅ | Recomendado | 5 — Políticas | Configuración → Condiciones (queda: es también insumo de facturación/reembolsos internos) |
| `freeCancellation` (flag) | ❌ (default `true`) | ✅ | Recomendado | 5 — Políticas | Configuración → Condiciones |
| `depositRequired` + `depositPercent` | ❌ (defaults `true` / `30`) | ✅ | Recomendado | 5 — Políticas | Configuración → Condiciones |
| `releaseHours` | ❌ (default `0`) | ✅ | Opcional | 5 — Políticas | Configuración → Condiciones |
| `taxName` / `taxRate` | ❌ (default `ITBIS` / `18%` — **sesgado a RD, ver riesgo**) | ✅ | Requerido (afecta cada factura) | 5 — Políticas | Configuración → Condiciones |
| `weekendSurcharge`, `depositType`, `depositFixed`, `advanceType`, `advanceAmount`, `defaultPaymentMethod`, `requestReviews` | ❌ | ❌ | Opcional | fuera del wizard | Configuración → Condiciones |

**Riesgo detectado**: los defaults de `taxName`/`taxRate` en el modelo
(`hoteles/model.ts:68-69`) son `'ITBIS'` / `18.0` — específicos de República
Dominicana. Un hotel que se registra desde otro país y nunca toca el wizard/paso 5
queda facturando con un impuesto que no le corresponde. El wizard debería, como
mínimo, **no dejar pasar el paso de impuestos en silencio** cuando el país elegido
en el registro no es RD (sugerir "Sin ITBIS/impuesto local — ¿cuál aplica en tu
país?" en vez de asumir el default). Ver doc 08.

## F. Amenities

| Campo | Reciclado | Público | Prioridad | Paso wizard | Destino final |
|---|---|---|---|---|---|
| Amenities de hotel (edificio: pool/gym/spa/parking/etc.) | ❌ | ✅ (`hotels.amenities`) | Recomendado | 6 — Amenities y niños | **Página pública** (ya vive ahí, en `general.vue`) |
| Amenities por habitación (catálogo `interior/exterior/services`, tab "Amenities" de Configuración) | ❌ | ❌ (no aparece en `getPublicHotelInfo`) | Opcional, fuera del wizard | fuera del wizard | Configuración → Amenities (se queda, es operativo/inventario) |

Ver doc 08 sobre la duda de si son de verdad dos sistemas distintos o una
duplicación a limpiar — no se resuelve acá, se documenta.

## G. Política de niños

| Campo | Reciclado | Público | Prioridad | Paso wizard | Destino final |
|---|---|---|---|---|---|
| `acceptChildren` | ❌ (asumir `true` como default sensato) | ✅ (vía `childPolicy` del DTO público) | Recomendado | 6 — Amenities y niños | Configuración → Niños (se queda — es política operativa de reservas, aunque el resultado sea público) |
| `maxChildAge` / `maxFreeAge` | ❌ | ✅ | Opcional (default razonable) | 6 — Amenities y niños | Configuración → Niños |

## H. Fuera del wizard por completo (quedan solo en Configuración, sin tocar)

Estos campos son 100% operativos, no público, y no aportan a un alta guiada de
primera vez — se dejan exactamente donde están:

- Tipos de habitación y capacidad (`room-types` tab) — depende de que ya existan
  habitaciones cargadas, que es un paso operativo posterior (onboarding existente).
- Contactos de emergencia (`emergency` tab).
- Días laborables / RRHH (`hr` tab).
- Integraciones (pasarelas de pago, WhatsApp, facturación electrónica) — cada una
  ya tiene su propio flujo de configuración con credenciales externas, no encaja
  en un wizard de "perfil del hotel".
- Texto de políticas para factura (`invoicePolicyText`).

## I. Resumen — qué pasos tiene el "Centro de configuración"

> Actualizado tras doc 08 (D2/D4): ya no es un wizard lineal de "Paso 1 de 7" —
> es una lista de pasos tipo acordeón (mismo sistema que `OnboardingGuide.vue`
> hoy), con pasos de **perfil** (contenido propio, se completan inline al
> expandir) y pasos **operativos** (son un botón hacia su pantalla real). Ver
> [05-ux-wizard-onboarding.md](./05-ux-wizard-onboarding.md) para el detalle.

Pasos de perfil (contenido inline):
1. **Bienvenida**: confirma nombre del hotel, país, teléfono principal (ahora
   requerido), email, nombre del dueño — todo pre-cargado desde el registro.
2. **Identidad**: tipo de alojamiento, estrellas, logo (opcional), moneda,
   zona horaria (sugerida por país), horarios check-in/out (colapsado con default).
3. **Contacto**: teléfono 2, sitio web, CIF/NIF/RNC del propietario — todo opcional.
4. **Ubicación**: dirección completa + mapa + provincia/municipio/CP.
5. **Políticas de reserva**: cancelación, depósito, impuestos.
6. **Amenities y niños**: amenities del hotel + política de niños.

Pasos operativos (botón hacia la pantalla real, sin formulario inline — ya
existen en `OnboardingUseCase`, no se tocan):
7. **Habitaciones** → `/panel/config/habitaciones`
8. **Tarifas** → `/panel/config/tarifas`
9. **Canales de venta** → `/panel/channel-manager`
10. **Equipo** → `/panel/rrhh/team`

Detalle de copy, validación y UI de cada paso en
[05-ux-wizard-onboarding.md](./05-ux-wizard-onboarding.md).
