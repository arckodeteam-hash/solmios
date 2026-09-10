# Spec — Anuncios de plataforma reales

Convención: UI en español, base de datos y API en inglés (RFC 2119: MUST/SHOULD/MAY).

---

## REQ-ANN-01 — Difusión a todos los hoteles

Un anuncio con `hotelId` nulo o vacío es un **anuncio de plataforma** y MUST ser visible para todos
los hoteles. Un anuncio con `hotelId` MUST ser visible solo para ese hotel.

El listado para un usuario que no es `super_admin` MUST devolver la unión de ambos conjuntos. NO
MUST usarse igualdad exacta contra `hotelId`, que es lo que hoy deja fuera los globales
(`anuncios/service.ts:47-52`).

El aislamiento entre hoteles MUST mantenerse: un anuncio de otro hotel NO MUST aparecer nunca.

**Given** un anuncio A con `hotelId = null` y un anuncio B con `hotelId = 'hotel-2'`
**When** un usuario del `hotel-1` lista anuncios
**Then** recibe A y NO recibe B.

**Given** el mismo escenario
**When** un usuario del `hotel-2` lista anuncios
**Then** recibe A y B.

**Given** un `super_admin` sin filtro
**When** lista anuncios
**Then** recibe A y B.

### Base de datos
Ninguna para este requisito.

### API
`GET /api/anuncios` — sin cambios de contrato; cambia a quién le devuelve qué.

### UI
La columna "Audiencia" MUST decir "Todos los hoteles" cuando no hay `hotelId`, y el nombre del hotel
—no su id— cuando lo hay.

---

## REQ-ANN-02 — Audiencia elegible y persistida

El anuncio MUST guardar a quién va dirigido en una columna `audience` con valores
`all` | `hotel` | `admins`:

- `all` — todos los usuarios de todos los hoteles.
- `hotel` — todos los usuarios del `hotelId` indicado. Con `audience = 'hotel'`, `hotelId` MUST ser
  obligatorio; el servidor MUST rechazar con 400 si falta.
- `admins` — solo usuarios con rol `hotel_admin` (o `super_admin`), en todos los hoteles o en el
  hotel indicado.

La selección del panel MUST viajar en el `POST`. Hoy los dos checkboxes existen en el formulario y no
se mandan (`announcements.vue:134,138`).

Solo un `super_admin` MUST poder crear un anuncio con `audience = 'all'` o `'admins'`. Un `merchant`
con permiso `dashboard:create` MUST quedar acotado a su propio hotel (409/403, nunca creación
silenciosa con otro alcance).

**Given** un anuncio con `audience = 'admins'` y `hotelId = null`
**When** lo lista un usuario con rol `receptionist`
**Then** no lo recibe.

**Given** el mismo anuncio
**When** lo lista un usuario con rol `hotel_admin`
**Then** lo recibe.

**Given** un `merchant` del `hotel-1` que envía `audience: 'all'`
**When** llama a `POST /api/anuncios`
**Then** recibe 403 y no se crea ninguna fila.

### Base de datos
`announcements`: columna `audience` TEXT, default `'hotel'` para las filas existentes (que hoy
siempre tienen `hotelId`). Campo declarado en el `orm.define` — si no se declara, el ORM lo descarta
sin avisar (CLAUDE.md, anti-patrón ORM).

### API
`POST /api/anuncios` acepta `audience`. `CreateAnunciosSchema` MUST validar el enum.

### UI
El bloque "Audiencia" MUST ser un selector de tres opciones excluyentes, no dos checkboxes que se
pueden marcar juntos y hoy significan lo mismo que no marcar nada. Al elegir "Un hotel" MUST
aparecer el selector de hotel.

---

## REQ-ANN-03 — Vigencia y publicación programada

El anuncio MUST tener `startsAt` y `endsAt` (ambos opcionales, ISO 8601).

El listado que alimenta el banner MUST excluir todo anuncio cuyo `startsAt` sea futuro o cuyo
`endsAt` ya pasó, evaluado contra la hora del servidor. La exclusión MUST hacerse en la consulta, no
filtrando en el cliente: un anuncio programado NO MUST viajar al navegador antes de su fecha.

`endsAt` MUST ser posterior a `startsAt` cuando ambos existan; el servidor rechaza con 400 si no.

**Given** un anuncio con `startsAt` mañana
**When** un hotel lista sus anuncios hoy
**Then** no lo recibe, y la respuesta HTTP no contiene su texto.

**Given** un anuncio con `endsAt` ayer y `active = 1`
**When** un hotel lista sus anuncios
**Then** no lo recibe.

**Given** un anuncio sin `startsAt` ni `endsAt`
**When** un hotel lista sus anuncios
**Then** lo recibe (el comportamiento actual no cambia para los anuncios ya creados).

### Base de datos
`announcements`: columnas `startsAt` TEXT, `endsAt` TEXT. Ambas nulas en las filas existentes = sin
vigencia acotada.

### API
`GET /api/anuncios?scope=active` (default para el banner) aplica la ventana.
`GET /api/anuncios?scope=all` (solo `super_admin`) devuelve también los programados y los vencidos,
que es lo que necesita la tabla del panel.

### UI
La tarjeta "Programación" MUST listar los anuncios con `startsAt` futuro, con su fecha y su
audiencia, y MUST mostrar el estado vacío solo cuando de verdad no hay ninguno
(`announcements.vue:221` hoy la deja vacía siempre). El formulario MUST permitir elegir "Publicar
ahora" o "Programar", y una fecha de fin opcional.

---

## REQ-ANN-04 — Lecturas por usuario

El sistema MUST registrar, por usuario y anuncio: cuándo lo vio (`seenAt`) y cuándo lo cerró
(`dismissedAt`).

El "no volver a mostrar" MUST ser **por usuario**. Hoy se guarda en
`configuration('dismissed_announcements', hotelId)` (`AnnouncementBanner.vue:66,77`): el primer
empleado que cierra el aviso se lo oculta a todo el hotel, dueño incluido.

El registro de vista MUST ser idempotente: mostrar el banner N veces deja UNA fila con el primer
`seenAt`.

El registro NO MUST bloquear ni romper el render del banner: si la llamada falla, el aviso se muestra
igual.

**Given** un anuncio activo y un usuario que nunca lo vio
**When** el banner se renderiza dos veces (dos recargas)
**Then** existe exactamente una fila en `announcement_reads` para ese par, con el `seenAt` de la
primera.

**Given** el usuario A que cierra el anuncio
**When** el usuario B del mismo hotel entra al panel
**Then** B sigue viendo el anuncio.

**Given** que el endpoint de registro devuelve 500
**When** el banner se renderiza
**Then** el anuncio se muestra igual y no aparece ningún error al usuario.

### Base de datos
Tabla nueva `announcement_reads`: `id` TEXT PK, `announcementId` TEXT, `userId` TEXT, `hotelId` TEXT,
`seenAt` TEXT, `dismissedAt` TEXT, timestamps. Índice único `(announcementId, userId)` creado con
`CREATE UNIQUE INDEX` explícito — el ORM no crea únicos compuestos (CLAUDE.md).

### API
`POST /api/anuncios/:id/seen` → marca visto (idempotente).
`POST /api/anuncios/:id/dismiss` → marca cerrado para el usuario del token.

### UI
El banner MUST llamar a `seen` al mostrarse y a `dismiss` en el ✕, y MUST dejar de escribir en
`configuration('dismissed_announcements')`.

---

## REQ-ANN-05 — Alcance y apertura medidos

La tarjeta "Alcance" MUST mostrar datos calculados: hoteles activos, usuarios activos, y la tasa de
apertura del último anuncio difundido (leídos ÷ destinatarios).

La columna "Vistas / leídos" de la tabla MUST venir del servidor. Ningún número de esta pantalla MUST
estar escrito en el HTML (hoy: `announcements.vue:72,76,80,84,237`).

Cuando todavía no hay lecturas registradas, la UI MUST mostrar "—" o "sin datos", NUNCA un cero que
se lea como "nadie lo abrió".

**Given** un anuncio `audience = 'all'`, 3 hoteles con 10 usuarios en total y 4 lecturas
**When** el super_admin abre la pantalla
**Then** la fila muestra `4` vistas sobre `10` destinatarios y la tasa de apertura dice `40%`.

**Given** un anuncio creado hace un minuto y sin lecturas
**When** el super_admin abre la pantalla
**Then** la tasa dice "sin datos", no `0%`.

### Base de datos
Ninguna nueva: se agrega sobre `announcement_reads`, `hotels` y `users`.

### API
`GET /api/admin/announcements` MUST incluir por fila `recipients`, `seenCount`, `dismissedCount`.
`GET /api/admin/announcements/reach` → `{ hotels, users, lastAnnouncement: { id, openRate } | null }`.
Ambos `super_admin` + `requireUserType('admin')`.

### UI
Tarjeta "Alcance" y columna "Vistas" leen de esos dos endpoints.

---

## REQ-ANN-06 — Invalidación de caché del listado

Publicar, editar o borrar un anuncio MUST reflejarse en el listado de los hoteles de inmediato.

Hoy no pasa: el listado guarda `anuncios:list:<hotelId>:p<page>:l<limit>:<filtros>`
(`anuncios/service.ts:62`) y la escritura borra `anuncios:list:<hotelId>` (`:93,106,119`), una clave
que no existe. `CacheAdapter` solo borra claves exactas — no hay glob ni prefijo. El hotel puede
tardar hasta `CACHE_TTL` (300 s) en ver un anuncio urgente.

La invalidación MUST hacerse con un token de versión, igual que en `facturas/usecases/cache.ts` y
`folios/usecases/cache.ts`.

**Given** un anuncio listado y por lo tanto cacheado
**When** el super_admin publica uno nuevo y el hotel vuelve a listar dentro de los 300 s
**Then** el nuevo aparece.

### Base de datos
Ninguna.

### API
Sin cambios de contrato.

### UI
Ninguna.

---

## REQ-ANN-07 — Plantillas guardadas

La tarjeta "Plantillas Guardadas" MUST usar plantillas persistidas y MUST rellenar el formulario al
hacer clic. Si no se implementa la persistencia, la tarjeta MUST eliminarse: una lista que se ve
clickeable y no responde es peor que no tenerla (`announcements.vue:214-219`).

Las plantillas son de la plataforma, no de un hotel, y MUST guardarse en
`configuration(key = 'announcement_templates', hotelId = 'platform')`.

**Given** una plantilla guardada con título y cuerpo
**When** el super_admin la clickea
**Then** el modal se abre con el título, el tipo y el mensaje precargados, y sigue siendo editable
antes de publicar.

### Base de datos
Ninguna: clave en la tabla `configuration` existente.

### API
`GET`/`PUT /api/configuracion` con `clave = 'announcement_templates'` (super_admin).

### UI
Clic en plantilla = abre el modal precargado. Con la lista vacía, estado vacío explícito.

---

## REQ-ANN-08 — Coherencia de tipos y prioridad

El conjunto de tipos y prioridades MUST ser el mismo en validador, tipos de TypeScript, panel y
banner.

- `priority` MUST aceptar `urgent`: el banner ya lo pinta (`AnnouncementBanner.vue:13`) y el
  validador lo rechaza (`validators/schema.ts:7`), así que el badge de urgencia es inalcanzable.
- `AnnouncementType` (backend `types.ts`) MUST incluir `feature` y `promo`, que el validador ya
  acepta y el panel ya ofrece.

**Given** un `POST` con `priority: 'urgent'`
**When** lo envía el super_admin
**Then** responde 201 y el banner muestra el badge "URGENT".

### Base de datos
Ninguna (`priority` ya es TEXT).

### API
`CreateAnunciosSchema` / `UpdateAnunciosSchema`: `PRIORITY_ENUM` incluye `urgent`.

### UI
El selector de tipo del panel MUST ofrecer exactamente los valores del enum, sin opciones que el
servidor rechace.
