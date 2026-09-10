# monitoreo-plataforma-real — Tasks

> Hoy `/admin/monitoring` es una maqueta: la mayoría de sus números está escrita en el HTML
> (`monitoring.vue:26,33,37,44,52,56,63,81,146,157,168`) y las secciones de errores y backups leen
> arrays que siempre están vacíos. No existe registro de peticiones, ni de errores, ni backups
> (`grep -rin "pg_dump\|backup" backend/src` → 0 resultados).

## 1. Instrumentación HTTP (REQ-MON-01)

- [x] 1.1 `shared/observability/route-key.ts`: normalizar la ruta (UUID/ULID/números → `:id`).
      **Aceptación**: tests con `/api/reservas/<uuid>/charges`, `/api/reservas/44` y `/api/hoteles`;
      las dos primeras colapsan en su patrón y la tercera queda intacta.
- [x] 1.2 `shared/observability/metrics.ts`: agregado en memoria por ruta (count, avg, p95, max,
      errores) con tope `MAX_ROUTES` y desborde a `otras`.
      **Aceptación**: test que supera el tope y verifica que el mapa no crece más.
- [x] 1.3 Middleware `httpMetrics()` con la firma del framework `(req, next)`.
      **Aceptación**: test que simula 3 peticiones y comprueba el agregado; el middleware devuelve
      SIEMPRE la respuesta de `next()`, incluso si el registro falla.
- [x] 1.4 Registrar el middleware en `composition-root.ts`.
      **Aceptación**: `arckode analyze` en 0 violaciones; `bun test` verde.
- [x] 1.5 `GET /api/admin/monitoring/api` (super_admin).
      **Aceptación**: test de ruta que verifica 403 para `merchant`.

## 2. Errores recientes (REQ-MON-02)

- [x] 2.1 Modelo `error_logs` + registro en `composition-root`.
      **Aceptación**: `RUN_MIGRATE=1` crea la tabla en SQLite y Postgres. Verificar el anti-patrón
      ORM: todo campo usado debe estar declarado en el `orm.define`.
- [x] 2.2 Captura en el middleware: 5xx y excepciones; 4xx excluidos salvo 429.
      **Aceptación**: test con endpoint que lanza excepción → el cliente recibe su error Y queda la
      fila.
- [x] 2.3 Agrupar por `(path, message)` con `count`, `firstSeenAt`, `lastSeenAt`.
      **Aceptación**: test que provoca el mismo error 12 veces → UNA fila con `count: 12`.
- [x] 2.4 Escritura fuera del ciclo de respuesta, con el fallo tragado y logueado.
      **Aceptación**: test con repositorio que rechaza → la respuesta al cliente no cambia.
- [x] 2.5 `GET /api/admin/monitoring/errors` y `DELETE /api/admin/monitoring/errors/:id`.
      **Aceptación**: test de autorización + orden por `lastSeenAt` descendente.
- [x] 2.6 Retención por antigüedad (default 30 días).
      **Aceptación**: test con filas viejas y nuevas → sobreviven solo las nuevas.

## 3. Estado real del sistema (REQ-MON-03, REQ-MON-04)

- [x] 3.1 `shared/observability/db-health.ts`: tamaño, tablas y conexiones por motor, vía
      `adapter.query`. Omitir lo que el motor no soporta.
      **Aceptación**: test con adapter falso de cada motor; en SQLite `conexiones` viene ausente, no
      en cero.
- [x] 3.2 `shared/observability/system-health.ts`: CPU por diferencia de muestras, memoria, disco,
      uptime de proceso y de SO.
      **Aceptación**: test que verifica que dos lecturas dan un porcentaje del intervalo y no un
      acumulado.
- [x] 3.3 Tamaño y cantidad de archivos de `uploads/`, cacheado 5 minutos.
      **Aceptación**: test que confirma que la segunda llamada no recorre el árbol otra vez.
- [x] 3.4 `GET /api/admin/monitoring/system` (super_admin).
      **Aceptación**: el payload no trae ninguna clave con valor inventado; test de 403 para
      `merchant`.

## 4. Backups de la base (REQ-MON-05)

- [x] 4.1 `shared/observability/backups.ts`: crear (pg_dump / copia SQLite), listar, borrar.
      **Aceptación**: tests con motor falso; si el binario no existe → error explicativo, no genérico.
- [x] 4.2 Directorio de backups fuera de la raíz servida por nginx, creado si falta.
      **Aceptación**: verificar que la ruta no cae bajo `frontend/dist` ni `uploads/`.
- [x] 4.3 Resolución de descarga por coincidencia exacta contra el listado real, nunca concatenando
      el `id` del cliente a una ruta.
      **Aceptación**: test con `id` = `../../etc/passwd` → 400/404 y ninguna lectura fuera del
      directorio.
- [x] 4.4 Endpoints `GET/POST /api/admin/backups`, `GET /:id/download`, `DELETE /:id`, todos
      `super_admin` + `requireUserType('admin')`.
      **Aceptación**: test de 403 con `merchant` autenticado; ningún archivo creado.
- [x] 4.5 Registrar creación y descarga en el audit log con el usuario.
      **Aceptación**: test que verifica la entrada de auditoría.
- [x] 4.6 Timeout de ejecución y retención por cantidad.
      **Aceptación**: test de retención → al crear el N+1 se borra el más viejo.

## 5. Colas e integraciones (REQ-MON-06)

- [x] 5.1 `GET /api/admin/monitoring/queues`: `email_queue`, `ari_outbox` y últimas entregas de
      `webhook_deliveries`.
      **Aceptación**: test con datos sembrados de las tres fuentes.
- [x] 5.2 Reutilizar lo que ya existe en `modules/ari-outbox` (stats) en vez de recalcularlo.
      **Aceptación**: sin lógica de estados duplicada; `arckode analyze` limpio.

## 6. Pantalla (REQ-MON-07)

- [x] 6.1 Reescribir `monitoring.vue` sin un solo valor literal; skeletons y estados vacíos propios.
      **Aceptación**: `grep` de los números de la maqueta (99.99, 247, 45ms, 8.2, 34/100, 1,240,
      24.5, 1,892, 68.9, 34%, 62%, 45%, "42 días") → 0 resultados en el archivo.
- [x] 6.2 Eliminar las menciones a AWS S3, CloudFront y SendGrid: el proyecto no usa ninguno.
      **Aceptación**: `grep -i "s3\|cloudfront\|sendgrid" monitoring.vue` → vacío.
- [x] 6.3 Estado global derivado de las mediciones; con el backend caído NO dice "operativo".
      **Aceptación**: prueba con la API cortada → la pantalla informa el fallo.
- [x] 6.4 Botón "Refrescar" funcional y botón de backup con progreso y resultado.
      **Aceptación**: verificado en el navegador, no solo typecheck.
- [x] 6.5 Sección de entregas de webhook y colas.
      **Aceptación**: se ve una entrega fallida con su código de respuesta.
- [x] 6.6 Tipos en `Platform.service.ts` sin `any`.
      **Aceptación**: `vue-tsc -b` limpio.

## 7. Verificación

- [ ] 7.1 `cd backend && bun run typecheck && bun test`.
- [ ] 7.2 `cd backend && bun run node_modules/arckode-framework/bin/arckode.js analyze` → 0
      violaciones.
- [ ] 7.3 `cd frontend && bun run typecheck && bun run build`.
- [ ] 7.4 Prueba manual en producción: crear un backup, descargarlo y comprobar que restaura en una
      base vacía.
      **Aceptación**: un `pg_restore`/`psql` sobre base limpia levanta el esquema y los datos.
      **Hecho en local (SQLite)**: `frontend/scripts/monitoring-e2e.ts` crea, descarga y borra un backup
      desde el navegador contra el backend real; la descarga es byte a byte igual al archivo de
      `BACKUP_DIR` y arranca con `SQLite format 3`. Falta la vuelta sobre Postgres en producción.
- [x] 7.5 Confirmar que un `merchant` autenticado recibe 403 en los cinco endpoints nuevos.
