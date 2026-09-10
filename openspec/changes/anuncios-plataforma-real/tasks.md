# anuncios-plataforma-real — Tasks

> Épico en GitHub: #104 · sub-tareas #105 a #112
>
> **Estado 2026-09-10: implementado y verificado en local. Único pendiente: 8.1 (revisión de datos
> en producción, que no se puede hacer desde acá).**
>
> Evidencia: `bun test` 5363 pass / 0 fail · `arckode analyze` ✅ 0 violaciones ·
> `frontend typecheck` + `build ✓ built` · esquema verificado sobre una copia real de la base
> (`RUN_MIGRATE` + `migrate` + backfill corrido dos veces).

> Hoy `/admin/announcements` guarda el anuncio pero **no se lo entrega a nadie**: el listado de un
> hotel filtra `hotelId` por igualdad exacta y un anuncio global (`NULL`) nunca matchea
> (`anuncios/service.ts:47-52`). Las métricas de la pantalla están escritas en el HTML
> (`announcements.vue:72,76,80,84,237`) y las tarjetas "Plantillas" y "Programación" son decorado
> (`announcements.vue:214-219,221`).
>
> Ya resuelto en el árbol de trabajo (NO re-hacer): `sendAnnouncement()` publica de verdad y
> "Ver"/"Eliminar" funcionan con confirmación (`announcements.vue:250-296`).

## 1. Difusión real (REQ-ANN-01) — GitHub #105

- [x] 1.1 `anuncios/service.ts` — `list()` deja de filtrar por igualdad y devuelve, para un usuario
      que no es `super_admin`, los anuncios de su hotel **más** los globales (`hotelId` nulo o vacío).
      Usar el repositorio, nunca SQL crudo.
      **Aceptación**: test con 3 anuncios (global, hotel-1, hotel-2) → el usuario de hotel-1 recibe
      exactamente 2 (global + hotel-1) y en ningún caso el de hotel-2. El test falla contra el código
      actual.
- [x] 1.2 Un `super_admin` sin `?hotelId` sigue viendo todo; con `?hotelId=X` ve los de X **y** los
      globales.
      **Aceptación**: test de los dos casos sobre el mismo conjunto de datos del 1.1.
- [x] 1.3 Cubrir el borde de datos: filas con `hotelId = ''` (cadena vacía) cuentan como globales,
      igual que `NULL`.
      **Aceptación**: test que inserta una de cada y verifica que el hotel recibe las dos.
- [x] 1.4 La columna "Audiencia" del panel muestra el **nombre** del hotel, no su id.
      **Aceptación**: en la tabla no aparece ningún UUID; un anuncio sin hotel dice "Todos los
      hoteles".

## 2. Audiencia elegible (REQ-ANN-02) — GitHub #106

- [x] 2.1 `anuncios/model.ts` — agregar `audience` al `orm.define` y a `types.ts`
      (`'all' | 'hotel' | 'admins'`).
      **Aceptación**: `RUN_MIGRATE=1` agrega la columna en SQLite y en Postgres sin tocar los datos
      existentes. Verificar el anti-patrón ORM: el campo está declarado, si no se descarta sin aviso.
- [x] 2.2 `validators/schema.ts` — validar el enum; con `audience = 'hotel'` y sin `hotelId` → 400.
      **Aceptación**: test de los dos caminos (válido → 201, inválido → 400 con mensaje que nombra el
      campo).
- [x] 2.3 `service.create()` — solo `super_admin` puede crear `all` o `admins`; un `merchant` queda
      acotado a su hotel.
      **Aceptación**: test con `merchant` autenticado enviando `audience: 'all'` → 403 y `COUNT(*)`
      de `announcements` sin cambios.
- [x] 2.4 `service.list()` — `audience = 'admins'` solo se entrega a `hotel_admin` y `super_admin`.
      **Aceptación**: test con `receptionist` (no lo recibe) y `hotel_admin` (lo recibe) sobre el
      mismo anuncio.
- [x] 2.5 Frontend: reemplazar los dos checkboxes por un selector de tres opciones excluyentes
      (`announcements.vue:131-140`), con selector de hotel cuando se elige "Un hotel", y mandarlo en
      el `POST`.
      **Aceptación**: `grep -n "allHotels\|adminsOnly" announcements.vue` → 0 resultados. En Network,
      el `POST /api/anuncios` lleva `audience` con el valor elegido.
- [x] 2.6 Evidencia ejecutable de la aceptación de §2 (#106): `tests/audience-route.test.ts` (ruta
      real con roles: 201 · 400 que nombra `hotelId` · 403 con `COUNT` sin cambios · `receptionist`
      no recibe `admins` y `hotel_admin` sí · `PUT` no escala audiencia) y
      `tests/audience-migration.e2e.test.ts` (tabla vieja → `orm.migrate()` → backfill real →
      filas viejas intactas con `hotel`/`all`). `update()` rechaza `audience = 'hotel'` sobre un
      anuncio sin `hotelId` (400).

## 3. Vigencia y programación (REQ-ANN-03) — GitHub #107

- [x] 3.1 `model.ts` + `types.ts` + validadores: `startsAt` y `endsAt`, con `endsAt > startsAt`.
      **Aceptación**: `RUN_MIGRATE=1` agrega las dos columnas; test de validación con fechas
      invertidas → 400.
- [x] 3.2 `list()` aplica la ventana de vigencia **en la consulta** con `scope=active` (default) y la
      omite con `scope=all` (solo `super_admin`).
      **Aceptación**: test con un anuncio programado para mañana → el payload del hotel no contiene
      su `title` (verificar sobre el JSON serializado, no sobre el array ya filtrado en memoria).
- [x] 3.3 Un anuncio vencido (`endsAt` pasado) no se entrega aunque tenga `active = 1`.
      **Aceptación**: test explícito de ese caso.
- [x] 3.4 Formulario: "Publicar ahora" o "Programar" + fecha de fin opcional.
      **Aceptación**: publicar sin tocar nada sigue creando un anuncio inmediato y sin vencimiento
      (no se rompe el flujo actual).
- [x] 3.5 Tarjeta "Programación" alimentada por `scope=all` filtrando `startsAt` futuro
      (`announcements.vue:99-110,221`).
      **Aceptación**: crear un anuncio programado → aparece en la tarjeta con su fecha; borrarlo →
      la tarjeta vuelve al estado vacío.

## 4. Lecturas por usuario (REQ-ANN-04) — GitHub #108

- [x] 4.1 Modelo `announcement_reads` (`announcementId`, `userId`, `hotelId`, `seenAt`,
      `dismissedAt`) + registro en `composition-root.ts`.
      **Aceptación**: `RUN_MIGRATE=1` crea la tabla en ambos motores; todos los campos que usa el
      service están en el `orm.define`.
- [x] 4.2 `CREATE UNIQUE INDEX` explícito sobre `(announcementId, userId)` — el ORM no crea únicos
      compuestos.
      **Aceptación**: dos inserts del mismo par → el segundo no crea fila nueva y la operación no
      revienta.
- [x] 4.3 `POST /api/anuncios/:id/seen` idempotente.
      **Aceptación**: test que llama 3 veces → 1 fila, con el `seenAt` de la primera llamada
      (comparar el valor, no solo el conteo).
- [x] 4.4 `POST /api/anuncios/:id/dismiss` por usuario.
      **Aceptación**: test con dos usuarios del mismo hotel → A cierra, B sigue recibiéndolo en el
      listado.
- [x] 4.5 Banner: llamar a `seen` al mostrar y a `dismiss` en el ✕; eliminar la escritura en
      `configuration('dismissed_announcements')` (`AnnouncementBanner.vue:60-80`).
      **Aceptación**: `grep -n "dismissed_announcements" frontend/src` → 0 resultados.
- [x] 4.6 El registro no puede romper el banner: fallo de red o 500 y el anuncio se muestra igual.
      **Aceptación**: test/manual con el endpoint devolviendo 500 → el aviso se ve y no aparece toast
      de error.
- [x] 4.7 **DECISIÓN TOMADA: no se migra.** Los ids de `configuration` viejos NO se pasan a
      `announcement_reads`. Motivo: la marca vieja era del HOTEL y no dice QUIÉN cerró el aviso, así
      que migrarla implicaría inventar un usuario. Consecuencia aceptada: cada aviso todavía activo
      reaparece UNA vez por usuario, y se cierra de nuevo — esta vez de verdad, por persona.
      (Texto original de la tarea: los anuncios ya cerrados con el mecanismo viejo no reaparecen de golpe: migrar los ids de
      `configuration('dismissed_announcements')` a `announcement_reads` marcados como cerrados por
      el dueño del hotel, o dejar constancia de que reaparecen una vez.)

## 5. Alcance y apertura reales (REQ-ANN-05) — GitHub #109

- [x] 5.1 `admin/usecases/dashboard-queries.ts` — `listAnnouncements()` devuelve por fila
      `recipients`, `seenCount`, `dismissedCount`.
      **Aceptación**: test con 10 usuarios y 4 lecturas → `recipients: 10`, `seenCount: 4`.
- [x] 5.2 `GET /api/admin/announcements/reach` (super_admin + `requireUserType('admin')`).
      **Aceptación**: test de 403 con `merchant` autenticado; el payload no trae ninguna clave con
      valor fijo.
- [x] 5.3 Reemplazar los cuatro números de la tarjeta "Alcance"
      (`announcements.vue:72,76,80,84`) y `views/reads` (`:237`) por los del servidor.
      **Aceptación**: `grep -n "72%\|18%\|>24<\|>89<\|views: 0" announcements.vue` → 0 resultados.
- [x] 5.4 Sin lecturas todavía → "sin datos", no `0%`.
      **Aceptación**: anuncio recién creado → la tasa dice "sin datos".
- [x] 5.5 "Tasa click" se elimina: no hay ningún enlace en el anuncio que se pueda clickear, así que
      no hay nada que medir.
      **Aceptación**: la tarjeta no menciona clicks.

## 6. Caché e higiene (REQ-ANN-06, REQ-ANN-08) — GitHub #110

- [x] 6.1 `anuncios/usecases/cache.ts` con token de versión, siguiendo `facturas/usecases/cache.ts`;
      `create`/`update`/`delete` lo bumpean en vez de borrar una clave que no existe
      (`service.ts:93,106,119`).
      **Aceptación**: test que lista (cachea), crea, vuelve a listar dentro del TTL y encuentra el
      nuevo. El test falla contra el código actual.
- [x] 6.2 `PRIORITY_ENUM` incluye `urgent` (`validators/schema.ts:7`).
      **Aceptación**: `POST` con `priority: 'urgent'` → 201, y el banner muestra el badge.
- [x] 6.3 `AnnouncementType` en `backend/src/modules/anuncios/types.ts` incluye `feature` y `promo`.
      **Aceptación**: `cd backend && bun run typecheck` sin errores y sin `as any` nuevos en el
      service.
- [x] 6.4 El selector de tipo del panel ofrece exactamente el enum del validador.
      **Aceptación**: cada opción del `<select>` publica sin 400.

## 7. Plantillas guardadas (REQ-ANN-07) — GitHub #111

- [x] 7.1 Persistir en `configuration('announcement_templates', 'platform')` con CRUD desde el panel.
      **Aceptación**: guardar una plantilla, recargar (F5) y seguir viéndola.
- [x] 7.2 Clic en plantilla abre el modal precargado y editable.
      **Aceptación**: el título y el mensaje aparecen en el formulario y se pueden cambiar antes de
      publicar.
- [x] 7.3 Si 7.1 y 7.2 no entran en el alcance, **borrar** la tarjeta y su array literal
      (`announcements.vue:88-98,214-219`).
      **Aceptación**: no queda ningún elemento con `cursor-pointer` que no haga nada.

## 8. Cierre — GitHub #112

- [ ] 8.1 Antes del deploy: revisar anuncios globales preexistentes. **PENDIENTE — requiere prod.**
      **Aceptación**: `SELECT id, title, active FROM announcements WHERE hotelId IS NULL OR hotelId = ''`
      corrido en prod y decidido, uno por uno, si se difunde o se desactiva. Pegar el resultado en el
      issue épico.
- [x] 8.2 Gates.
      **Aceptación**: `cd backend && bun run node_modules/arckode-framework/bin/arckode.js analyze`
      en 0 violaciones · `bun run typecheck && bun test` verde ·
      `cd frontend && bun run typecheck && bun run build` con "✓ built".
- [x] 8.3 Actualizar `CLAUDE.md` con la regla de difusión (global vs. hotel) para que no se vuelva a
      escribir un filtro por igualdad.
      **Aceptación**: la sección existe y nombra `anuncios/service.ts`.
