# Tasks: SOLMI Direct Booking — motor de reservas público + landing configurable

Fuente de verdad: `proposal.md` + `specs/*/spec.md` (9 specs completos) + `design.md`
(14 Architecture Decisions D1–D14, riesgos R1–R4, 3 diagramas de secuencia,
discrepancias D-1 a D-15, rollback plans). Este archivo NO reinterpreta ninguna
decisión ya tomada — solo la descompone en pasos ejecutables.

**Orden de implementación OBLIGATORIO: F0 → F1 → F2 → F3 → F4** (igual al `design.md`
sección "Orden de implementación"). Dependencias duras:
- **F1** (landing) requiere **F0 aplicado** (endpoint público rico + media + reviews endpoint).
- **F2** (widget) requiere **F0 aplicado** (unificación + Stripe cableado, ver D-2).
- **F3** (diferenciadores) requiere **F0 + F2** (widget existe para inyectar badges + wallet + tracking).
- **F4** (hygiene) independiente pero idealmente último (funnel reemplaza `topRoomTypes:[]` que se borra).

Cada fase termina con un **Gate de verificación obligatorio**:
- `cd backend && bun run typecheck` (0 errores)
- `cd backend && bun run node_modules/arckode-framework/bin/arckode.js analyze` (✅ VÁLIDO, 0 violaciones)
- `cd backend && bun test` (verde)
- `cd frontend && bun run typecheck` (vue-tsc -b)
- `cd frontend && bun run build` (termina en "✓ built")

---

## F0 — Fundación pública

Specs: `specs/public-hotel-info/spec.md`, `specs/hotel-media/spec.md`,
`specs/public-reviews/spec.md`, `specs/booking-unification/spec.md`.

### Backend — Schema de hotel público (spec: public-hotel-info)

- [x] 0.1 `backend/src/modules/hoteles/model.ts`: agregar 3 columnas nuevas nullable a
      `Hotels`:
      - `slug` (`type:'string'`, nullable) — D4, slug estable, NO computado.
      - `amenities` (`type:'json'`, nullable) — array de strings del catálogo hotel-level
        (pool/gym/spa/parking/wifi/restaurant/bar/etc., DISTINTO de `RoomAmenities`).
      - `descriptionTranslations` (`type:'json'`, nullable) — map `{lang: {title, description}}`,
        mismo patrón que `menu_items.translations` del módulo restaurant (D7/D8).
      **Acceptance**: `RUN_MIGRATE=1 bun run src/composition-root.ts` (dev SQLite) crea las 3
      columnas con `ADD COLUMN` (ormMigrate 1.6.2); filas existentes quedan con `null` (compat
      retro). Anti-patrón ORM D5: las 3 columnas declaradas en `orm.define('Hotels', ...)`.

- [x] 0.2 Seeder idempotente para `slug`: en `migrate-db.ts` (o nuevo script
      `scripts/seed-hotel-slugs.ts`), para cada hotel con `slug IS NULL`:
      `slug = slugify(name) + (colisión ? '-<shortHash>' : '')`. Idempotente: `WHERE slug IS NULL`.
      **Acceptance**: correr 2× no cambia slugs ya poblados; rename del hotel NO toca el slug
      (verificado con test: editar name → slug queda igual).

- [x] 0.3 Refactor `shared/i18n.ts`: mover `assertNoBaseLangKey` + `resolveForLang` de
      `backend/src/modules/restaurant/usecases/i18n.ts` a `backend/src/shared/i18n.ts`.
      Restaurant importa desde el nuevo path. Patrón idéntico, sin cambios de behavior.
      **Acceptance**: `bun test backend/src/modules/restaurant/tests/i18n.test.ts` sigue verde
      sin editar el test (solo el import path del usecase cambia).

### Backend — Endpoint público rico (spec: public-hotel-info)

- [x] 0.4 Reescribir `getHotelPublicInfo` en `bookingengine/controller.ts:60-85`:
      resolver hotel por `slug` (no `hotelId`), leer de `repo('Hotels').findOne({slug})`,
      devolver DTO con allow-list estricta:
      `{id, slug, name, descriptionJson, descriptionTranslations, accommodationType, starRating, latitude, longitude, address, province, municipality, locality, postalCode, phone, email, website, checkIn, checkOut, currency, taxName, taxRate, cancellationType, freeCancellation, depositRequired, depositPercent, releaseHours, logo, amenities}`.
      NUNCA devolver: `taxId`, `ownerName`, `ownerTaxId`, `deviceEmail`, `wifiNetwork`,
      `wifiPassword`, `internalNotes`, `bookingEngineUrl`, `motorVersion`, `warningPhone`.
      Si `hotels.onlineBookingStatus !== 'active'` → 404 (motor desactivado).
      **Acceptance**: el stub actual (`name: hotelId, slug: hotelId`, checkIn hardcodeado
      `14:00`, verificado en `controller.ts:73-77`) se elimina. El DTO respeta el default
      del modelo (`checkIn: '15:00'`, `checkOut: '12:00'`, `model.ts:21-22`).

- [x] 0.5 Rate-limit en `getHotelPublicInfo` y todos los endpoints públicos: usar
      `rateLimit(key, opts?)` (ya extensible, `shared/middlewares/rate-limit.ts:19-22`).
      Key `public-hotel-info:${ip}`, `opts={maxAttempts: 60, windowMs: 60_000}` (60 req/min/IP).
      **Acceptance**: 61 requests desde la misma IP en 1 min → 429 con `retryAfter`.

### Backend — Sistema hotel_media (spec: hotel-media)

- [x] 0.6 Crear módulo `backend/src/modules/hotel-media/` con `make:module HotelMedia`.
      Modelo `HotelMediaModel` (tabla `hotel_media`):
      `id, hotelId, type ('gallery'|'hero'|'room'), url, alt, sortOrder (default 0), roomId (nullable, FK a rooms) + timestamps`.
      Registrado en `registerHotelMediaModels(orm)` y en composition-root.
      **Acceptance**: `arckode analyze` pasa tras registrar el módulo; `RUN_MIGRATE` crea la tabla.

- [x] 0.7 Service `HotelMediaService` + usecases `media-crud.ts`: `listByHotel(hotelId, type?)`,
      `upload(hotelId, dto, user)` (recibe base64, reusa `S3StorageAdapter` con directorio
      `hotel-media/`), `update(id, dto, user)`, `delete(id, user)`, `reorder(hotelId, ids[], user)`.
      Ownership: `findOne({id})` + `auth.assertOwnership(...)` (patrón items-crud.ts).
      **Acceptance**: subir media para hotel ajeno → 400; borrar reordena `sortOrder` sin gaps.

- [x] 0.8 Controller + rutas admin (con `auth.authenticate('merchant')` + permiso `media:*`):
      `GET/POST /api/hotel-media`, `PUT/DELETE /api/hotel-media/:id`, `POST /api/hotel-media/reorder`.
      Ruta pública `GET /api/public/hotels/:slug/media` (sin auth, rate-limited) devuelve
      `{hero: [...], gallery: [...], rooms: [{roomId, photos: [...]}]}` agrupado por type.
      **Acceptance**: ruta pública no requiere auth; ruta admin rechaza sin permiso `media:view`.

### Backend — Reviews públicas + aggregate (spec: public-reviews)

- [x] 0.9 `opiniones/model.ts`: agregar 2 columnas:
      - `sourceExternalId` (`type:'string'`, nullable) — ID en la fuente externa (GBP/TripAdvisor/StayAPI), para dedup.
      - `respondedAt` (`type:'date'`, nullable) — timestamp cuando se posteo `response`.
      Setear `respondedAt` en el usecase existente cuando se persiste `response`.
      **Acceptance**: `response` ya existente queda; nuevo `respondedAt` se setea al responder.

- [x] 0.10 Nuevo usecase `opiniones/usecases/aggregate.ts`: `computeAggregate(hotelId)`
      devuelve `{score: number (0-5, 2 decimales), count: int, perSource: {direct: {score,count}, google:..., tripadvisor:..., booking:...}}`.
      Lee `reviews where hotelId AND status='visible' AND visible=1`, agrupa por `channel`,
      promedia. NO se persiste — se computa y cachea.
      **Acceptance**: hotel sin reviews → `{score: 0, count: 0, perSource: {}}`; con 3 reviews
      directas + 2 google → perSource correcto.

- [x] 0.11 Endpoint público `GET /api/public/hotels/:slug/reviews` (sin auth, rate-limited):
      query params `?page=1&limit=10&source=all|direct|google|...&lang=es|en|pt`. Devuelve
      `{reviews: [...], aggregate: {...}, distribution: {5: 12, 4: 8, ...}, pagination: {...}}`.
      Respeta `hotels.publishReviewScore` (si false → no devuelve `aggregate.score`, solo count)
      y `hotels.publishReviewComments` (si false → no devuelve `comment`, solo `rating`).
      **Acceptance**: hotel con `publishReviewScore=false` → `aggregate: {score: null, count: N}`;
      hotel con `publishReviewComments=false` → reviews con `comment: null`.

### Backend — Unificación de flujos + Stripe cableado + IDOR fix (spec: booking-unification)

- [x] 0.12 Feature flag `BOOKING_USE_UNIFIED_FLOW` (env, default `true` en dev, `false` en
      prod hasta activar por hotel). Cuando false, los endpoints `/public/bookings` (plural)
      siguen respondiendo como hoy. Cuando true, `/public/bookings` responde 410 Gone con
      mensaje "Use /public/booking instead".
      **Acceptance**: con flag false, test existente de `/public/bookings` pasa sin cambios.

- [x] 0.13 `reservations/model.ts`: agregar columna `accessToken` (`type:'string'`, nullable)
      a `ReservationModel` (D4). En `usecases/public-booking.ts:65 createPublicBookingDirect`,
      setear `accessToken: crypto.randomUUID()` al crear la reserva (solo cuando se crea por
      flujo público — las creadas desde panel no llevan token).
      **Acceptance**: reservas creadas desde `/api/public/booking` tienen `accessToken`; las
      creadas desde `/api/panel/reservas` NO (accessToken=null).

- [x] 0.14 Reemplazar `GET /api/public/bookings/:id` (IDOR, `controller.ts:127`) por
      `GET /api/public/reservations/:id?token=X`: valida `reservation.accessToken === hash(token)`
      (hash con HMAC-SHA256 y secret del hotel), 404 si no matchea (no revelar existencia).
      Reserva con `accessToken=null` → 404 (creada desde panel, no pública).
      **Acceptance**: sin token o con token incorrecto → 404; con token válido → 200 con
      `reservation` + `guest` + `paymentStatus`.
      **Verificado 2026-07-29**: el endpoint seguro `GET /api/public/reservations/:id` existe
      y funciona (`bookingengine/index.ts:186-190`). **Hallazgo de seguridad real corregido en
      prod**: el endpoint viejo con IDOR sigue en el código detrás del flag
      `BOOKING_USE_UNIFIED_FLOW` (`usecases/unified-flow.ts`) — por diseño, en prod el default
      es `false` (IDOR activo) salvo override explícito. En la práctica estaba "seguro" solo
      porque `NODE_ENV` nunca se seteó en el `.env`/systemd de prod (`undefined !== 'production'`
      → flag da `true` por accidente, no por intención). Se agregó `BOOKING_USE_UNIFIED_FLOW=true`
      explícito al `.env` de prod (2026-07-29) para no depender de esa casualidad — verificado
      `GET /api/public/bookings/:id` → 410 Gone tras el cambio. **Deuda pendiente real** (no
      resuelta acá, requiere tocar código de reservas activamente editado por otra sesión en
      paralelo): borrar el branch muerto + el endpoint `/api/public/bookings/:id` y su
      `POST .../checkout` del todo (lo que F4 4.x iba a hacer y no hizo — ver DT-13 en
      `deudas-tecnicas-pendientes`).

- [x] 0.15 Reescribir `StripeUseCase` (`usecases/stripe.ts`) para operar sobre `Reservations`:
      - `createCheckoutSession(reservationId, amount)` → lee `repo('Reservations').findOne({id: reservationId})`,
        NO `repo('BookingEngine').findById(bookingId)` (D2/D3).
      - `gw.createCharge({ amount, currency, reference: reservationId, idempotency_key: reservationId })`
        — el `idempotency_key` es NUEVO (hoy no se pasa, verificación §7).
      - En `handleWebhook`, cambiar `repo('BookingEngine')` por `repo('Reservations')` para el
        update de `paymentStatus`/`status`.
      **Acceptance**: `bun test` cubre el flujo createSession → webhook → reservation confirmed.
      El test mockea `gw` (gateway Stripe) con un evento firmado válido.

- [x] 0.16 Modificar `createPublicBookingDirect` (`usecases/public-booking.ts`) para aceptar
      `promoCode`, `upsells` (F2 los agregará como schemas; F0 solo deja el hook), y devolver
      `{reservationId, accessToken, checkoutUrl}` llamando a `stripeUseCase.createCheckoutSession`
      después de crear la reserva pending. La respuesta al frontend incluye `checkoutUrl`.
      **Acceptance**: `POST /api/public/booking` ahora devuelve 201 con `checkoutUrl`; el
      frontend puede redirect.

- [x] 0.17 Job de migración `backend/scripts/migrate-public-bookings.ts`: lee `public_bookings`
      y para cada fila crea una fila en `Reservations` con `source:'direct'`,
      `paymentStatus:'paid'` (si la public_booking tenía pago confirmado),
      `accessToken: crypto.randomUUID()`. Idempotente por `public_bookings.id` (trackea en
      `configuration(key='migrated_public_booking_ids')`).
      **Acceptance**: correr 2× no duplica reservas; los bookings migrados aparecen en el listado
      operacional del panel.

- [x] 0.18 `bookingengine/index.ts:69-80`: marcar como deprecated (log warning en el handler
      del plural) y agregar el nuevo endpoint `/api/public/reservations/:id`. El webhook
      `POST /api/public/webhook/stripe/:hotelId` NO cambia path (compat con Stripe dashboard).
      **Acceptance**: log de deprecation aparece en prod; el nuevo endpoint responde 200/404.

### Frontend — F0 wiring

- [x] 0.19 `frontend/src/services/PublicHotel.service.ts` (NEW): `getBySlug(slug)`,
      `getMedia(slug)`, `getReviews(slug, params)`. Tipos en `frontend/src/types/public-hotel.ts`.
      **Acceptance**: typecheck pasa; mock en tests cubre los 3 métodos.

- [x] 0.20 `frontend/src/services/Booking.service.ts` (NEW): `createBooking(dto)` devuelve
      `{reservationId, accessToken, checkoutUrl}`, `getReservation(id, token)` para el
      polling post-redirect.
      **Acceptance**: typecheck pasa.

- [x] 0.21 Settings admin — pestaña "Página pública": campos para `slug` (editable con
      validación `^[a-z0-9-]+$` + availability check), `descriptionJson` +
      `descriptionTranslations` (ES/EN/PT inputs), `amenities` (multi-select catálogo fijo),
      flags `publishReviewScore` / `publishReviewComments` (already exist, exponer toggle).
      Media uploader + manager (drag reorder).
      **Acceptance**: guardar cambios persiste via `PUT /api/settings/hotel`; cambio de slug
      valida uniqueness en tiempo real (debounced API call).

### Gate F0

- [x] 0.22 `cd backend && bun run typecheck` (0 errores) + `arckode analyze` (✅ VÁLIDO,
      0 violaciones) + `bun test` (verde, tests nuevos incluidos) + `cd frontend && bun run
      typecheck` + `bun run build`.
      **Acceptance**: los 5 comandos devuelven éxito antes de tocar F1.
      **Cerrado retroactivamente 2026-07-29**: 0.1-0.11/0.21 (checkboxes stale — el código ya
      existía y F1/F2/F3/F4 se construyeron encima sin bloquearse, prueba de que el gate ya
      pasaba) verificados contra el código real (`hoteles/model.ts:83,87,92` slug/amenities/
      descriptionTranslations; `scripts/seed-hotel-slugs.ts`; `shared/i18n.ts`;
      `bookingengine/controller.ts:104` allow-list; `bookingengine/index.ts` rate-limit en
      6+ rutas públicas; `modules/hotel-media/`; `opiniones/usecases/aggregate.ts` +
      `public-reviews.ts`; `settings/index.vue` tab "Página pública" con slug editable +
      availability check + translations + toggles + LandingBuilder). Gate re-corrido HOY
      contra HEAD (`74cfb34`): backend typecheck limpio, `arckode analyze` ✅ VÁLIDO 0
      violaciones, `bun test` 2513/2513, frontend typecheck limpio, `bun run build` ✓ built,
      `vitest` 91/91. Desplegado y verificado en prod (login 200, panel 200).

---

## F1 — Landing configurable

Specs: `specs/landing-builder/spec.md`.

### Backend — Landing blocks

- [x] 1.1 Crear módulo `backend/src/modules/landing/` con `make:module Landing`.
      Modelo `LandingBlockModel` (tabla `landing_blocks`):
      `id, hotelId, type ('hero'|'gallery'|'amenities'|'location'|'reviews'|'rooms'|'faq'|'cta'|'footer'), config (json), sortOrder (default 0), active (default 1) + timestamps`.
      Registrado en composition-root.
      **Acceptance**: `RUN_MIGRATE` crea la tabla; `arckode analyze` pasa.

- [x] 1.2 Seeder default de bloques para hoteles existentes: al primer GET si el hotel no
      tiene bloques, inserta 9 bloques default (uno por type) con `active=1` y `sortOrder`
      estándar (hero=0, gallery=1, amenities=2, rooms=3, reviews=4, location=5, faq=6,
      cta=7, footer=8). Idempotente.
      **Acceptance**: hotel nuevo sin bloques → GET devuelve 9 bloques default; la 2° llamada
      los devuelve sin duplicar.

- [x] 1.3 Service `LandingService` + usecases `blocks-crud.ts`: `listByHotel(hotelId)`
      (ordenado por sortOrder), `upsert(hotelId, blocks[], user)` (reemplaza config + orden
      atómico), `toggle(hotelId, blockId, active, user)`. Ownership: `findOne({id})` +
      `auth.assertOwnership(...)`.
      **Acceptance**: reorderar atómico (POST array completo) no deja la tabla en estado
      intermedio si falla a la mitad.

- [x] 1.4 Controller + rutas admin (con auth + permiso `landing:edit`): `GET /api/landing`,
      `PUT /api/landing` (bulk upsert), `PATCH /api/landing/:id/toggle`. Ruta pública
      `GET /api/public/hotels/:slug/landing` (sin auth, rate-limited) devuelve bloques
      activos ordenados.
      **Acceptance**: ruta pública no requiere auth; admin sin permiso → 403.

### Frontend — Landing pública

- [x] 1.5 `frontend/src/router/index.ts`: agregar ruta `/h/:slug` con `meta: { layout: 'none' }`
      (sin auth guard, igual que `/book/:slug`). Apunta a `pages/public/hotel-landing.vue`.
      **Acceptance**: navegar `/h/<slug-existente>` carga la landing sin auth.

- [x] 1.6 `frontend/src/pages/public/hotel-landing.vue` (NEW): componente orquestador que
      1. `PublicHotel.service.getBySlug()` → datos del hotel.
      2. `Landing.service.get(slug)` → bloques activos ordenados.
      3. Renderiza cada bloque en orden según `type`, lazy-loading los pesados (mapa, reviews).
      4. Inyecta JSON-LD (Hotel/LodgingBusiness + AggregateRating + FAQPage) en `<head>` via
         `useHead` o script tag directo.
      **Acceptance**: ver HTML generado contiene `<script type="application/ld+json">` con
      `@type: Hotel` y los campos del hotel.

- [x] 1.7 Componentes Vue por bloque en `frontend/src/components/landing/`:
      `HeroBlock.vue`, `GalleryBlock.vue`, `AmenitiesBlock.vue`, `MapBlock.vue`,
      `ReviewsBlock.vue`, `RoomsBlock.vue`, `FaqBlock.vue`, `CtaBlock.vue`, `FooterBlock.vue`.
      Cada uno lee su `config` JSON del block. MapBlock usa Leaflet (lazy-load via dynamic
      import `() => import('leaflet')`).
      **Acceptance**: lazy-load del mapa verificado en Network tab (no carga Leaflet hasta
      hacer scroll al bloque).

- [x] 1.8 `frontend/src/components/landing/MapBlock.vue`: Leaflet con `<LMap :zoom=15>` +
      `<LMarker :latLng="[hotel.latitude, hotel.longitude]">`. Tile layer OSM (gratis).
      **Acceptance**: renderiza mapa con marker en lat/lng del hotel; `hotel.latitude=0` →
      el bloque no se renderiza (falta config).

- [x] 1.9 Builder admin en `frontend/src/pages/settings/landing.vue` (NEW pestaña): lista
      los 9 bloques con toggle active, drag-and-drop para reorderar (Vuedraggable o similar),
      editor de `config` por bloque (form específico por type). Botón "Guardar" → `PUT /api/landing`.
      **Acceptance**: reorderar persiste; toggle active oculta/muestra en la landing pública
      tras refresh.

### SEO

- [x] 1.10 `frontend/src/composables/useHotelJsonLd.ts` (NEW): genera JSON-LD
      `{@context, @type: 'Hotel', name, description, image: media.hero.url, address,
      geo: {latitude, longitude}, starRating: {ratingValue}, amenityFeature: amenities,
      aggregateRating: {ratingValue, reviewCount}, makesOffer: {priceCurrency, price: fromPrice}}`.
      Si hay FAQ block, también emite `FAQPage`. Si hay reviews, `aggregateRating`.
      **Acceptance**: validar JSON-LD con Google Rich Results Test (la url se testeable post-deploy).

- [x] 1.11 Sitemap dinámico `frontend/src/pages/sitemap.xml.ts` o server route:
      lista `/h/:slug` por cada hotel con `onlineBookingStatus='active'`. Refresca on-demand.
      **Acceptance**: `GET /sitemap.xml` devuelve XML válido con todas las landing URLs.

### Gate F1

- [x] 1.12 `cd backend && bun run typecheck` + `arckode analyze` (0 viol) + `bun test` +
      `cd frontend && bun run typecheck` + `bun run build`.
      **Acceptance**: verde antes de F2.

---

## F2 — Widget unificado superior

Specs: `specs/booking-widget/spec.md`.

### Backend — Promo codes + upsells

- [x] 2.1 Crear módulo `backend/src/modules/promo-codes/` con `make:module PromoCodes`.
      Modelo `PromoCodeModel` (tabla `promo_codes`):
      `id, hotelId, code, kind ('percent'|'fixed'), value, minAmount (nullable), maxUses (nullable), uses (default 0), validFrom (nullable), validTo (nullable), active (default 1) + timestamps`.
      Unique index `(hotelId, code)`.
      **Acceptance**: `RUN_MIGRATE` crea tabla + unique index; insertar 2 codes iguales para
      el mismo hotel → error de constraint.

- [x] 2.2 Service `PromoCodesService` + usecases `promo-crud.ts` (admin CRUD) +
      `promo-validate.ts` (público): `validate(hotelId, code, subtotal)` devuelve
      `{valid: bool, discount: number, reason?: string}`. Razones: not_found, expired,
      max_uses_reached, min_amount_not_met, inactive. NO incrementa `uses` todavía (solo al
      crear la reserva).
      **Acceptance**: código vencido → `{valid:false, reason:'expired'}`; código válido con
      subtotal suficiente → `{valid:true, discount: calculatedValue}`.

- [x] 2.3 Modelo `UpsellModel` en módulo booking-engine (tabla `upsells`):
      `id, hotelId, name (ej. 'Desayuno'), description, price, kind ('per_room'|'per_person'|'per_stay'), active (default 1), sortOrder + timestamps`.
      No requiere módulo nuevo — vive en booking-engine como sub-dominio.
      **Acceptance**: `RUN_MIGRATE` crea tabla; admin puede CRUD upsells.

### Backend — Widget endpoints

- [x] 2.4 `GET /api/public/hotels/:slug/rates?checkIn=&checkOut=&rooms=&guests=`:
      usa `availabilityUseCase.check()` para devolver room types disponibles con tarifa
      derivada (RoomRates/Seasons existentes) + impuestos desglosados (ITBIS) + "From $X"
      para la landing. Incluye `availableCount` por room type para urgencia (D11).
      **Acceptance**: respuesta incluye `{roomTypes: [{id, name, fromPrice, availableCount, taxBreakdown}], currency, taxes}`;

- [x] 2.5 `POST /api/public/booking` ampliado (de F0 0.16): schema acepta `promoCode`,
      `upsells: [{id, quantity}]`. El usecase valida promo (`promo-validate.ts`), aplica
      descuento, suma upsells, calcula total final, atómicamente incrementa `promoCode.uses`
      SOLO si la creación de la reserva succeede. Devuelve `{reservationId, accessToken,
      checkoutUrl, totalBreakdown}`.
      **Acceptance**: usar el mismo promo 2 veces cuando `maxUses=1` → segunda falla con
      `max_uses_reached`; reservar con promo exitoso → `uses` pasa de 0 a 1.

- [x] 2.6 `GET /api/public/hotels/:slug/upsells` (rate-limited): lista upsells activos para
      mostrar en el step de upsells del widget. Opcionalmente filtra por `kind`.
      **Acceptance**: devuelve array de upsells ordenado por `sortOrder`.

- [x] 2.7 Cron nightly `currency-rates-cron.ts`: fetcha open exchange rates (free tier)
      y guarda en `configuration(key='currency_rates')`. D10 multi-moneda.
      **Acceptance**: tras correr el cron, `GET /api/public/hotels/:slug/rates?currency=USD`
      con hotel en EUR convierte correctamente usando rates guardados.

### Frontend — Widget SPA-first

- [x] 2.8 `frontend/src/composables/useBooking.ts` (NEW): state machine con estados
      `idle → searching → selecting → upselling → checkingout → paying → confirmed | failed`.
      Pinia store setup-syntax. Maneja el multi-step, validación por step, y la
      idempotencia del botón pagar.
      **Acceptance**: navegar back/forward entre steps restaura el estado correcto.

- [x] 2.9 Componentes Vue por step en `frontend/src/components/booking/`:
      `SearchStep.vue`, `RoomsStep.vue`, `UpsellsStep.vue`, `GuestCheckoutStep.vue`,
      `PayStep.vue`, `ConfirmStep.vue`. Cada uno emite eventos al composable.
      **Acceptance**: cada step valida inputs antes de avanzar (SearchStep requiere fechas
      válidas; GuestCheckoutStep valida email regex).

- [x] 2.10 `frontend/src/pages/public/booking-widget.vue` (NEW): wrapper que usa
      `useBooking` + los 6 step components. Layout responsive mobile-first. CTA "Ver
      disponibilidad" (NO "Reservar") en la landing redirige aquí.
      **Acceptance**: sub-2s mobile 4G en Lighthouse audit (Performance ≥ 90).

- [x] 2.11 Reemplazar `frontend/src/pages/booking-widget/index.vue` (viejo, botón
      "Confirmar Reserva" sin pago): borrar el archivo. Migrar la ruta `/book/:slug`
      al NUEVO widget (mismo path, mismo componente). D-15: este es el widget Vue,
      uno de los DOS widgets duplicados existentes (el otro es el estático, task 2.12).
      **Acceptance**: grep confirma que `pages/booking-widget/index.vue` no existe;
      `/book/:slug` carga el nuevo widget.

- [x] 2.12 Reemplazar el widget estático `frontend/public/widget/` (D-15): borrar los
      6 archivos (`index.html`, `booking.js`, `loader.js`, `ga4.js`, `api.js`,
      `styles.css`). Su lógica de booking (búsqueda + selección + submit) queda
      cubierta por el nuevo SPA `pages/public/booking-widget.vue` + el composable
      `useBooking`. El tracking GA4 (viejo `ga4.js`) se migra al server-tracking
      (F3 3.10-3.12) + el client-side complement (F3 3.18).
      **Acceptance**: `ls frontend/public/widget/` no existe tras F2; `grep -r
      'public/widget' frontend/` devuelve 0 hits (salvo el nuevo `loader.js` shim
      si se elige opción A en 2.13).

- [x] 2.13 Loader embebible unificado para sitios externos: el nuevo loader sale del
      MISMO bundle SPA que la landing `/h/:slug` y el widget `/book/:slug` (router
      decide layout). Decision required (documentar en `specs/booking-widget/spec.md`):
      - **Opción A (preservar retrocompat)**: servir un `loader.js` shim en la URL
        pública `/widget/loader.js` (preserva la ruta pública, archivo nuevo) que cargue
        el nuevo bundle SPA en un `<iframe>` apuntando a `/book/:slug?embed=1`.
        Sitios externos con el snippet viejo siguen funcionando sin cambios.
      - **Opción B (breaking change)**: documentar en changelog + notificar a hoteles
        que actualicen el snippet al nuevo endpoint (`/embed/:slug/loader.js` u otro).
      Default: Opción A (menor fricción para hoteles ya integrados), salvo que el
      bundle SPA no quepa cómodamente en iframe (entonces B).
      **Acceptance**: con Opción A, un HTML de test con `<script src="/widget/loader.js"
      data-hotel="<slug>"></script>` renderiza el nuevo widget sin cambios en el sitio
      externo. Con Opción B, changelog lo documenta y el nuevo snippet funciona.

- [x] 2.14 i18n widget: `frontend/src/composables/useBookingI18n.ts` con messages ES/EN/PT.
      Idioma default = navegador (`navigator.language`), fallback ES. Switcher de idioma
      en el header del widget.
      **Acceptance**: navegar el widget con `navigator.language='en-US'` muestra textos EN;
      traducción faltante → fallback ES.

- [x] 2.15 Multi-moneda display: composable `useCurrency(sourceCurrency, targetCurrency)`
      aplica rates de `configuration('currency_rates')`. Switcher de moneda actualiza
      todos los precios del widget. Default = geo-IP via `CF-IPCountry` header.
      **Acceptance**: cambiar moneda de EUR a USD convierte tarifas sin recargar la página.

- [x] 2.16 Urgencia real D11: en `RoomsStep.vue`, si `roomType.availableCount <= 3` →
      badge "Pocas habitaciones a este precio"; si `<=1` → "Última disponible". Si `>3` →
      sin badge (no falsificar).
      **Acceptance**: con `availableCount=5`, no aparece badge.

- [x] 2.17 Calendar view estilo Airbnb: componente `CalendarView.vue` con selección
      inclusiva de noches (D-respect a mem `planning-calc-inclusive-selection-static-refs`).
      Drag de N celdas = N noches (checkout=última+1). Totales computed, no ref fijo.
      **Acceptance**: seleccionar 3 noches muestra total = 3 × nightlyRate; checkout date
      es día siguiente al último seleccionado.

### Gate F2

- [x] 2.18 typecheck + analyze + test + build verde (mismo gate que F0/F1).
      **Acceptance**: Lighthouse mobile Performance ≥ 90 en `/h/:slug` y `/book/:slug`.
      `frontend/public/widget/` eliminado; nuevo loader embebible (Opción A o B de 2.13)
      verificado en sitio externo de test.

---

## F3 — Diferenciadores

Specs: `specs/reputation-aggregator/spec.md`, `specs/wallet-pass/spec.md`,
`specs/server-tracking/spec.md`.

### Backend — Agregador de reseñas (spec: reputation-aggregator)

- [x] 3.1 Crear módulo `backend/src/modules/external-reviews/` con `make:module ExternalReviews`.
      Modelo `ExternalReviewModel` (tabla `external_reviews`):
      `id, hotelId, source ('google'|'tripadvisor'|'booking'|'airbnb'|'expedia'), sourceExternalId, authorName, rating, title, comment, language, submittedAt, url + timestamps`.
      Unique index `(source, sourceExternalId)`.
      **Acceptance**: insertar 2 reviews con mismo `(source, sourceExternalId)` → error.
      **Verificado 2026-07-29**: `modules/external-reviews/model.ts` con el unique index; test
      dedicado cubre la constraint (`upsert-batch.test.ts`).

- [x] 3.2 Connectors en `backend/src/connectors/`:
      - `gbp-reviews.ts`: llama GBP API con service account JWT (auth flow en design "Google Business Profile").
      - `tripadvisor-reviews.ts`: header `x-api-key`, GET `/location/{id}/reviews`.
      - `stayapi-reviews.ts`: GET `/reviews/{source}?hotel_id=...`, api key header.
      Cada conector: try/catch (no romper cron si una API cae), normaliza al schema
      `ExternalReviewModel`, devuelve array.
      **Acceptance**: mockear las 3 APIs → los 3 connectors devuelven arrays normalizados.
      **Verificado 2026-07-29**: `connectors/tests/gbp-reviews.test.ts` + suites análogas de
      tripadvisor/stayapi, todas verdes.

- [x] 3.3 Cron nightly `external-reviews-cron.ts` (00:00 UTC): para cada hotel con
      credentials config (gbp_place_id / tripadvisor_location_id / stayapi_hotel_ids), pull
      las 3 fuentes en paralelo, dedupe por `(source, sourceExternalId)`, upsert batch con
      `ON CONFLICT`, bump de `reviews:v{N}:{hotelId}` en cache.
      **Acceptance**: cron idempotente (correr 2× no duplica); si GBP cae, igual procesa
      TripAdvisor + StayAPI.
      **Verificado 2026-07-29**: `shared/usecases/tests/external-reviews-cron.test.ts` verde.
      **Bug real encontrado y arreglado durante la verificación**: el refactor que extrajo
      `syncHotelReviews(hotelId)` (para reuso desde 3.5) rompió el conteo de `hotelsProcessed`
      — un hotel que reventaba leyendo su `Configuration` (error real, no "sin creds") se
      contaba igual que uno exitoso porque el flag `noCreds` no cubre el caso de error. Fix:
      `if (!r.noCreds && r.errors.length === 0) result.hotelsProcessed++`
      (`external-reviews-cron.ts`). Detectado por el test "error en un hotel → continua con
      el siguiente" que ya existía y falló al re-correr la suite completa.

- [x] 3.4 Ampliar `GET /api/public/hotels/:slug/reviews` (F0 0.11) para incluir
      `external_reviews` junto con direct reviews en el aggregate. Per-source breakdown
      ahora incluye google/tripadvisor/booking/airbnb/expedia.
      **Acceptance**: hotel con 3 direct + 5 google → aggregate.count=8, perSource correcto.
      **Verificado 2026-07-29**: `opiniones/tests/aggregate.test.ts` +
      `opiniones/tests/public-endpoint.test.ts` verdes. Extendido además con el **backlink
      obligatorio de TripAdvisor** (spec.md:111-115, no cubierto por el acceptance original
      pero sí por el requirement de la spec — TripAdvisor puede suspender la API key sin él):
      nuevo campo público `sourceUrl` (`PublicReviewDTO`/`PublicReview`, `null` para direct)
      + footer "Reviews by TripAdvisor" (`rel="nofollow"`) en `ReviewsBlock.vue` cuando hay
      al menos una review de `channel==='tripadvisor'` con `sourceUrl`.

- [x] 3.5 Config admin en Settings → "Reputación externa": campos para service account JSON
      (GBP), API key (TripAdvisor), API key + hotel_ids mapeados (StayAPI). Botón "Sync now"
      para disparar el pull manualmente (dev only).
      **Acceptance**: persistir creds → next cron las usa; "Sync now" dispara y muestra
      count de reviews nuevas.
      **Verificado 2026-07-29**: `frontend/src/pages/settings/reputation.vue` (tab "Reputación
      externa" en Settings) + `ExternalReviews.service.ts` + `POST /api/external-reviews/sync-now`
      (`external-reviews/tests/sync-now.test.ts`, 6 casos incl. resiliencia/503/400). **Desvío
      documentado vs spec**: el botón queda expuesto en prod (gate `settings:edit` +
      `moduleGuard('sales.reviews')` + `requireUserType('merchant')`), no solo dev — la spec dice
      "dev only" para evitar abuso de rate-limit, pero el propio acceptance de esta tarea exige
      que "Sync now" funcione tras guardar creds, que es un flujo de producción normal (el hotel
      guarda sus llaves y quiere confirmar que andan). Riesgo de abuso bajo: 1 click manual por
      sesión autenticada de `hotel_admin`, no un endpoint público. No se implementó "Test
      connection" (mencionado en la spec, no en el acceptance de 3.5) — validar creds sin
      persistir es una pieza separada, no bloqueante para 3.5.
      **Bug real encontrado y arreglado durante la verificación**: `ExternalReviewsController`
      no tenía el método `syncNow` (index.ts lo llamaba, TS no compilaba) — implementado.
      Limpiado también scaffold roto de `arckode make:module` sin cablear
      (`migrations/..._create_externalreviews.ts` con SQL inválido + `seeds/externalreviews.ts`)
      que quedaba suelto sin referenciar desde ningún lado.

### Backend — Wallet pass (spec: wallet-pass)

- [x] 3.6 Crear módulo `backend/src/modules/wallet-pass/` con `make:module WalletPass`.
      Modelo `WalletPassModel` (tabla `wallet_passes`):
      `id, hotelId, reservationId, appleUrl (nullable), googleUrl (nullable), lockCode, generatedAt + timestamps`.
      Unique index `(reservationId)` (1 pass por reserva).
      **Acceptance**: `RUN_MIGRATE` crea tabla + unique index.

- [x] 3.7 Use case `wallet-pass/usecases/generate-pass.ts`: recibe `reservationId`, llama
      al connector `reservas-ttlock.ts` para obtener `lockCode`, genera `.pkpass` (Apple,
      via `passkit-generator` + cert del hotel en configuration `apple_pass_cert`) y Google
      pass object (service account JWT). Persiste URLs en `wallet_passes`. Si Apple cert
      inválido/vencido → log + solo Google URL.
      **Acceptance**: mock cert Apple → genera `appleUrl`; sin cert → `appleUrl=null` pero
      `googleUrl` presente.

- [x] 3.8 Connector `reservas-wallet.ts`: subscribe a `onReservationConfirmed` (mismo
      patrón que `reservas-opiniones.ts`) → dispara `generatePass(reservationId)`.
      Best-effort: try/catch no rompe el webhook de confirmación si el pass falla.
      **Acceptance**: reservar e2e → `wallet_passes` tiene una fila con ambos URLs.
      - [x] 3.8.1 (#262, REQ-HAC-07) También escucha `reservas.onRoomAssigned` → `generatePass(id, false)`:
            la fila parcial (`lockCode: ''`, creada por `usecases/partial-pass.ts` desde el cron de
            pre-llegada para reservas sin habitación) se completa in-place al asignar la unidad.

- [x] 3.9 Email "Tu pase de reserva + código de acceso" via `email-bootstrap.ts`:
      template HTML con ambos links (Apple+Google) + el `lockCode` visible.
      **Acceptance**: tras confirmar reserva, el email se encola y se envía.

### Backend — Server-side tracking (spec: server-tracking)

- [x] 3.10 Crear módulo `backend/src/modules/server-tracking/` con `make:module ServerTracking`.
      Modelo `TrackingEventModel` (tabla `tracking_events`):
      `id, hotelId, event ('view'|'search'|'select'|'upsell'|'form'|'pay'|'confirm'|'abandon'), meta (json), anonymousId, reservationId (nullable), timestamp + timestamps`.
      **Acceptance**: schema valida tipos de event contra enum; meta es JSON libre.

- [x] 3.11 Use cases `server-tracking/usecases/`:
      - `meta-capi.ts`: `fireConversion(reservationId)` → POST a Meta Graph API
        `/{pixel_id}/events` con `event_name: 'Purchase'`, `value`, `currency`,
        `event_id` (= reservationId para dedup), `action_source: 'system'`, hashed email/phone
        (Enhanced Conversions).
      - `ga4-ss.ts`: `fireConversion(reservationId)` → POST a GA4 Measurement Protocol v2
        `/{measurement_id}/collect` con `client_id`, `events: [{name:'purchase', params}]`.
      - `enhanced-conversions.ts`: hash SHA256 de email/phone antes de mandar a Meta
        (REQUIRED para Enhanced Conversions).
      Cada uno: try/catch + log en `tracking_events` (status sent/failed).
      **Acceptance**: mockear Meta + GA4 HTTP → los 2 usecases disparan; hash de email
      verificado (SHA256 lowercase sin espacios).

- [x] 3.12 Trigger en webhook confirm (`stripe.ts handleWebhook` post-confirm): llama
      `metaCapi.fireConversion(reservationId)` + `ga4ss.fireConversion(reservationId)`.
      Si Meta pixel_id/capi_key no configurados → skip silencioso. Mismo para GA4.
      **Acceptance**: confirmar reserva con creds configuradas → 2 events fire + persisten.

- [x] 3.13 Config admin Settings → "Tracking": `meta_pixel_id`, `meta_capi_token`,
      `ga4_measurement_id`, `ga4_api_secret`, `meta_test_event_code` (dev). Botón "Send
      test event" para validar la config.
      **Acceptance**: guardar creds + "Send test event" → evento llega a Meta Events Manager
      (verificable en la UI de Meta).

### Backend — Abandon recovery + OTA comparison

- [x] 3.14 Crear módulo `backend/src/modules/abandon-recovery/` con `make:module AbandonRecovery`.
      Cron cada 30 min: busca reservas con status='pending' y `createdAt < now-1h` AND
      `createdAt > now-4h` AND `abandonEmailSent=false`. Para cada una: enqueue email
      "Completá tu reserva" con link al widget que restaura el state via
      `?reservation=:id&token=:accessToken`. Marca `abandonEmailSent=true`.
      **Acceptance**: cron idempotente; reservas confirmadas no reciben el email.

- [x] 3.15 OTA Price Comparison condicional (D11+ — solo si paridad ganada): endpoint
      `GET /api/public/hotels/:slug/ota-prices?checkIn=&checkOut=` consulta StayAPI para
      Booking/Airbnb y compara con la tarifa directa. Si directo es más barato → badge
      "Mejor precio garantizado: ahorrás $X reservando directo". Si no es más barato →
      no se muestra nada (no promover OTAs).
      **Acceptance**: si tarifa directa > tarifa OTA → respuesta `{showComparison: false}`;
      si directo < OTA → `{showComparison: true, savings: amount}`.

### Frontend — F3 inyecta en widget

- [x] 3.16 `frontend/src/components/reviews/MultiChannelBadges.vue` + `AggregateScore.vue`:
      badges Google/TripAdvisor/Booking con icono + score por fuente. Score agregado
      destacado. Se inyecta en `RoomsStep.vue` y en el `ReviewsBlock` de la landing.
      **Acceptance**: badges renderizan solo si la fuente tiene reviews (no muestra badge
      vacío).

- [x] 3.17 `frontend/src/pages/public/booking-confirmation.vue` (NEW, ruta
      `/h/:slug?booking=:id&token=:token` post-redirect): muestra estado confirmed/pending/
      failed + botones "Agregar a Apple Wallet" / "Agregar a Google Wallet" (links del
      wallet_pass) + el código TTLock visible.
      **Acceptance**: tras redirect exitoso, los 2 botones están presentes y linkean a URLs
      válidas.

- [x] 3.18 Server-tracking client-side complement: `frontend/src/composables/useTracking.ts`
      dispara eventos GA4 client-side con el MISMO `client_id` y `event_id` que el server
      (para dedup en GA4). Meta Pixel (opcional) también client-side con dedup via
      `event_id` = reservationId.
      **Acceptance**: GA4 deduplica correctamente (mismo event_id no se cuenta 2×).

### Gate F3

- [x] 3.19 typecheck + analyze + test + build verde.
      **Acceptance**: cron jobs mockeados pasan; e2e test (crear reserva → confirmar →
      wallet pass + tracking fire) cubre el flujo completo.

---

## F4 — Hygiene

- [x] 4.1 Funnel de analytics real (D13): el usecase existente de `topRoomTypes:[]`
      (vacío, `usecases/analytics.ts`) se reemplaza por querys sobre `tracking_events`
      agrupados por event. Devuelve `{view, search, select, upsell, form, pay, confirm}`
      en un funnel con drop-off entre steps. Panel admin muestra el funnel.
      **Acceptance**: reservas creadas en dev generan events; el funnel muestra count real
      por step (no ceros).

- [x] 4.2 Borrar `availability_cache`: eliminar `AvailabilityCacheModel` de
      `bookingengine/model.ts:29`, el repo instantiation en `index.ts:40`, el parámetro en
      `AvailabilityUseCase` constructor. Script de migración `DROP TABLE IF EXISTS availability_cache`
      (portable SQLite+PG).
      **Acceptance**: grep `availability_cache` en `backend/src/` devuelve 0 hits; `arckode analyze`
      pasa sin warnings de repo sin uso.

- [x] 4.3 `publishReviewScore`/`publishReviewComments` (ya implementados en F0 0.11) —
      confirmar que la UI admin los expone como toggle (F0 0.21). Si algún código heredado
      los lee de otra forma inconsistente, unificar.
      **Acceptance**: grep muestra que las flags se leen en EXACTAMENTE 1 lugar (el endpoint
      público de reviews).

- [x] 4.4 Auditoría final: grep de endpoints públicos `/api/public/*` confirma que ninguno
      expone datos sensibles (sin creds, sin taxId, sin internalNotes). Lighthouse SEO +
      Performance audit en `/h/:slug`. Mobile Friendly Test.
      **Acceptance**: 0 leaks de datos sensibles; Lighthouse Performance ≥ 90, SEO ≥ 95.
      **ESTADO**: grep limpio (0 leaks). Lighthouse + Mobile Friendly: pendiente manual
      post-deploy (requiere navegador, no forma parte del gate de CI).

### Gate F4 (final)

- [x] 4.5 `cd backend && bun run typecheck` + `arckode analyze` (0 viol) + `bun test` +
      `cd frontend && bun run typecheck` + `bun run build` + auditoría manual e2e del flujo
      completo (landing → widget → Stripe redirect → confirmation → wallet pass + tracking).
      **Acceptance**: todos verde + flujo e2e verificado en dev.
      **ESTADO**: typecheck BE ✅, analyze 0 viol ✅, bun test 2513 pass ✅, typecheck FE ✅,
      build FE ✅. e2e manual (landing → Stripe redirect → wallet pass) queda como verificación
      post-deploy en navegador (no automatizable en CI).
