# Spec — Monitoreo real de la plataforma

Convención: UI en español, base de datos y API en inglés (RFC 2119: MUST/SHOULD/MAY).

---

## REQ-MON-01 — Instrumentación de peticiones HTTP

El sistema MUST registrar cada petición HTTP servida por el backend con: método, ruta normalizada,
código de estado y duración en milisegundos.

La ruta MUST normalizarse antes de agregarse: todo segmento que sea un UUID, un ULID o un número
MUST reemplazarse por `:id`. Sin esto, `/api/reservas/<uuid>` genera una entrada nueva por reserva.

El registro MUST ser en memoria y O(1), sin I/O en el camino de la petición. El agregado MUST
mantener, por ruta normalizada: cantidad, duración media, p95, máximo y cantidad de respuestas de
error.

El sistema MUST acotar la cantidad de rutas distintas registradas (MAX_ROUTES). Alcanzado el tope,
las rutas nuevas se agregan bajo la clave `otras`.

**Given** el backend recién arrancado
**When** llegan 3 peticiones a `/api/reservas/abc-123`, `/api/reservas/def-456` y `/api/hoteles`
**Then** el agregado tiene exactamente 2 rutas: `/api/reservas/:id` con `count: 2` y `/api/hoteles`
con `count: 1`.

**Given** una petición que tarda 250 ms y devuelve 200
**When** se consulta el agregado
**Then** su ruta reporta `avgMs >= 250`, `maxMs >= 250` y `errors: 0`.

### Base de datos
Ninguna. El agregado vive en memoria del proceso.

### API
`GET /api/admin/monitoring/api` (super_admin) → `{ ventanaDesde, rutas: [{ ruta, metodo, count, avgMs, p95Ms, maxMs, errors }], totales: { peticiones, erroresPct, avgMs } }`

### UI
La tarjeta de API MUST mostrar peticiones totales, latencia media y porcentaje de error de la
ventana, y MUST indicar explícitamente que la ventana empieza en el último reinicio del proceso.

---

## REQ-MON-02 — Registro de errores recientes

El sistema MUST registrar toda respuesta con estado >= 500, y toda excepción no controlada, con:
timestamp, método, ruta normalizada, estado, mensaje y (cuando exista) las primeras líneas del stack.

Los errores MUST persistirse en base de datos: un reinicio del backend NO debe borrar la evidencia
del error que pudo haberlo causado.

La persistencia MUST ocurrir fuera del ciclo de respuesta: un fallo al guardar el error NO MUST
afectar la respuesta al cliente.

El sistema SHOULD agrupar errores idénticos (misma ruta + mismo mensaje) informando la cantidad de
ocurrencias y la última vez, en lugar de repetir la misma fila.

Los errores 4xx MUST excluirse por defecto (son del cliente), salvo 429, que MUST registrarse porque
indica que el límite de tasa está actuando.

**Given** un endpoint que lanza una excepción
**When** un cliente lo llama
**Then** el cliente recibe su respuesta de error normal **y** queda una fila en `error_logs` con la
ruta, el mensaje y el stack recortado.

**Given** el mismo error ocurrido 12 veces en la misma ruta
**When** se consultan los errores recientes
**Then** aparece UNA entrada con `ocurrencias: 12` y la fecha de la última.

**Given** la tabla `error_logs` con 5.000 filas
**When** corre la retención
**Then** quedan solo las de los últimos N días (configurable, por defecto 30).

### Base de datos
Tabla `error_logs`: `id`, `hotelId` (nullable — un error puede no tener hotel), `method`, `path`,
`statusCode`, `message`, `stack`, `count`, `firstSeenAt`, `lastSeenAt`, `createdAt`, `updatedAt`.

### API
`GET /api/admin/monitoring/errors?limit=` (super_admin) → lista agrupada, más reciente primero.
`DELETE /api/admin/monitoring/errors/:id` (super_admin) → descarta una entrada resuelta.

### UI
"Errores recientes" MUST mostrar la lista real y, cuando esté vacía, un estado vacío que diga que no
hubo errores en la ventana — nunca un contador fijo sobre una lista vacía, como hoy.

---

## REQ-MON-03 — Estado real de la base de datos

El sistema MUST reportar, del motor en uso: tamaño ocupado, cantidad de tablas y cantidad de
conexiones abiertas (Postgres) o tamaño del archivo (SQLite).

El sistema MUST identificar el motor real en ejecución. Hoy la pantalla dice "PostgreSQL 16" fijo,
incluso corriendo sobre SQLite en desarrollo.

Si una métrica no puede obtenerse en el motor activo, MUST omitirse. NO MUST mostrarse un valor
inventado ni un cero que se confunda con una medición.

**Given** el backend sobre Postgres
**When** se consulta el estado
**Then** `motor: 'postgres'`, `tamanoBytes` sale de `pg_database_size(current_database())` y
`conexiones` de `pg_stat_activity`.

**Given** el backend sobre SQLite
**When** se consulta el estado
**Then** `motor: 'sqlite'`, `tamanoBytes` es el tamaño del archivo y `conexiones` viene ausente.

### Base de datos
Ninguna tabla nueva. Consultas de solo lectura al catálogo del motor.

### API
Incluido en `GET /api/admin/monitoring/system`.

### UI
La tarjeta MUST rotular el motor detectado y ocultar las métricas ausentes.

---

## REQ-MON-04 — Recursos del servidor

El sistema MUST reportar memoria del proceso (RSS y límite), uso de CPU del proceso, uso de disco de
la partición donde vive la aplicación, uptime del proceso y uptime del sistema operativo.

El uso de CPU MUST calcularse por diferencia entre dos muestras de `process.cpuUsage()`, nunca como
un valor absoluto acumulado.

El tamaño de `uploads/` MUST calcularse recorriendo el directorio, y ese recorrido MUST cachearse
(SHOULD: 5 minutos) para no recorrer el árbol en cada carga de la pantalla.

**Given** dos consultas consecutivas separadas por 2 segundos
**When** se compara el CPU informado
**Then** el valor es un porcentaje del intervalo, no un acumulado creciente.

### API
`GET /api/admin/monitoring/system` (super_admin) → `{ proceso: { uptimeS, memoriaRssMb, cpuPct }, so: { uptimeS, cargas }, disco: { totalBytes, libreBytes, usadoPct }, uploads: { bytes, archivos, calculadoEn }, db: {...} }`

### UI
Las barras de CPU, memoria y disco MUST reflejar el valor medido. Hoy están fijas en 34%, 62% y 45%.

---

## REQ-MON-05 — Backup de la base de datos

Un `super_admin` MUST poder crear un backup de la base desde el panel, listarlos, descargarlos y
borrarlos.

**Seguridad** (un backup es un volcado completo de los datos de todos los hoteles):

- El endpoint MUST exigir `userType: 'admin'` y rol `super_admin`. NO MUST alcanzar con un permiso
  de hotel.
- El archivo MUST guardarse en un directorio fuera de la raíz que sirve nginx, de modo que no sea
  descargable por URL directa.
- La descarga MUST resolverse por un endpoint autenticado que valide el identificador contra la lista
  real de backups. El identificador NO MUST usarse para construir una ruta de archivo sin validar
  (path traversal).
- La creación de un backup MUST quedar registrada en el audit log, con el usuario que la pidió.

**Comportamiento**:

- Sobre Postgres, el backup MUST hacerse con `pg_dump` usando la `DATABASE_URL` del entorno.
- Sobre SQLite, MUST hacerse copiando el archivo de base de forma consistente.
- Si el binario necesario no está disponible, el endpoint MUST responder un error explicativo, NO un
  fallo genérico.
- La operación MUST tener un tope de tiempo; superado, el backup se marca fallido.
- El sistema MUST aplicar una retención configurable por cantidad de archivos.

**Given** un super_admin que pulsa "Crear backup" sobre Postgres
**When** `pg_dump` termina bien
**Then** aparece un archivo nuevo en la lista con su tamaño y fecha, y queda una entrada en el audit
log.

**Given** un usuario `merchant` autenticado
**When** llama a cualquier endpoint de backup
**Then** recibe 403 y no se crea ningún archivo.

**Given** una petición de descarga con `id` = `../../etc/passwd`
**When** llega al endpoint
**Then** responde 400/404 y no lee ningún archivo fuera del directorio de backups.

**Given** que ya existen N backups y la retención es N
**When** se crea uno nuevo
**Then** el más antiguo se elimina y queda registrado.

### Base de datos
Ninguna tabla nueva: la lista se deriva del directorio de backups.

### API
`GET /api/admin/backups` · `POST /api/admin/backups` · `GET /api/admin/backups/:id/download` ·
`DELETE /api/admin/backups/:id` — todos `super_admin`.

### UI
"Backups" MUST listar los reales con fecha, tamaño y estado, con botón de descarga y de borrado, y
el botón de crear MUST funcionar (hoy no tiene handler) y mostrar progreso.

---

## REQ-MON-06 — Colas e integraciones visibles

La pantalla MUST mostrar el estado real de las colas que ya existen en el sistema: cola de email
(`email_queue`) y cola de Channex (`ari_outbox`), con pendientes, fallidos y último procesado.

La pantalla MUST mostrar las últimas entregas de webhook (`webhook_deliveries`) con evento, código de
respuesta y resultado. Hoy esa tabla se escribe en cada intento pero no se muestra en ninguna
pantalla: solo hay un contador de entregas en `api-keys.vue`.

NO MUST inventarse proveedores. Las menciones a "AWS S3", "CloudFront" y "SendGrid" MUST eliminarse:
el proyecto sirve archivos locales por nginx y envía correo por SMTP/Resend/Brevo.

**Given** 4 correos pendientes en `email_queue`
**When** se abre Monitoreo
**Then** la tarjeta de colas muestra 4 pendientes.

**Given** una entrega de webhook fallida con estado 500
**When** se abre Monitoreo
**Then** aparece en la lista con su evento, el 500 y la hora del intento.

### API
`GET /api/admin/monitoring/queues` (super_admin) → `{ email: {...}, ariOutbox: {...}, webhooks: { ultimasEntregas: [...] } }`

### UI
Sección "Colas e integraciones" con estado vacío propio cuando no hay nada pendiente.

---

## REQ-MON-07 — Honestidad de la pantalla

Ningún valor mostrado en `/admin/monitoring` MUST estar escrito en el HTML. Todo dato numérico o de
estado MUST provenir de una medición.

Cuando una métrica no pueda obtenerse, la UI MUST mostrar su ausencia de forma explícita (`—`, "sin
datos") en lugar de un valor por defecto que se lea como medición.

El indicador global de estado MUST derivarse de las mediciones (por ejemplo: hay errores 5xx
recientes, o una cola con fallidos), NO ser el texto fijo "Todos los sistemas operativos".

El botón "Refrescar" MUST recargar los datos.

**Given** el backend caído
**When** se abre Monitoreo
**Then** la pantalla muestra el fallo de carga y NO afirma que los sistemas están operativos.
