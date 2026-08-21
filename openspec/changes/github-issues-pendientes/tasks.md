# Tasks — Issues de GitHub pendientes + hallazgos del gate

Verificado contra el código el **2026-08-20**. Cada tarea lleva `archivo:línea` real; ninguna se
escribió desde el título del issue. Orden de ejecución: GH-0 primero (dinero y multi-tenancy),
después el resto.

---

## GH-0 — Hallazgos HIGH del gate `CHK-20260819` (sin issue en GitHub) 🔴

Los tres están vivos en el working tree, sobre código sin commitear. El gate cerró en `NOT_READY`
con score 82.3 tras 3 rondas. **Ninguno tiene issue**: si se pierde el working tree, se pierde el
hallazgo.

- [x] 0.1 **Link de pago reusado por el monto viejo** — `frontend/src/components/features/ReservationModal.vue:520`.
      `const created = existing?.id ? { id: existing.id } : await PaymentsService.create({...amount: pending.value...})`
      reusa el `PaymentRequest` en `pending` sin comparar su `amount` contra `pending.value`.
      Reserva $300 → link → se carga un extra de $200 → `pending` = $500 → el operador reaprieta
      "Crear link de pago" y el Checkout sale por **$300**. El modal nunca renderiza `d.payments`,
      así que el monto del link reusado no se ve en ninguna pantalla.
      Es exactamente el undercharge que `backend/src/shared/utils/reservation-balance.ts:3-8` dice
      venir a cerrar. Test `ReservationModal.test.ts:183` fija `amount: 500 == pendingAmount: 500`;
      el caso desfasado no está cubierto.
      **Fix**: si el link vigente no cubre el saldo actual, cancelarlo y crear uno nuevo (o dejar
      que el operador elija), y mostrar el monto del link vivo en el modal.
- [x] 0.2 **`deposit` usado como "lo pagado"** — `backend/src/shared/utils/reservation-balance.ts:62`.
      `const paid = Number(reservation?.deposit) || 0`. `deposit` **no** es lo cobrado:
      `grep -n deposit` da 0 hits en `folios/usecases/folio-entries.ts` y en
      `shared/usecases/settle-folio-at-checkout.ts`, y `facturas/usecases/pay-invoice.ts:30-75`
      solo escribe `invoices` + `payments`. Quien pagó $300 en efectivo por folio sigue con
      `deposit=0` → el modal muestra "Pendiente $500" y `charge-ceiling.ts:83` **autoriza** cobrar
      por Stripe plata ya cobrada. Antes del cambio ese número era cosmético; ahora es el techo de
      autorización.
      **Fix**: derivar lo pagado de `payments` (la fuente de verdad del dinero según CLAUDE.md), no
      de la columna `deposit`.
- [x] 0.3 **Webhook de Stripe alcanza el folio de otro hotel** — `backend/src/modules/payment-requests/usecases/stripe-webhook.ts:147`.
      `const folios = await folioRepo.findMany({ reservationId })` sin `hotelId`, con el
      `reservationId` venido de `session.metadata` (`:73`, `:199`) — o sea del payload. Un webhook
      firmado con el secreto del hotel A resuelve el folio abierto de una reserva del hotel B, y
      `:244` le escribe un `folio_charges` `kind:'payment'` negativo con el `hotelId` del A.
      La query hermana de `:210` **sí** lleva `hotelId`, con el comentario "Multi-tenancy: TODA
      query lleva el hotel". El blindaje quedó a medias, dos líneas más arriba.
      Relacionado, mismo archivo `:108`: `repo.update(paymentRequestId, { status: 'expired' })` sin
      cotejo de tenant, mientras la rama `completed` sí lo hace en `:64`.
- [x] 0.4 Verificación: los tres con test rojo-antes/verde-después. Gates backend
      (`bun run typecheck`, `bun test`, `arckode analyze` 0 violaciones) y frontend
      (`bun run typecheck`, `bun run build`, `vitest run`) en verde.

      **Cerrado 2026-08-20.** Rojo-antes verificado desactivando cada fix y volviendo a correr:
      - 0.1 → `frontend/src/components/features/ReservationModal.test.ts` (3 tests rojos sin el fix).
      - 0.2 → `backend/src/modules/payment-requests/tests/service.test.ts` (2 rojos),
        `backend/src/modules/reservas/tests/detail-pending.test.ts` (2 rojos),
        `backend/src/shared/tests/reservation-paid.test.ts` (unidad de la fórmula nueva).
      - 0.3 → `backend/src/modules/payment-requests/tests/stripe-webhook.test.ts` (2 rojos: filtro
        por `hotelId` del folio y 403 del `expired` cross-tenant).
      Gates: backend `typecheck` OK · `bun test` 3300/3300 · `arckode analyze` ✅ 0 violaciones ·
      frontend `vue-tsc -b` OK · `vitest run` 422/422 · `vite build` OK.

      **Deuda que queda anotada** (no bloquea, documentada en
      `backend/src/shared/usecases/reservation-paid.ts`): lo cobrado se resuelve como
      `max(reservations.deposit, Σ payments de folios/facturas de la reserva)`. Las dos fuentes no
      se contienen (el webhook de Stripe suma a las dos, un anticipo manual sólo a `deposit`, un
      cobro por folio sólo a `payments`), así que sumarlas duplicaría. Con anticipo manual Y cobro
      por folio en la MISMA reserva el `max` toma el mayor, no la suma. Cerrarlo exige que
      `deposit` deje de ser un contador propio y se derive de `payments` — refactor del modelo de
      dinero, fuera del alcance de GH-0.

---

## GH-29 — El plan actual ofrece "Suscribirse" durante el trial 🟡

Issue #29. `frontend/src/pages/suscripcion/index.vue`.

- [x] 29.1 El badge "Tu plan" se pinta con `p.id === sub?.planId` (`:70`), pero el texto del botón
      solo cambia si **además** `sub?.status === 'active'` (`:89`). En `trialing` la misma tarjeta
      muestra "Tu plan" arriba y "Suscribirse a Professional" abajo. El reporter estaba en trial
      (ver #28, mismo usuario, misma hora).
      **Fix**: la condición del botón debe mirar el plan, no el estado — y contemplar `trialing`
      con un texto propio ("Plan actual · en prueba" o "Administrar plan").
- [x] 29.2 El botón nunca se deshabilita para el plan actual: `:disabled="checkoutLoading !== null"`
      (`:87`). Apretarlo re-lanza el Checkout del plan que ya tenés.
- [x] 29.3 Test que cubra los tres estados: `active`, `trialing`, y plan distinto al actual.

## GH-32 — El PIN de garantía aparece lleno sin haberlo escrito 🟡

Issue #32. `frontend/src/pages/settings/index.vue:242`.

- [x] 32.1 `<input v-model="guaranteePinDraft" type="password" inputmode="numeric" maxlength="8" placeholder="Ingresar PIN">`
      no lleva `autocomplete`. Chrome lo trata como campo de contraseña y lo autocompleta con una
      credencial guardada. `guaranteePinDraft` arranca en `''` (`:897`), así que el valor no viene
      de la app.
      **Fix**: `autocomplete="new-password"` (o `off`) en el input. Un atributo.
      ✅ Hecho: `frontend/src/pages/settings/index.vue:245` (`autocomplete="new-password"` +
      `name="guarantee-pin"`). Test: `pages/settings/settings-plan-pin.test.ts` (rojo contra el
      archivo de HEAD, verde después).
- [x] 32.2 Barrer el resto de los `type="password"` del panel por el mismo motivo.
      ✅ Hecho: los 12 campos que quedaban sin `autocomplete` (censados con regex multilínea — el
      atributo suele caer en la línea siguiente a la apertura del tag, por eso un grep por línea
      no los veía). El criterio NO es `new-password` en todos lados; se decidió campo por campo
      leyendo qué hace cada uno:

      **`current-password`** — credencial vigente del usuario, el gestor de contraseñas TIENE que
      poder ofrecerla (ponerle `new-password` acá rompe el login):
      - `pages/auth/login.vue:70` (`v-model="password"`) — login del panel. Se respetó la
        indicación de no romperlo.
      - `pages/auth/change-password.vue:20` (`currentPassword`) — pide la contraseña **actual**
        para autorizar el cambio.

      **`new-password`** — define un secreto nuevo; es el único valor que Chrome respeta para no
      autorrellenar (`off` lo ignora deliberadamente en campos de contraseña):
      - `pages/auth/change-password.vue:36,51` (`newPassword`, `confirmPassword`) — contraseña
        nueva y su confirmación.
      - `pages/auth/reset-password.vue:45,53` (`password`, `confirmPassword`) — restablecer: las
        dos son nuevas, no existe "actual".
      - `pages/cerraduras/index.vue:86,99` (`clientSecret`, `password` de TTLock) — credenciales
        de la cuenta TTLock **del hotel**, no del usuario logueado.
      - `pages/super-admin/settings.vue:61` (`smtpPassword`) — credencial del servidor SMTP.
      - `pages/ai-receptionist/config.vue:314` (`llmApiKey`) — API key del proveedor LLM; se
        guarda cifrada, así que una clave autorrellenada se persistía sin que nadie la tipeara.
      - `pages/attendance/index.vue:84` (`pinCode`) — PIN de fichaje del empleado frente al
        lector, no una credencial del navegador.
      - `components/features/ReservationModal.vue:892` (`guaranteePin`) — PIN del hotel para
        revelar la tarjeta de garantía; espeja el criterio de 32.1 en `settings/index.vue:245`.

      Se agregó además `name` a los 12 (ninguno de esos archivos tenía `name` previo → sin
      colisiones; el test lo verifica).
      Test: `frontend/src/password-autocomplete.test.ts` — recorre los `.vue` de `src/` con regex
      multilínea, exige `autocomplete` en todo `<input type="password">`, fija el valor esperado
      de cada uno de los 13 campos y tiene un contrapeso explícito para que una barrida futura no
      "corrija" el login a `new-password`. Rojo antes del fix (15 de 16 casos), verde después.
      Verificado: `bun run typecheck` · `bun run build` (✓ built) · `bunx vitest run`
      (53 archivos, 512 tests).

      Nota (fuera del alcance de esta tarea, no es regresión): quedan 5 campos con
      `autocomplete="off"` — `components/features/ChannexPlatformConfig.vue:11`,
      `pages/pagina-publica/reputation.vue:107,144`, `pages/pagina-publica/tracking.vue:86,128`.
      Declaran el atributo (el test pasa), pero Chrome **ignora `off` en campos de contraseña**:
      para que dejen de autorrellenarse necesitan `new-password`. Son API keys de integración.

## GH-31 — El precio de un plan no coincide entre pantallas 🟡

Issue #31. Tres fuentes de verdad para el mismo número.

- [x] 31.1 `frontend/src/pages/landing/index.vue:451,461` hardcodea `price: 'USD 99'` (Essential) y
      `'USD 349'` (Professional). `frontend/src/pages/hotel-fundador/index.vue:712` hardcodea otro
      juego (`publicPrice: 'USD 349'`, `founderPrice: 'USD 244'`).
      ✅ Las dos listas se borraron. Ambas páginas piden los planes a `loadDisplayPlans()`. En
      hotel-fundador el precio fundador es un cálculo sobre el precio de la DB
      (`FOUNDER_DISCOUNT_PCT = 30`), ya no un literal: mover el precio en `plans` mueve los dos
      números. Tests: `pages/landing/landing-plans.test.ts`, `pages/hotel-fundador/hotel-fundador-plans.test.ts`.
- [x] 31.2 `frontend/src/pages/settings/index.vue:281` y `:1187` usan el literal `'Professional'`
      como plan por defecto, sin consultar la suscripción real.
      ✅ La tarjeta "Plan" resuelve `GET /api/subscription/me` (`planId`) contra `GET /api/public/plans`;
      el default `'Professional'` del `form` y el `computed planPrice` con la tabla `$199/$99/$49`
      se eliminaron. Muestra el estado real (`En prueba`/`Sin suscripción`/…) en vez de "Activo"
      fijo, y si no puede resolver el plan lo dice en vez de inventar uno.
- [x] 31.3 `/panel/suscripcion` sí lee la API (`SignupService.publicPlans()` →
      `GET /api/public/plans` → `backend/src/modules/subscriptions/service.ts:92`). Ese es el
      camino correcto.
      **Fix**: que landing, hotel-fundador y settings consuman `publicPlans()`. Precio y nombre de
      plan salen de la DB, nunca del template — misma regla que ya rige para impuestos y moneda en
      facturación (CLAUDE.md, "Facturación — reglas").
      ✅ Catálogo compartido nuevo: `frontend/src/services/PlanCatalog.service.ts` (precio/nombre de
      la DB + copy de marketing del front, que no es dato de negocio). `/api/public/plans` no lleva
      guard (`backend/src/modules/subscriptions/index.ts:80`), así que la landing pública lo
      alcanza sin sesión. Estado de carga y fallback: si la API no responde o no hay planes
      publicados se muestran las tarjetas con el precio en "Consultar" + aviso — la página nunca
      queda en blanco y **no** se resucita un precio viejo como default.
      `/panel/suscripcion` no se tocó (otro agente en paralelo).

## GH-27 — El alta no avisa cuando el correo no sale 🟡

Issue #27. `backend/src/modules/subscriptions/usecases/signup.ts:156-172`.

- [x] 27.1 El código **sí** encola el correo de verificación (`:161`) y el de bienvenida (`:170`),
      pero los dos estaban envueltos en `try { } catch { }` con el cuerpo vacío. Un SMTP caído se
      tragaba el fallo sin dejar rastro: el alta devuelve 201 y nadie sabe que el correo no salió.
      El comentario justifica no tumbar el alta — correcto — pero silenciar no es lo mismo que no
      tumbar.
      **HECHO**: `SignupDeps.logger` (obligatorio, cableado en `subscriptions/service.ts:38`) +
      `logger.warn` con `hotelId`, `email` y `error` en ambos `catch`
      (`usecases/signup.ts:169-172` verificación, `:181-184` bienvenida). El alta sigue siendo
      best-effort: NO se cae. Regresión: `tests/signup.test.ts` — 3 casos nuevos (SMTP caído,
      bienvenida caída, ambos OK sin ruido). Falla 2/13 con el `catch {}` vacío, pasa 13/13 con el fix.
- [x] 27.2 **VERIFICADO — el comentario de `:155` NO mentía; el banner y el reenvío existen**:
      banner `frontend/src/layouts/AdminLayout.vue:134-146` (visible solo para merchant con
      `emailVerified === false`, `:491-496`) → `AuthService.resendVerification()`
      (`frontend/src/services/Auth.service.ts:67-68`) → `POST /api/auth/resend-verification`
      (`backend/src/modules/usuarios/index.ts:81-86`, autenticado + rate-limit por usuario) →
      `usuarios/usecases/email-verification.ts:75-79` (re-emite token y reencola). La cola también
      tiene vista propia: `frontend/src/pages/email-queue/index.vue`. No hacía falta implementar
      nada: el comentario de `signup.ts` se amplió con esas referencias `archivo:línea` para que la
      promesa quede anclada y no vuelva a ponerse en duda.
- [ ] 27.3 **BLOQUEADO — sin acceso a prod en esta corrida.** No reproducible en local: el reporte
      es de prod (`carolin.ortiz@ukuepa.com`, 2026-08-19 19:51). Requiere inspeccionar la tabla
      `email_queue` de la DB de producción (PG `solmios` en 158.220.103.200) filtrando por el
      `hotelId` de ese alta y `relatedType='email_verification'` para saber si la fila quedó
      `failed`/`pending` o directamente nunca se insertó. Con 27.1 desplegado, un caso nuevo deja
      la línea `Alta: no se pudo encolar el correo de verificación` en el journal del servicio.

## GH-17 / GH-18 — Formularios sin nombre, sin etiqueta y sin `required` 🔴

Issues #17 (ALTA) y #18 (MEDIA). **Los dos cuerpos están desactualizados** (#17 dice "32 campos") y
el censo previo de este archivo también: contaba con un `rg` sin `--multiline`, que no ve el
`<input\n  v-model=...>` partido en varias líneas — la forma más común en este repo.

- [x] 17.1 **Censo rehecho el 2026-08-20** (`rg --pcre2 --multiline -o ... --count-matches`, que
      cuenta el tag entero aunque abarque varias líneas — el `rg -o | wc -l` anterior contaba
      *renglones de salida*, no campos):

      | Comando | Campos | Anónimos (sin `name`/`id`/`aria-label`) |
      |---|---|---|
      | `rg -o '<input[^>]*>'` (single-line, el del issue) | 317 | 299 |
      | **`rg --pcre2 --multiline -o '<input[^>]*>'`** (real) | **439** | **418** |
      | `<select>` (multiline) | 140 | 132 |
      | `<textarea>` (multiline) | 41 | 40 |

      O sea: **620 campos de formulario en `frontend/src/pages/`, 587 anónimos** — no 32. Con
      `required`: **17 de 439** inputs. (Los "anónimos" del cuadro se miden sin `name`, sin `id`,
      sin `aria-label` y sin `aria-labelledby`.)

- [x] 17.2 **Flujo operativo diario cubierto al 100%.** `id` + `<label for>` donde hay etiqueta
      visible, `aria-label` en los buscadores y filtros de cabecera que no la admiten (el diseño
      pone la lupa como ícono, no como texto).

      | Página | Campos | Anónimos antes | Anónimos ahora |
      |---|---|---|---|
      | `pages/reservations/index.vue` | 3 | 3 | 0 |
      | `pages/checkin/index.vue` | 4 | 4 | 0 |
      | `pages/guests/index.vue` | 24 | 6 | 0 |
      | `pages/payments/index.vue` (links de pago) | 6 | 6 | 0 |
      | `pages/pagos/index.vue` (pasarelas) | 9 | 9 | 0 |
      | `pages/folios/index.vue` | 6 | 6 | 0 |
      | `pages/billing/index.vue` | 13 | 12 | 0 |
      | `pages/rooms/index.vue` | 19 | 19 | 0 |
      | `pages/pre-checkin/index.vue` | 15 | 15 | 0 |
      | **Total flujo operativo** | **99** | **80** | **0** |

      `pages/caja/index.vue` y `pages/planning/index.vue` no tienen ningún campo de formulario
      (0 `input`/`select`/`textarea`): nada que hacer ahí.

      Cuidados aplicados:
      - Ids únicos por instancia donde el campo vive en un `v-for`:
        `:id="\`invoice-item-${idx}-amount\`"` (billing), `:id="\`prechk-companion-${i}-name\`"`
        (pre-checkin), `:id="\`pagos-${p.provider}-secret-key\`"` (pagos, una tarjeta por pasarela).
      - Ningún `<label for>` cuelga: todo `for` resuelve a un `id` que existe, y los `:for`
        dinámicos tienen su `:id` gemelo con el mismo template literal.
      - `pre-checkin/index.vue`: el `<div>` del texto "Leí y acepto las normas…" pasó a `<label for>`
        del checkbox — antes el texto no era clickeable ni estaba asociado.
      - De paso, `autocomplete="new-password"` en los dos campos de credencial de `pages/pagos`
        (secreto de la pasarela y del webhook) y `autocomplete="off"` en las llaves públicas: cierra
        parcialmente **32.2** (Chrome autocompletaba la contraseña del usuario dentro de la llave de
        Stripe). El resto de 32.2 sigue pendiente.

- [x] 18.1 **`required` agregado SOLO donde el schema del backend lo exige**, con el schema citado
      campo por campo. 18 campos:

      | Campo (frontend) | Schema que lo obliga |
      |---|---|
      | `#folio-charge-description`, `#checkin-charge-description` | `folios PostChargeSchema.description` |
      | `#folio-charge-amount`, `#checkin-charge-amount` | `folios PostChargeSchema.amount` |
      | `#folio-pay-amount` | `folios ApplyPaymentSchema.amount` |
      | `#payment-link-reservation` | `payment-requests CreatePaymentRequestSchema.reservationId` |
      | `#payment-link-amount` | `payment-requests CreatePaymentRequestSchema.amount` |
      | `#billing-pay-amount` | `facturas PayFacturasSchema.amount` |
      | `#billing-charge-amount` | `facturas CreateFacturasSchema.amount` |
      | `#credit-note-reason` | `facturas CreditNoteSchema.reason` |
      | `#room-number` / `#room-base-price` | `habitaciones CreateHabitacionesSchema.{number,basePrice}` |
      | `#batch-from` / `#batch-to` / `#batch-base-price` | `habitaciones BatchCreateSchema.{from,to,basePrice}` |
      | `#guest-name` | `huespedes CreateHuespedesSchema.name` (ya lo tenía) |
      | `#prechk-name` | `reservas PreCheckinSchema.name` |
      | `#prechk-contract-accepted` / `#prechk-gdpr-accepted` | `reservas PreCheckinSchema.{contractAccepted,gdprAccepted}` |

      **Lo que NO se marcó, a propósito**: `email`, `phone`, `document`, `nationality`,
      `marketingAccepted` del pre-checkin; `quantity`/`reference` del folio; `sentTo` del link de
      pago; `capacity`/`floor` de habitaciones. El comentario de
      `backend/src/modules/reservas/validators/schema.ts:184-192` documenta el bug exacto que se
      evitó: el frontend NO manda esos campos vacíos porque `validateSchema` los tomaría como
      presentes y los rechazaría por `min`/`pattern`. Marcarlos `required` habría roto el submit
      para cualquier huésped que no los completara. Hay tests que fijan que **siguen opcionales**.

      Nota aparte, no tocada: `#guest-email` (`guests/index.vue`) declara `required` pero
      `huespedes CreateHuespedesSchema.email` **no** lo exige. Es divergencia preexistente y una
      restricción más estricta del lado del cliente (no rompe nada); se deja como está y se anota.

- [x] 18.2 **Conteo real para corregir los cuerpos de #17 y #18** (post-sprint):

      | Métrica (todo `frontend/src/pages/`) | Antes | Después |
      |---|---|---|
      | Campos totales (`input`+`select`+`textarea`) | 620 | 620 |
      | `<input>` totales | 439 | 439 |
      | `<input>` sin `name` ni `id` | 418 | **361** |
      | `<input>` sin identificar (tampoco `aria-label`) | 415 | **358** |
      | `<select>` sin identificar | 132 | **115** |
      | `<textarea>` sin identificar | 40 | **34** |
      | **Campos sin identificar (total)** | **587** | **507** |
      | `<input>` con `required` | 17 | **33** |

      Texto sugerido para #17: *"587 de 620 campos de formulario en `frontend/src/pages/` no tienen
      `name`, `id` ni `aria-label` (censo 2026-08-20 con `rg --pcre2 --multiline --count-matches`;
      el "32 campos" original salía de un grep que no veía los tags partidos en varias líneas).
      El flujo operativo diario (reservas, check-in, huéspedes, cobros, habitaciones, pre-check-in
      — 99 campos) quedó cubierto al 100%; restan 507 campos en el resto del panel."*

      Texto sugerido para #18: *"17 de 439 inputs declaraban `required` (no 9). Se agregaron 18
      campos, cada uno espejando el `required: true` del schema del backend que ya lo exigía;
      quedan sin marcar, a propósito, los que el backend acepta vacíos."*

- [ ] 17.3 **Fuera del alcance de este sprint — 507 campos sin identificar restantes.** No es deuda oculta:
      queda acá con el número exacto. Los que más pesan:
      `settings/index.vue` (36 inputs) · `super-admin/settings.vue` (18) · `crm/index.vue` (14) ·
      `restaurante/carta.vue` (12) · `attendance/index.vue` (12) · `super-admin/hotels.vue` (10) ·
      `pagina-publica/landing.vue` (10) · `groups/index.vue` (10) ·
      `technical-providers/index.vue` (9) · `super-admin/referrals.vue` (9) · `payroll/index.vue` (9) ·
      `compras/ordenes.vue` (9) · `hotel-fundador/index.vue` (8) · `super-admin/roles.vue` (7) ·
      `pagina-publica/reputation.vue` (7). No se tocaron `suscripcion/`, `settings/`, `landing/` ni
      `hotel-fundador/` porque había otros agentes trabajando ahí en la misma corrida.
      Tampoco se tocó `components/` (fuera del alcance asignado): `ReservationModal.vue` y el
      wizard de reservas tienen sus propios campos sin `name`/`id`.

- [x] 17.4 **Verificación.** Guardián de regresión nuevo:
      `frontend/src/pages/form-fields-a11y.test.ts` (56 casos). Lee el fuente de las 9 páginas del
      flujo operativo con `import.meta.glob(..., { query: '?raw' })` — montarlas exigiría router,
      Pinia y ~15 services mockeados, y el defecto es puramente declarativo. Cubre: (a) ningún
      `input`/`select`/`textarea` anónimo, (b) sin `id` duplicado y sin `<label for>` colgado,
      (c) ningún `id` estático dentro de un `v-for`, (d) los 18 `required` contra el schema que los
      obliga, (e) los 10 campos que el backend acepta vacíos **siguen sin** `required`.
      **Rojo antes / verde después**: contra los archivos de `HEAD` da `37 failed | 19 passed`;
      con el cambio, `56 passed`.
      Gates frontend: `bun run typecheck` (vue-tsc -b) exit 0 · `bun run build` ✓ built ·
      `bunx vitest run` **51 archivos / 478 tests en verde** (antes del sprint: 50 / 422).

## GH-30 / GH-19 — Datos de producción, no código 🔵

- [ ] 30.1 Issue #30. El backend ordena por `sortOrder`
      (`backend/src/modules/subscriptions/service.ts:95`) y el front respeta ese orden
      (`suscripcion/index.vue:64`, sin sort propio). El desorden reportado
      (Host $29 → Starter $49 → Enterprise $199 → Professional $123 → Essential $99 → Ultra $0)
      viene de `sortOrder` mal cargado en la tabla `plans` de producción.
      **Fix**: `UPDATE plans SET sortOrder = ...` en la DB de prod, coherente con el precio.
      Verificar de paso si "Ultra $0" es un plan real o basura de seed.
- [x] 30.2 Tie-break por precio en `publicPlans()` para que un `sortOrder` vacío o repetido no
      vuelva a producir un orden arbitrario. Hecho en `subscriptions/service.ts` → `comparePublicPlans`:
      `sortOrder` → precio ascendente → nombre (orden total, sin depender de lo que devuelva la base).
      Los tres valores se normalizan con `orderableNumber()`: el ORM coerce `number` al leer
      (`orm-utils.ts` → `Number(v)`) pero deja pasar `null` y produce `NaN` con texto no numérico, y un
      `NaN` en el comparador vuelve a hacer que el resultado dependa del orden de entrada.
      Cubierto por `subscriptions/tests/service.test.ts` ("orden estable"): sortOrder distintos,
      sortOrder empatados, sortOrder ausente/null, precio como string, y empate total.
      **No cierra #30**: el dato de prod sigue mal cargado — 30.1 (`UPDATE plans`) sigue pendiente.
- [ ] 19.1 Issue #19. Tarifas y pasarelas vacías, notificaciones y reseñas en 0. Es configuración
      del hotel demo en prod, se resuelve en la misma pasada que 30.1.

## GH-CLOSE — Cierres administrativos ✅

- [x] C.1 **Cerrado #20 el 2026-08-20** — resuelto en código. `ReservationCalendar.vue:214-217`: el comentario cita
      el síntoma textual del reporte ("arrastrar la reserva desde cerca del borde derecho para
      MOVERLA disparaba resize por error — el usuario 'solo quería mover' y la estadía se
      alargaba/acortaba sola"). Handle `w-4`→`w-2` y `pr-4` de colchón entre contenido y handle.
- [x] C.2 **Cerrados #25 y #26 el 2026-08-20** ("solo es prueba") y **#26** ("Oreo mas") — ruido declarado por el propio
      texto del reporte.
- [ ] C.3 **#23** ("ESTO ESTA DESCONTROLADO NO HACE LOS MISMO", `/panel/dashboard`) — sin
      información accionable. Pedir detalle al reporter o cerrar como no reproducible.
- [ ] C.4 **#24** ("Tiene problema cuando se arrastra", `/panel/dashboard`) — el Gantt del dashboard
      (`ReservationsGantt.vue:107`) ya tiene el handle `w-2` oculto hasta hover, que es el fix
      hermano de #20. Presuntamente resuelto, pero el reporte no dice cuál era el problema:
      reconfirmar antes de cerrar.

---

## Fuera de alcance — referencia, sin tareas

No se crean tareas para esto. Se listan para no tener que volver a consultar GitHub.

| Issue | Motivo |
|---|---|
| #1, #10, #11 | WhatsApp — requiere credenciales de Meta Business |
| #7, #8, #9 | PayPal / Azul / CardNet — adapters bloqueados por decisión de negocio |
| #2, #3, #5, #6 | Channex — certificación PMS y pruebas contra el dashboard del proveedor |
| #12 | Captcha del registro — faltan las claves de Cloudflare Turnstile |
| #15 | DT-07, ya trackeado en `deudas-tecnicas-pendientes` (bloqueada de framework: el `RepositoryAdapter` no tiene `contains`/`LIKE`) |
| #16 | DT-09, ya trackeado en `deudas-tecnicas-pendientes` (bloqueada: sin credenciales fiscales) |
| #28 | Trial que exija tarjeta — feature de producto, necesita decisión antes de spec |
| #4 | UI-07 responsive 375px — ya `workflow:en-proceso` |
| #13, #14 | Ventas y Web — **no verificados**. No se inventan tareas sobre lo que no se leyó |

---

## GH-0 — Correcciones del gate CHK-20260819

Trabajo que NO nació de un issue de GitHub sino de los auditores del gate sobre este mismo diff.
Se documenta acá porque se ejecutó dentro de este change y toca sus archivos (SCP-1).

### Archivos de feature que este change no mencionaba

Salieron de sprints de este change pero no figuraban en ninguna tarea. Quedan asentados para que el
alcance del change coincida con lo que el diff realmente toca:

| Archivo | Qué es | Por qué entró |
|---|---|---|
| `backend/src/modules/admin/usecases/amenities-catalog.ts` (+ su test) | CRUD del catálogo de amenities de plataforma | Extraído del service de admin (regla GOD_SERVICE) y con contrato de error por tipo (400/403/404/409) en vez de 409-para-todo |
| `backend/src/modules/reservas/usecases/message-log.ts` (+ `tests/manual-message-log.test.ts`) | Proyección de `message_logs` para el detalle de la reserva | La tarjeta "Envíos registrados" del modal salía siempre vacía: el detalle nunca devolvía `messageLogs` |
| `backend/src/modules/payments/usecases/refund.ts` (modificado) | Devolución de un cobro con tarjeta | La devolución heredaba sólo `folioId`; los cobros de factura nacen con `invoiceId` y el refund quedaba huérfano (COR-2 de la ronda anterior) |

La tabla de arriba decía "quedan asentados" pero omitía **12 archivos de producción nuevos**. Se
completan acá — un alcance declarado más chico que el diff real es exactamente lo que `SCP-1` pide
cerrar:

| Archivo | Qué es | Por qué entró |
|---|---|---|
| `backend/src/connectors/payments-reservas.ts` | Todo movimiento de dinero resincroniza `reservations.pendingAmount` | COR-1: las mutaciones DE DINERO escribían en `payments` sin mover el saldo; listado y detalle servían dos números distintos del mismo campo |
| `backend/src/connectors/reservas-money.ts` | Puerto de lectura reserva → dinero (folios + facturas + payments) | `reservas/usecases/reservas-queries.ts` leía tres tablas de tres módulos ajenos con `orm.findMany` directo, contra la regla del proyecto |
| `backend/src/modules/payment-requests/usecases/delete-request.ts` | Baja de una solicitud de cobro | Extraído del service (GOD_SERVICE) y gemelo de `update-request`: borrar y cancelar son el mismo evento para el techo agregado |
| `backend/src/modules/payment-requests/usecases/live-session.ts` | Invariante "un cobro, a lo sumo una Checkout Session viva" | GH-0.3: el repo tenía 0 hits de `checkout.sessions.expire`; cancelar un cobro liberaba el techo con el link todavía pagable |
| `backend/src/modules/payment-requests/usecases/stripe-status.ts` | Estado de configuración de Stripe del hotel | Extraído del service (GOD_SERVICE) |
| `backend/src/modules/payment-requests/usecases/update-request.ts` | Edición de una solicitud de cobro | Extraído del service; junta techo del monto, re-verificación post-commit, baja de la sesión y auditoría |
| `backend/src/modules/payment-requests/usecases/charge-ceiling.ts` | Techo del monto de un cobro, decidido por el servidor | SEC-1/SEC-2/COR-3: el monto del Checkout lo dictaba el cliente y el techo era por cobro, no agregado |
| `backend/src/modules/reservas/usecases/reservation-changed.ts` | Socket + invalidación de caché tras un cambio de saldo fuera del CRUD | Sin esto el saldo nuevo tardaba hasta 300s en verse en el listado |
| `backend/src/modules/reservas/usecases/settle-port.ts` | Puerto del settlement del checkout, tipado | DEBT-1: nació con `any` en el actor que autoriza cerrar el folio y emitir la factura |
| `backend/src/modules/reservas/usecases/sync-pending-after-payment.ts` | Resincroniza el saldo persistido desde una fila de `payments` | Mitad `reservas` del connector `payments-reservas` (COR-1) |
| `backend/src/modules/reservas/usecases/money-port.ts` | Contrato de lectura del dinero que `reservas` consume por conector | Ver `connectors/reservas-money.ts` |
| `backend/src/modules/subscriptions/usecases/public-plans.ts` | `GET /api/public/plans` con `limits` y orden estable | GH-31: los topes de la landing salían de un literal del template, no de `plans.limits` |
| `backend/src/modules/subscriptions/usecases/public-founder-discount.ts` | `GET /api/public/founder-discount` | CFG-1: el % del programa Fundador salía de `VITE_FOUNDER_DISCOUNT_PCT`, congelado en el build |
| `backend/src/shared/usecases/sync-reservation-pending.ts` | Fórmula única del saldo persistido | Un solo lugar que calcule y escriba `pendingAmount` |
| `backend/src/shared/utils/money.ts` | `round2` + `BALANCE_EPSILON` | El redondeo del dinero estaba repetido en cada caller, con criterios distintos |
| `backend/src/modules/{folios,facturas,payments}/usecases/reservation-money.ts` | Lectura del camino reserva → dinero, en cada módulo DUEÑO | Contrapartida de `connectors/reservas-money`: la tabla la lee su dueño |

`MED-5` del scorecard viejo ("41 de 77 archivos sin relación con la tarea") era un falso positivo:
se ejecutaron SEIS sprints de este change, no sólo GH-0. El auditor lo re-emitió acotado como
`SCP-1`, que con esta tabla queda cerrado.

### Deudas detectadas y NO cerradas en esta pasada

- **Techo agregado de cobros — serialización real.** `payment-requests/usecases/charge-ceiling.ts`
  se apoya en un lock in-process (Map de módulo) más una compensación post-commit. La compensación
  es la garantía y está cubierta en `tests/charge-ceiling-concurrency.test.ts` (incluido el caso sin
  lock compartido), pero la solución definitiva es un CAS sobre un contador en `reservations`
  (campo nuevo + migración) o un `SELECT ... FOR UPDATE`, que el ORM del framework no expone.
  `orm.transaction` NO sirve acá: en Postgres READ COMMITTED no serializa una lectura AGREGADA, y
  re-verificar dentro de la transacción no ve las filas no committeadas del otro proceso.
- ~~**`TST-1` — `ai-gerente/tests/service.test.ts:26` sale a internet.**~~ **CERRADO.** El test
  ahora borra `DEEPSEEK_API_KEY`/`LLM_API_KEY` de `process.env` en `beforeEach`, restaura en
  `afterEach` y sustituye `globalThis.fetch` por un centinela que FALLA el test si alguien sale a la
  red. Además afirma lo que el nombre promete (`response` contiene "LLM no configurado"). Medido:
  1.65 s → 0.07 s. El gate corría `bun test` a secas, que autocarga `backend/.env` con las claves
  reales; el `commands.env` de LoopKit pasó a `bun run test` (= `bun test --env-file .env.test`).

### GH-0.6 — BUG-ceiling-bypass (4ª ronda del gate)

Tres rondas cerraron el bypass del techo de cobro por tres puertas distintas y se reabrió por una
cuarta. Causa raíz: el techo es un AGREGADO sobre las filas `pending`, y se dejaba mover lo que ese
agregado mide sin pasar por la baja de la Checkout Session.

- [x] **Puerta 1 — el puntero de la sesión era escribible por el cliente.** `stripeSessionId`,
      `stripePaymentUrl` y `paidAt` salieron de `UpdatePaymentRequestSchema` y de la whitelist
      `PATCHABLE`: son estado interno del servidor (los escriben `create-checkout.ts` y
      `stripe-webhook.ts`). `PUT {"stripeSessionId": ""}` no traía `status`, así que
      `releasesCeiling` daba `false`, no se expiraba nada y la fila perdía el puntero con la sesión
      `open`; el `PUT {"status":"cancelled"}` siguiente salía por `if (!pr.stripeSessionId) return
      'none'`. `paidAt` lo pone el servidor al marcar un cobro pagado a mano.
- [x] **Puerta 2 — bajar el importe liberaba techo sin matar la sesión.** `invalidatesSession`
      (`usecases/live-session.ts`) dispara la baja ante CUALQUIER cambio de importe sobre un cobro
      `pending`, no sólo ante un cambio de estado.
- [x] **`assertCeilingAfterCommit` sin test de cableado.** Borrar la llamada de `service.ts` dejaba
      74/74 en verde. `tests/ceiling-bypass.test.ts` prueba el CABLEADO (create y update) forzando
      el interleaving con un `findMany` que devuelve el competidor recién en la re-lectura.
- [x] **Cobro invisible al techo.** `shared/usecases/charge-reschedule-diff.ts` crea filas de
      `payments` sin `folioId` ni `invoiceId`; la reserva viajaba sólo en `metadata` (JSON, no
      filtrable por WHERE). Se agregó la columna indexada `payments.reservationId` — TERCER vínculo
      reserva → dinero — y `shared/usecases/reservation-paid.ts` la recorre. **Requiere
      `RUN_MIGRATE=1` en el deploy** (ADD COLUMN; las filas viejas quedan en NULL).
- [x] **Dos registries de lock in-memory sobre caminos de dinero.** `withReservationChargeLock` se
      eliminó: `payment-requests/service.ts` usa `shared/utils/async-lock.ts` (`withLock`), el mismo
      que `payments/usecases/deposits.ts`, con test propio.
- [x] **`reservas` leía tablas de otros módulos.** `paidRepos`/`reservationIdOfMoneyRow` pasan por
      `usecases/money-port.ts` + `connectors/reservas-money.ts`; la lectura la hacen los dueños.
      Contrato de `reservas` a 2.3.0 y `contract.actions` completadas con las acciones que sólo
      consumen connectors (`syncPendingAfterPayment`, `settleFolioForCheckout`, `paidSource`).
- [x] **`SettleActor` casteado sin validar.** `toSettleActor()` comprueba `id` y `role` en el borde
      HTTP y corta con `AuthError`; el dep inyectado en `service.ts` quedó tipado con `SettleFolioPort`.
- [x] **`/api/public/founder-discount` y `/api/public/plans` sin rate-limit.** 30 req/min/IP antes
      del controller, el patrón de `landing/index.ts` y `opiniones/index.ts`.
- [x] **`public-founder-discount.ts` sin test.** `subscriptions/tests/public-founder-discount.test.ts`
      cubre las cinco ramas.
- [x] **`PlanCatalogService` sin consumidores.** Lo usan las tres vistas del catálogo (`landing`,
      `hotel-fundador`, `settings`).
- [x] **`mailto:ventas@solmios.com` literal.** Los 4 call sites usan `SALES_MAILTO`/`SALES_EMAIL`
      (`VITE_SALES_EMAIL`). No queda el literal fuera del default del service.
- [x] **`verify.sh` medía contra HEAD en silencio.** El fallo de `gate.py --base` se reporta por
      stderr y deja evidencia en `state/evidence/base-resolve.txt` en vez de tragarse el aviso.
