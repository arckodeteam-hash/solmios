# Arquitectura de la información — dónde vive cada cosa después del refactor

## Página pública — nueva pestaña "Ubicación"

Hoy `pagina-publica-tabs.ts` tiene: General · Landing · Media · Apariencia ·
Motor de reservas · Códigos de descuento · Reputación · Tracking.

Se agrega una pestaña nueva **"Ubicación"** (grupo "Contenido", al lado de
General), que absorbe exactamente lo que hoy es la pestaña "Ubicación" de
Configuración (`settings/index.vue:318-419`): país (¿o se queda en Configuración?
— ver nota), dirección, mapa, coordenadas, provincia/municipio/localidad/CP.

```ts
// config/pagina-publica-tabs.ts — agregar:
{ value: 'ubicacion', label: 'Ubicación', path: '/panel/pagina-publica/ubicacion', roles: ['hotel_admin'], group: 'Contenido' },
```

Se crea `frontend/src/pages/pagina-publica/ubicacion.vue` siguiendo el mismo
patrón que `general.vue`: `SettingsService.get()` para cargar, `SettingsService.
patchHotel()` para guardar, snapshot propio de "cambios sin guardar", sin
compartir el `form` gigante de `settings/index.vue`. Esto por sí solo **resuelve el
bug 3.1** de la auditoría para estos campos: dejan de estar acoplados a la
validación de Hotel/Condiciones porque pasan a ser un formulario propio con su
propio botón Guardar, igual que ya pasó con `general.vue`.

**`accommodationType`, `starRating` y `logo`** también se mueven a Página pública
— la elección natural es agregarlos a `general.vue` (ya tiene la tarjeta de
identidad pública) en vez de crear una tercera pestaña solo para 3 campos.

**`website`** se agrega también a `general.vue` (o a `ubicacion.vue` si se
prefiere agrupar con contacto — ver doc 08, no es una decisión crítica).

### Nota — ¿`country` se muda también?

`country` aparece en el DTO público solo indirectamente (no está en el allow-list
de `getPublicHotelInfo`, la dirección visible es `address`/`province`/etc., sin
`country` explícito). Pero es un dato que también determina moneda/timezone/tax
por default y aparece en facturas. **Recomendación: `country` se queda en
Configuración → Hotel** (es más "identidad administrativa" que "contenido
público"), y la pestaña Ubicación de Página pública muestra el país ya elegido
como texto de solo lectura con un link "cambiar en Configuración" — así no hay
dos lugares editando el mismo campo.

## Configuración (`settings/index.vue`) — qué queda

Después de sacar Ubicación (pestaña completa) y accommodationType/starRating/logo/
website (campos sueltos de la pestaña Hotel), el tab **Hotel** queda con:
identidad (nombre, tipo — ojo, tipo se va, ver arriba), contacto (teléfono,
teléfono2, email), WiFi, propietario (nombre, CIF/NIF/RNC), estadía y moneda
(check-in/out, timezone, currency), conversión de moneda, PIN de garantía,
automatización.

Tabs que se quedan intactas: Condiciones, Niños, Tipos de habitación, Emergencias,
RRHH, Amenities, Integraciones.

**Grupo de tabs**: con Ubicación afuera, el grupo "Config. administrativo" pasa de
7 a 6 pestañas — más manejable, aunque no es el objetivo principal de este cambio.

## El "Centro de configuración" — pantalla propia, no una pestaña de Configuración ni de Página pública

> Actualizado (doc 08, D2): dejó de ser un modal lineal — es una pantalla propia
> con acordeón de pasos. Ver [05-ux-wizard-onboarding.md](./05-ux-wizard-onboarding.md).

Vive en su propia ruta (ej. `/panel/configuracion-inicial`), separada de
Configuración y de Página pública. Se llega ahí desde:
1. El botón "Completar" de la franja discreta del dashboard.
2. Una entrada de menú ("Asistente de configuración" o similar) para quien
   quiera reabrirla después de terminada (útil si completó todo lo requerido
   pero quiere repasar o cargar algo opcional que saltó).

**Por qué escribe en los mismos endpoints que Configuración/Página pública**:
cada paso de perfil persiste con `PUT /api/settings/hotel` (patch parcial) al
guardar ESE paso — no inventa una tabla ni un estado paralelo de "borrador".
Cerrar la pantalla a mitad de camino no pierde lo ya guardado; solo se pierde lo
que estaba tipeado en un paso todavía no guardado, que es el comportamiento
esperable de cualquier formulario del panel.

## Diagrama de flujo de datos

```
Registro (auth/register.vue)
  └─> POST /api/public/signup
        └─> hotels.{name,country,address,phone}, users.{name,email,password}
              │
              ▼
Dashboard (dashboard/index.vue)
  └─> OnboardingProgressBar (nuevo, reemplaza OnboardingGuide)
        └─> GET /api/onboarding/status (extendido, ver doc 06)
              │  (progreso combinado: perfil del hotel + operativo)
              ▼
        [botón "Completar"]
              │
              ▼
      Centro de configuración (pantalla propia, acordeón de pasos)
        ├─ Bienvenida    → PUT /api/settings/hotel (name,country,phone[requerido],email,ownerName)
        ├─ Identidad     → PUT /api/settings/hotel (accommodationType,starRating,logo,currency,timezone,checkIn,checkOut)
        ├─ Contacto      → PUT /api/settings/hotel (phone2,website,ownerTaxId)
        ├─ Ubicación     → PUT /api/settings/hotel (address,lat,lng,province,municipality,locality,postalCode)
        ├─ Políticas     → PUT /api/settings/hotel + PUT /api/cancellation-policies/base
        ├─ Amenities     → PUT /api/settings/hotel (amenities) + política de niños (endpoint existente)
        └─ Habitaciones / Tarifas / Canales / Equipo → botón, navega a la pantalla real (sin persistencia propia acá)
              │
              ▼
      Página pública (pagina-publica/general.vue, ubicacion.vue)
        └─ Mismos campos, editables después del wizard, sin volver a pasar por él
```

## Por qué este approach y no otros — comparación rápida

| Opción | Pro | Contra | ¿Se elige? |
|---|---|---|---|
| Centro de configuración escribe en un borrador propio, confirma todo al final | Se puede "cancelar" sin efectos secundarios | Requiere endpoint/tabla nueva de borrador; riesgo de perder todo si el usuario cierra a mitad de camino; duplica validación | No |
| Cada paso escribe directo en los endpoints reales al guardarse (elegido) | Reutiliza toda la validación/persistencia que ya existe; cerrar a mitad de camino no pierde lo ya guardado | Un paso a medio completar (tipeado, no guardado) se pierde al cerrar — comportamiento esperable, no un borrador silencioso | Sí |
| Wizard modal lineal ("Paso 1 de 7") | Fuerza un orden, sensación de progreso lineal clara | El usuario pidió explícitamente reusar el sistema actual de acordeón, no un flujo forzado (doc 08, D2) | No — descartado por decisión del usuario |
| Mover TODO settings/index.vue a componentes del Centro de configuración | Elimina la pantalla de Configuración vieja de una | Rompe la edición post-alta (Configuración también sirve para editar después, no solo para el alta inicial); alcance mucho mayor | No — fuera de alcance, ver doc 00 |
