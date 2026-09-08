# Paquete de tareas 1-10 — Confirmación (F0) + arranque de Ubicación (F1)

> Este archivo junta las primeras 10 tareas del plan (`../07-plan-fases-implementacion.md`)
> en un solo documento para entregar a una IA de trabajo. Las tareas originales
> (`f0-01` a `f0-05`, `f1-01` a `f1-05`) se retiraron de `tareas/` — este archivo
> es ahora la fuente para ese rango. El resto de las tareas (F1.6 en adelante)
> sigue en archivos individuales, ver `tareas.md` (índice).

**Orden de ejecución dentro de este paquete**: 0.1 → 0.2 → 0.3 → 0.4 → 0.5
(F0, sin código de producción) → 1.1 → 1.2 → 1.3 → 1.4 → 1.5 (F1, primer tramo:
composable de mapa + shell de la pestaña Ubicación + guardado aislado).
Algunas tareas son independientes entre sí (marcado en cada una) y se pueden
adelantar, pero respetar el orden entre fases: **F0 completa antes de dar F1
por cerrada**, aunque el código de F1 se puede empezar en paralelo si no
depende de una decisión pendiente de F0 (ver cada tarea).

**Gate de verificación**, aplica al terminar la tarea 1.5 (no antes, F0 no
toca código):
```
cd backend && bun run typecheck
cd backend && bun run node_modules/arckode-framework/bin/arckode.js analyze   # ✅ VÁLIDO, 0 violaciones
cd backend && bun test
cd frontend && bun run typecheck   # vue-tsc -b
cd frontend && bun run build       # termina en "✓ built"
```
(El gate formal de fin-de-fase F1 completa —con las tareas 1.6 a 1.10— vive en
`f1-10-gate-verificacion.md`, fuera de este paquete.)

---

## Tarea 0.1 — Reproducir el bug de guardado de tipo/estrellas

**Fase**: F0 — Confirmación y reproducción
**Depende de**: ninguna
**Bloquea**: nada directamente, pero conviene resolverla antes de tocar `settings/index.vue` en F1

### Qué hacer

El usuario reportó problemas guardando **tipo de alojamiento** (`accommodationType`)
y **estrellas** (`starRating`) desde Configuración → Hotel. La auditoría estática
(`../01-auditoria-estado-actual.md`, sección 3.3) no encontró una causa obvia en
el código — ambos campos están correctamente declarados en frontend y backend.
La hipótesis más probable es que el guardado global (`saveAll()`) está fallando
por **otro** campo inválido en la pestaña Ubicación o Condiciones (bug 3.1: un
solo botón "Guardar" valida las 3 pestañas juntas), y la sensación del usuario
es "no guardó tipo/estrellas" cuando en realidad no guardó nada de las 3.

Pasos:
1. Levantar el entorno de dev (`cd backend && bun run dev`, `cd frontend && bun run dev`).
2. Loguearse con un hotel de prueba.
3. Ir a Configuración → Hotel, editar `accommodationType` y `starRating`.
4. Sin tocar nada más, guardar — confirmar si persiste correctamente.
5. Ahora, ir a la pestaña Ubicación y dejar un campo en un estado que dispare
   `HOTEL_RULES` inválido (ej. latitud/longitud fuera de rango, o un campo
   requerido vacío).
6. Volver a Hotel, editar `accommodationType`/`starRating`, guardar — confirmar
   si el guardado global bloquea por el campo inválido de Ubicación.

### Criterio de aceptación

Un párrafo agregado a `../01-auditoria-estado-actual.md` sección 3.3,
confirmando o descartando la hipótesis del guardado acoplado (bug 3.1) como
causa real. No se toca código de producción en esta tarea — es solo
diagnóstico.

### Referencias

- `../01-auditoria-estado-actual.md` secciones 3.1 y 3.3

---

## Tarea 0.2 — Confirmar endpoint de editar perfil de usuario

**Fase**: F0 — Confirmación y reproducción
**Depende de**: ninguna
**Bloquea**: F3.5 (`StepBienvenida.vue` necesita saber cómo editar `ownerName`)

### Qué hacer

El paso "Bienvenida" del Centro de configuración necesita permitir editar
`ownerName` (nombre del propietario, hoy solo se graba en `users.name` al
registrarse — ver `../02-clasificacion-de-campos.md`, sección B). Buscar en
`backend/src/modules/usuarios/` si ya existe un endpoint que permita a un
usuario logueado editar su propio nombre, o si solo existe:
- alta (`signup`, ya usado en el registro), y/o
- edición de OTROS usuarios por un admin (gestión de equipo).

Revisar también `controller.ts`/`index.ts` del módulo `usuarios` y cualquier
guard de permisos que aplique (`requirePermission('users', 'edit')` podría
estar pensado solo para editar a otros, no a uno mismo).

### Criterio de aceptación

`../06-arquitectura-tecnica.md`, sección 2 (tabla de endpoints), actualizado
con:
- el endpoint real encontrado (método + path) si existe, o
- la conclusión "no existe, hace falta crear uno nuevo — método `PUT
  /api/usuarios/me` o similar" si no existe, agregado como tarea nueva si se
  decide que es trabajo de backend (sumarla a F2).

### Referencias

- `../02-clasificacion-de-campos.md` sección B, nota sobre `ownerName`
- `../06-arquitectura-tecnica.md` sección 2

---

## Tarea 0.3 — Confirmar fuente de centros lat/lng por país

**Fase**: F0 — Confirmación y reproducción
**Depende de**: ninguna
**Bloquea**: 1.2 (fix de centrado del mapa por país)

### Qué hacer

Antes de escribir una tabla `COUNTRY_CENTER` (país → `{lat, lng}` aproximado)
desde cero, buscar si el repo ya tiene algo así:

```
rg "lat.*lng|latitude.*longitude" frontend/src/data/
rg "COUNTRY_CENTER|countryCenter|country.*coord" frontend/src backend/src
```

Revisar en particular `frontend/src/data/locales.ts` (ya tiene `COUNTRIES`,
puede que algún campo de centro exista o sea fácil de sumar ahí) y cualquier
paquete npm ya instalado que traiga esta data (poco probable pero vale
chequear `package.json`).

### Criterio de aceptación

`../06-arquitectura-tecnica.md`, sección 6, actualizado con:
- la fuente real a reusar (path del archivo + shape), o
- confirmación de que hay que crearla desde cero, con la lista de países que
  cubre `COUNTRIES` (para dimensionar cuántas entradas hacen falta).

### Referencias

- `../06-arquitectura-tecnica.md` sección 6
- `../01-auditoria-estado-actual.md` sección 3.2 (bug de centrado)

---

## Tarea 0.4 — Investigar el duplicado de amenities (D3)

**Fase**: F0 — Confirmación y reproducción
**Depende de**: ninguna
**Bloquea**: F3.10 (`StepAmenities.vue` necesita saber qué catálogo usar)

### Qué hacer

Hay dos sistemas paralelos etiquetados "amenities del hotel" (ver
`../01-auditoria-estado-actual.md` sección 6 y `../08-decisiones-abiertas-y-riesgos.md`
D3):

1. Configuración → pestaña **Amenities**: `GET /amenities/catalog` (categorías
   interior/exterior/servicios) + `HotelService.saveAmenitiesHotel()`.
2. Página pública → **"Amenities del hotel"** (`general.vue`): catálogo fijo
   `HOTEL_AMENITY_CATALOG` (de `components/landing/landing-icons.ts`),
   persiste directo en `hotels.amenities` (columna JSON).

Investigar en el backend qué tabla/modelo hay detrás de `saveAmenitiesHotel` —
buscar el módulo/usecase real (`rg "saveAmenitiesHotel|amenities/catalog"
backend/src`) y confirmar si:
- (a) es la MISMA columna `hotels.amenities` leída/escrita por dos catálogos
  distintos del frontend (bug real, hay que unificar), o
- (b) son dos conceptos genuinamente distintos (ej. uno es
  "servicios/instalaciones visibles en la landing" y el otro es algo interno
  que coincide en nombre por casualidad).

### Criterio de aceptación

`../08-decisiones-abiertas-y-riesgos.md` D3 actualizada de "abierta" a
resuelta, con:
- si es (a): la decisión de cuál de los dos catálogos/tabs se queda, y una
  tarea nueva agregada a F1 o F5 para eliminar el duplicado.
- si es (b): una nota clara de por qué son cosas distintas, para que
  `StepAmenities.vue` (F3.10) sepa con certeza qué catálogo mostrar.

### Referencias

- `../01-auditoria-estado-actual.md` sección 6
- `../08-decisiones-abiertas-y-riesgos.md` D3
- `../02-clasificacion-de-campos.md` sección F

---

## Tarea 0.5 — Cerrar D5 y D6 con el usuario

**Fase**: F0 — Confirmación y reproducción
**Depende de**: ninguna
**Bloquea**: F3.14 (copy final), F4.1 (comportamiento de descarte de la franja)

### Qué hacer

Dos decisiones de producto que solo el usuario puede responder (ver
`../08-decisiones-abiertas-y-riesgos.md`):

- **D5**: ¿se permite ocultar/descartar la franja de progreso del dashboard?
  Recomendación del plan: no ofrecer descarte (la franja es tan discreta que
  no debería necesitarlo). Si el usuario prefiere lo contrario, definir si el
  descarte persiste en backend o alcanza con sesión.
- **D6**: nombre y copy definitivo del "Centro de configuración" — el plan usa
  ese nombre y el copy de `../05-ux-wizard-onboarding.md` como punto de
  partida, no como texto aprobado.

### Criterio de aceptación

`../08-decisiones-abiertas-y-riesgos.md` D5 y D6 marcadas resueltas, con la
respuesta del usuario documentada. Si D6 cambia el nombre de la pantalla,
actualizar también la ruta sugerida (`/panel/configuracion-inicial`) en
`../03-arquitectura-informacion.md` y `../06-arquitectura-tecnica.md` si
corresponde.

### Referencias

- `../08-decisiones-abiertas-y-riesgos.md` D5, D6

---

## Tarea 1.1 — Crear composable de mapa de ubicación

**Fase**: F1 — Mover Ubicación a Página pública
**Depende de**: ninguna (se puede arrancar sin esperar a F0, salvo el fix de país que sí depende de 0.3)
**Bloquea**: 1.2, 1.4, F3.8

### Qué hacer

Extraer, **sin cambiar comportamiento todavía**, la lógica de mapa que hoy
vive inline en el script de `frontend/src/pages/settings/index.vue`
(~línea 1710-1930) a un composable nuevo:

```
frontend/src/composables/useHotelLocationMap.ts
```

Mover tal cual: `mapEl`, `mapsInteractive`, `googleMapsEmbedUrl`,
`googleMapsLinkUrl`, `applyMapsPaste`, `useMyLocation`, `syncMarkerFromForm`,
`reverseGeocode`, `initMap` y los listeners del pin. El composable recibe
`form` (ref reactivo con `country`/`address`/`latitude`/`longitude`/etc.) como
parámetro y expone la misma interfaz que ya consume `settings/index.vue` hoy.

`settings/index.vue` pasa a importar y usar el composable en vez de tener la
lógica inline.

### Criterio de aceptación

El mapa de Configuración → Ubicación sigue funcionando **exactamente igual**
que antes de este cambio (clic para mover el pin si hay Maps key, pegar
link/coordenadas si no, autocompletar provincia/municipio/CP) — sin
regresión, todavía sin el fix del país (eso es la tarea 1.2). `cd frontend &&
bun run typecheck` limpio.

### Referencias

- `../06-arquitectura-tecnica.md` sección 6
- `../01-auditoria-estado-actual.md` sección 3.2

---

## Tarea 1.2 — Fix de centrado del mapa por país

**Fase**: F1 — Mover Ubicación a Página pública
**Depende de**: 1.1 (composable creado), 0.3 (fuente de centros por país confirmada)
**Bloquea**: nada

### Qué hacer

Corrige el bug 3.2 de la auditoría (`../01-auditoria-estado-actual.md`): hoy
el mapa arranca siempre centrado en Santo Domingo (`DEFAULT_LAT`/`DEFAULT_LNG`
fijos) sin importar el país del hotel.

Dentro de `useHotelLocationMap.ts` (tarea 1.1), agregar:

```ts
const COUNTRY_CENTER: Record<string, { lat: number; lng: number }> = {
  // poblar con la fuente confirmada en 0.3
}

watch(() => form.value.country, (country) => {
  // Solo recentra si TODAVÍA no hay coordenadas propias del hotel —
  // nunca pisa un pin que el usuario ya movió a mano.
  if (form.value.latitude && form.value.longitude) return
  const center = COUNTRY_CENTER[country]
  if (center) { mapLat.value = center.lat; mapLng.value = center.lng; recenterMap() }
})
```

### Criterio de aceptación

- Hotel **sin** coordenadas propias: cambiar el país en el form → el mapa se
  recentra al centro aproximado de ese país.
- Hotel **con** coordenadas ya cargadas: cambiar el país → el pin **no se
  mueve** (no pisa un valor real que el usuario ya fijó).
- Test agregado o caso manual documentado cubriendo ambos casos.

### Referencias

- `../01-auditoria-estado-actual.md` sección 3.2
- `../06-arquitectura-tecnica.md` sección 6

---

## Tarea 1.3 — Shell de la pestaña Ubicación en Página pública

**Fase**: F1 — Mover Ubicación a Página pública
**Depende de**: ninguna (puede ir en paralelo con 1.1/1.2)
**Bloquea**: 1.4

### Qué hacer

Crear `frontend/src/pages/pagina-publica/ubicacion.vue` copiando el patrón
exacto de `frontend/src/pages/pagina-publica/general.vue`:

- Loading skeleton mientras carga.
- `onMounted` con `SettingsService.get()`.
- Snapshot de "cambios sin guardar" (`markClean`, `isDirty`).
- `onBeforeRouteLeave` + `warnOnUnsavedChanges` (mismo patrón que `general.vue`).

Todavía **sin** los campos de ubicación en sí — solo el esqueleto que carga y
no rompe nada. Los campos van en la tarea 1.4.

### Criterio de aceptación

La ruta nueva renderiza sin error, muestra el loading skeleton y después una
pantalla vacía (o con un placeholder "próximamente"); no hay warnings de
consola ni errores de typecheck.

### Referencias

- `frontend/src/pages/pagina-publica/general.vue` (patrón a calcar)
- `../03-arquitectura-informacion.md`

---

## Tarea 1.4 — Completar campos de Ubicación

**Fase**: F1 — Mover Ubicación a Página pública
**Depende de**: 1.1, 1.2 (composable de mapa con fix de país), 1.3 (shell creado)
**Bloquea**: 1.5

### Qué hacer

Completar `ubicacion.vue` con los campos reales: dirección, mapa (usando
`useHotelLocationMap` de las tareas 1.1/1.2), coordenadas,
provincia/municipio/localidad/código postal — mismo markup que tenía la
pestaña `location` de `settings/index.vue` (se puede mover el HTML casi
literal, ver `../01-auditoria-estado-actual.md` para las líneas exactas del
código actual).

### Criterio de aceptación

Un hotel puede ver su ubicación actual pre-cargada, mover el pin (clic si hay
Maps key configurada, o pegar link/coordenadas si no), y los campos de
provincia/municipio/CP se autocompletan con reverse geocoding igual que hoy
lo hace Configuración → Ubicación.

### Referencias

- `../02-clasificacion-de-campos.md` sección C
- `frontend/src/pages/settings/index.vue` (markup original de la pestaña `location`)

---

## Tarea 1.5 — Guardado aislado de Ubicación

**Fase**: F1 — Mover Ubicación a Página pública
**Depende de**: 1.4
**Bloquea**: `f1-10-gate-verificacion.md` (gate de fin de fase F1, fuera de este paquete)

### Qué hacer

Implementar la función `save()` propia de `ubicacion.vue`:

```ts
await SettingsService.patchHotel({
  address, latitude, longitude, province, municipality, locality, postalCode,
})
```

Aislada — sin depender de ninguna validación de otras pantallas (fix directo
del bug 3.1 para estos campos, ver `../01-auditoria-estado-actual.md`
sección 3.1).

### Criterio de aceptación

Dejar **a propósito** un campo inválido/vacío en Configuración → Hotel (ej.
`name` vacío) y confirmar que guardar desde Página pública → Ubicación
**funciona igual**, sin bloquearse por ese campo ajeno. Esto es la
verificación explícita de que el acoplamiento de guardado no se heredó.

### Referencias

- `../01-auditoria-estado-actual.md` sección 3.1
- `frontend/src/pages/pagina-publica/general.vue` (mismo patrón de `save()`)
