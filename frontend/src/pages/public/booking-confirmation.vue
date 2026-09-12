<template>
  <!--
    booking-confirmation.vue (F3 3.17, solmi-direct-booking / spec wallet-pass + booking-unification)
    Página pública STANDALONE que muestra el estado de la reserva tras el redirect de Stripe.
    Distingue del ConfirmStep.vue (step interno del widget F2): esa vista vive dentro del
    flujo SPA; esta página es un destino de redirección desde el gateway.

    Ruta: `/h/:slug/confirm?booking=:id&token=:token` (registrada en router/index.ts).

    ── CÓMO LLEGA EL USUARIO ACÁ ─────────────────────────────────────────────────
    Tras `useBooking.pay()` (F2 2.8) el widget hace redirect a Stripe Checkout. La
    successUrl que el widget arma es `/h/<slug>/confirm?booking=:id&token=:token` (placeholders
    LITERALES — el backend `stripe.ts` NO reemplaza `:id`/`:token`). Cuando Stripe vuelve a
    nuestro successUrl, lo hace con los placeholders crudos (ver reporte F2 + mem
    `stripe-success-url-placeholders`).

    Por eso esta página tiene DOS estrategias para reconstruir (id, token):
      1. Query real: `?booking=abc&token=xyz` (cuando el backend logre reemplazar los placeholders
         — deuda conocida del backend, F2 Pieza 2 deja el hack documentado).
      2. SessionStorage: si los placeholders llegan literales (`:id`/`:token`), leemos el backup
         que `useBooking.pay()` dejó en `sessionStorage['booking-widget:<slug>:last-reservation']`
         (TTL 24h) ANTES de hacer el redirect off-site a Stripe.

    ── ESTADOS QUE MANEJA ─────────────────────────────────────────────────────────
      - 'loading'    → poll en curso, no mostrar CTAs.
      - 'success'    → pago confirmado (paymentStatus=paid | reservation.status=confirmed/…).
      - 'pending'    → pago en proceso, no cerrar.
      - 'error'      → pago failed/cancelled o no se encontró la reserva (404 token inválido).

    ── WALLET PASS — DEUDA DOCUMENTADA (NO rompe acceptance literal del task) ─────
    El spec wallet-pass/spec.md pide botones "Agregar a Apple Wallet" / "Agregar a Google Wallet"
    + lockCode visible. El backend (commiteado F3 Pieza 2) define que el pass se entrega por
    EMAIL (3.9) y NO hay endpoint público del pass: `WalletPass/index.ts` declara explícitamente
    "No hay ruta pública del pass". El response del endpoint público `GET /api/public/reservations/:id?token=`
    NO incluye `lockCode` ni `walletPass`. Por lo tanto, esta página no puede mostrarlos hoy.

    El task 3.17 acceptance literal dice: "Si no hay endpoint público del pass, la página confirma
    el estado y muestra lockCode si viene en la response." → lockCode NO viene → solo confirmamos.

    La UI está armada para renderizar los botones CONDICIONALMENTE si alguna vez el backend
    agrega el pass al response (campo `walletPass` opcional). Hoy es null → los botones no aparecen.

    Tracking F3 3.18: en estado success, dispara 'purchase' con event_id=reservationId
    (mismo que el backend CAPI server-side → GA4/Meta deduplican).

    Layout mobile-first, mismo estilo del widget (usa useBookingI18n para textos).

    #241 (rediseño): cabecera con la identidad del hotel (logo/nombre/dirección desde
    `GET /api/public/hotel/:slug`), fechas legibles con Intl en el idioma del motor, nombre del
    huésped con capitalización SOLO para mostrar, número de reserva copiable, tarjeta de contacto
    (tel: / wa.me / mailto:, solo lo configurado) y "Cancelar reserva" como enlace discreto con
    confirmación. Helpers puros en `utils/booking-confirmation-format.ts`.
  -->
  <div class="min-h-screen bg-surface flex flex-col">
    <!--
      #241 — Cabecera con la identidad del hotel: logo (si lo cargó), nombre grande y dirección.
      Todo sale de `GET /api/public/hotel/:slug` (allow-list pública) — nada hardcodeado. Mientras
      carga o si falla, cae al título genérico del motor.
    -->
    <header class="bg-white border-b border-slate-200">
      <div class="max-w-md mx-auto px-4 py-6 sm:py-8 text-center" data-testid="confirm-hotel-header">
        <img
          v-if="hotel?.logo"
          :src="hotel.logo"
          :alt="hotel.name"
          width="72"
          height="72"
          class="mx-auto mb-3 h-16 w-16 sm:h-[72px] sm:w-[72px] rounded-2xl border border-slate-200 bg-white object-contain"
          data-testid="confirm-hotel-logo"
        />
        <h1 v-if="hotel?.name" class="text-2xl sm:text-3xl font-black text-navy leading-tight break-words">{{ hotel.name }}</h1>
        <h1 v-else class="text-2xl font-black text-navy">{{ t('wrapper.titleFallback') }}</h1>
        <p v-if="addressLine" class="mt-1.5 inline-flex max-w-full items-start gap-1.5 text-sm text-text-secondary" data-testid="confirm-hotel-address">
          <span class="mt-0.5 h-4 w-4 shrink-0 text-text-muted [&_svg]:h-4 [&_svg]:w-4" v-html="ICON_PIN" />
          <span class="break-words">{{ addressLine }}</span>
        </p>
      </div>
    </header>

    <main class="flex-1 max-w-md mx-auto w-full px-4 py-6 sm:py-8">
      <!-- CANCELLED (F4 #627) — el huésped canceló su reserva desde esta página. -->
      <section v-if="cancelResult" class="text-center py-6" data-testid="confirm-cancelled">
        <div class="mx-auto grid h-16 w-16 place-items-center rounded-full bg-slate-100 text-text-secondary [&_svg]:h-9 [&_svg]:w-9" v-html="ICON_X_CIRCLE" />
        <h2 class="mt-4 text-2xl font-black text-navy">{{ t('confirm.cancelledTitle') }}</h2>
        <p class="text-sm text-text-secondary mt-2">{{ t('confirm.cancelledBody') }}</p>

        <!-- Detalle de reembolso/penalty según la política aplicada. -->
        <div v-if="cancelResult.refundAmount > 0" class="mt-5 rounded-2xl border border-slate-200 bg-white p-4 text-left text-sm space-y-1.5">
          <div class="flex justify-between">
            <span class="text-text-secondary">{{ t('confirm.refund') }}</span>
            <span class="font-bold text-teal">{{ fmtMoney(cancelResult.refundAmount) }}</span>
          </div>
          <div v-if="cancelResult.cancellationFee > 0" class="flex justify-between">
            <span class="text-text-secondary">{{ t('confirm.cancellationFee') }}</span>
            <span class="font-bold text-danger">{{ fmtMoney(cancelResult.cancellationFee) }}</span>
          </div>
        </div>
        <!-- #272 (MR-07) — el estado REAL del reembolso (Stripe ya corrió al cancelar): 'done' se
             ve en la tarjeta en días; 'pending'/'failed' lo gestiona el hotel (reintento desde el
             panel). Sin monto a devolver, se explica por la política, como antes. -->
        <p
          class="text-sm mt-3"
          :class="refundStateKind === 'done' ? 'font-bold text-teal' : 'text-text-secondary'"
          data-testid="confirm-refund-state"
        >
          {{ refundStateText }}
        </p>

        <p v-if="cancelResult.idempotent" class="text-xs text-text-secondary mt-3">
          {{ t('confirm.alreadyCancelled') }}
        </p>

        <router-link
          v-if="slug"
          :to="`/h/${slug}`"
          class="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-cyan px-6 py-3 text-sm font-black text-white shadow-card transition hover:bg-cyan-light focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan/50"
        >
          {{ t('confirm.backToStart') }}
        </router-link>
      </section>

      <!-- LOADING -->
      <section v-else-if="pollingState === 'loading'" class="text-center py-10" aria-busy="true">
        <div class="h-12 w-12 mx-auto rounded-full border-4 border-cyan/30 border-t-cyan animate-spin" />
        <h2 class="text-lg font-black text-navy mt-4">{{ t('confirm.loading') }}</h2>
        <p class="text-sm text-text-secondary mt-1">{{ t('confirm.doNotClose') }}</p>
      </section>

      <!--
        SUCCESS — jerarquía (#241): confirmación → estadía → pago → qué sigue → contacto → acciones.
        "Cancelar reserva" queda al final como enlace discreto: el huésped acaba de pagar y no
        tiene que encontrarse un botón rojo al mismo nivel que "Volver al hotel".
      -->
      <section v-else-if="pollingState === 'success'" class="space-y-5" data-testid="confirm-success">
        <!-- 1. Confirmación + número de reserva -->
        <div class="text-center">
          <div class="mx-auto grid h-16 w-16 place-items-center rounded-full bg-teal/10 text-teal [&_svg]:h-9 [&_svg]:w-9" v-html="ICON_CHECK_CIRCLE" />
          <h2 class="mt-4 text-2xl sm:text-[28px] font-black text-navy leading-tight">
            {{ isPendingApproval ? t('confirm.successPendingApproval') : t('confirm.success') }}
          </h2>
          <p class="text-sm text-text-secondary mt-2" v-html="successBody" />

          <div
            v-if="bookingCode"
            class="mt-5 inline-flex max-w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3"
            data-testid="confirm-code"
          >
            <div class="min-w-0 text-left">
              <p class="text-[11px] font-bold uppercase tracking-wide text-text-secondary">{{ t('confirm.bookingNumber') }}</p>
              <p class="font-mono text-xl font-black tracking-[0.15em] text-navy" data-testid="confirm-code-value">{{ bookingCode }}</p>
            </div>
            <button
              type="button"
              class="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-bold text-navy transition hover:border-cyan hover:text-cyan focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan/50"
              :aria-label="t('confirm.copyAria')"
              data-testid="confirm-copy"
              @click="copyBookingCode"
            >
              <span class="h-4 w-4 [&_svg]:h-4 [&_svg]:w-4" :class="copied ? 'text-teal' : ''" v-html="copied ? ICON_CHECK : ICON_COPY" />
              {{ copied ? t('confirm.copied') : t('confirm.copy') }}
            </button>
          </div>
          <p class="sr-only" aria-live="polite">{{ copied ? t('confirm.copied') : '' }}</p>
        </div>

        <!--
          Tarea 3.4 (corrección 2026-08-25) — "Confirmación instantánea" apagada: el pago se
          procesó igual (por eso seguimos en la rama SUCCESS), pero el hotel todavía tiene que
          revisar la reserva. El título de arriba ya evita decir "confirmada"; esto explica el porqué.
        -->
        <div v-if="isPendingApproval" class="rounded-2xl border-2 border-gold/40 bg-gold/5 p-4">
          <p class="text-sm font-bold text-navy">{{ t('confirm.pendingApprovalNotice') }}</p>
          <!-- #271 (MR-06): plazo que el hotel se comprometió a cumplir (`booking_config.approvalDeadlineHours`). -->
          <p class="mt-1.5 text-sm text-text-secondary" data-testid="confirm-approval-deadline">
            {{ t('confirm.approvalDeadline', { hours: approvalDeadlineHours }) }}
          </p>
        </div>

        <!-- 2. Resumen de la estadía: fechas legibles en el idioma de la página, noches, huésped. -->
        <div v-if="reservation" class="rounded-2xl border border-slate-200 bg-white p-5" data-testid="confirm-stay">
          <div class="flex items-center justify-between gap-3">
            <h3 class="text-[11px] font-bold uppercase tracking-[0.18em] text-text-secondary">{{ t('confirm.stayTitle') }}</h3>
            <span v-if="nights > 0" class="rounded-full bg-cyan/10 px-2.5 py-1 text-xs font-bold text-teal" data-testid="confirm-nights">{{ t('confirm.nights', { count: nights }) }}</span>
          </div>
          <div class="mt-3 grid grid-cols-2 gap-4">
            <div class="min-w-0">
              <p class="text-xs text-text-secondary">{{ t('confirm.checkIn') }}</p>
              <p class="mt-0.5 text-sm font-bold text-navy leading-snug" data-testid="confirm-checkin">{{ checkInLabel }}</p>
            </div>
            <div class="min-w-0">
              <p class="text-xs text-text-secondary">{{ t('confirm.checkOut') }}</p>
              <p class="mt-0.5 text-sm font-bold text-navy leading-snug" data-testid="confirm-checkout">{{ checkOutLabel }}</p>
            </div>
          </div>
          <dl v-if="guestDisplayName || mealPlanLabel" class="mt-4 space-y-1.5 border-t border-slate-100 pt-3 text-sm">
            <div v-if="guestDisplayName" class="flex justify-between gap-3">
              <dt class="text-text-secondary">{{ t('confirm.guest') }}</dt>
              <dd class="font-bold text-navy text-right break-words" data-testid="confirm-guest">{{ guestDisplayName }}</dd>
            </div>
            <!-- MR-03 (#268) — el régimen que EL HUÉSPED eligió y pagó (snapshot de la reserva).
                 Solo si ≠ solo alojamiento: con importe si se cobró, chip "incluido" si venía en
                 la tarifa. Reservas anteriores a la feature no traen el campo → nada. -->
            <div v-if="mealPlanLabel" class="flex justify-between gap-3" data-testid="confirm-meal-plan">
              <dt class="text-text-secondary">{{ t('pay.mealPlan') }}</dt>
              <dd class="flex items-center gap-2 font-bold text-navy text-right">
                <span>{{ mealPlanLabel }}</span>
                <span v-if="mealPlanTotal > 0" class="tabular-nums">{{ fmtMoney(mealPlanTotal) }}</span>
                <span v-else class="rounded-full bg-cyan/10 px-2 py-0.5 text-xs font-bold text-teal">{{ t('pay.mealPlanIncluded') }}</span>
              </dd>
            </div>
          </dl>
          <!-- #272 (MR-07) — reserva de varias habitaciones: una línea por habitación del grupo.
               Con una sola, esta lista no existe y la tarjeta queda como siempre. -->
          <div v-if="groupRooms.length > 1" class="mt-4 border-t border-slate-100 pt-3" data-testid="confirm-group-rooms">
            <p class="text-xs text-text-secondary">{{ t('confirm.groupRooms') }}</p>
            <ul class="mt-1.5 space-y-1 text-sm">
              <li v-for="(room, i) in groupRooms" :key="room.id" class="flex justify-between gap-3" data-testid="confirm-group-room">
                <span class="font-bold text-navy break-words">{{ room.roomType || t('confirm.roomFallback', { n: i + 1 }) }}</span>
                <span class="shrink-0 text-text-secondary">{{ t('confirm.roomGuests', { adults: room.adults, children: room.children }) }}</span>
              </li>
            </ul>
          </div>
        </div>

        <!-- 3. Pago: total, lo cobrado y el saldo, más el estado en palabras. -->
        <div v-if="reservation" class="rounded-2xl border border-slate-200 bg-white p-5" data-testid="confirm-payment">
          <h3 class="text-[11px] font-bold uppercase tracking-[0.18em] text-text-secondary">{{ t('confirm.paymentTitle') }}</h3>
          <dl class="mt-3 space-y-1.5 text-sm">
            <div v-if="reservation.reservation.totalAmount" class="flex justify-between gap-3">
              <dt class="text-text-secondary">{{ t('confirm.total') }}</dt>
              <dd class="font-bold text-navy">{{ fmtMoney(reservation.reservation.totalAmount) }}</dd>
            </div>
            <!-- Lo que el huésped pagó. Antes solo se mostraba el total y no había forma de saber
                 si ya estaba cobrado (reporte de cliente 2026-08-30). -->
            <div v-if="amountPaid > 0" class="flex justify-between gap-3" data-testid="confirm-paid">
              <dt class="text-text-secondary">{{ t('confirm.paid') }}</dt>
              <dd class="font-bold text-teal">{{ fmtMoney(amountPaid) }}</dd>
            </div>
            <div v-if="pendingAmount > 0" class="flex justify-between gap-3" data-testid="confirm-pending">
              <dt class="text-text-secondary">{{ t('confirm.pendingAmount') }}</dt>
              <dd class="font-bold text-gold">{{ fmtMoney(pendingAmount) }}</dd>
            </div>
          </dl>
          <!-- El estado en palabras, no solo números: es lo primero que busca quien acaba de pagar. -->
          <p class="mt-3 border-t border-slate-100 pt-3 text-sm font-bold" data-testid="confirm-payment-state"
            :class="paymentState === 'paid' ? 'text-teal' : paymentState === 'partial' ? 'text-gold' : 'text-text-secondary'">
            {{ paymentState === 'paid' ? t('confirm.paidInFull')
               : paymentState === 'partial' ? t('confirm.partiallyPaid')
               : t('confirm.notPaid') }}
          </p>
        </div>

        <!-- 4. Qué sigue: horarios del hotel (si los tiene configurados) + pase/código si el backend los manda. -->
        <div class="rounded-2xl border border-slate-200 bg-white p-5" data-testid="confirm-next">
          <h3 class="text-[11px] font-bold uppercase tracking-[0.18em] text-text-secondary">{{ t('confirm.nextTitle') }}</h3>
          <ul class="mt-3 space-y-2.5 text-sm text-navy">
            <li v-if="hotelCheckInTime" class="flex items-start gap-2.5" data-testid="confirm-checkin-time">
              <span class="mt-0.5 h-4 w-4 shrink-0 text-cyan [&_svg]:h-4 [&_svg]:w-4" v-html="ICON_CLOCK" />
              <span>{{ t('confirm.checkInFrom', { time: hotelCheckInTime }) }}</span>
            </li>
            <li v-if="hotelCheckOutTime" class="flex items-start gap-2.5" data-testid="confirm-checkout-time">
              <span class="mt-0.5 h-4 w-4 shrink-0 text-cyan [&_svg]:h-4 [&_svg]:w-4" v-html="ICON_CLOCK" />
              <span>{{ t('confirm.checkOutUntil', { time: hotelCheckOutTime }) }}</span>
            </li>
            <li class="flex items-start gap-2.5">
              <span class="mt-0.5 h-4 w-4 shrink-0 text-cyan [&_svg]:h-4 [&_svg]:w-4" v-html="ICON_CLIPBOARD" />
              <span>{{ t('confirm.nextArrive') }}</span>
            </li>
          </ul>

          <!-- Wallet pass — CONDICIONAL. Hoy `walletPass` siempre es null (no hay endpoint público).
               Si el backend agrega `walletPass` al response, los botones aparecen solos. -->
          <div v-if="hasWalletPass" class="mt-4 space-y-2 border-t border-slate-100 pt-4">
            <p class="text-xs font-bold uppercase tracking-wide text-text-secondary">{{ t('confirm.walletTitle') }}</p>
            <a
              v-if="walletPass?.appleUrl"
              :href="walletPass.appleUrl"
              class="block rounded-xl bg-black px-5 py-3 text-center text-sm font-bold text-white hover:opacity-80 transition"
            >
              Apple Wallet
            </a>
            <a
              v-if="walletPass?.googleUrl"
              :href="walletPass.googleUrl"
              class="block rounded-xl bg-white border border-slate-300 px-5 py-3 text-center text-sm font-bold text-navy hover:border-cyan transition"
            >
              Google Wallet
            </a>
          </div>
          <div v-if="walletPass?.lockCode" class="mt-4 rounded-2xl border-2 border-cyan bg-cyan/5 p-4 text-center">
            <p class="text-[11px] uppercase tracking-wide text-text-secondary mb-1">{{ t('confirm.accessCode') }}</p>
            <p class="font-mono font-black text-2xl tracking-[0.3em] text-navy">{{ walletPass.lockCode }}</p>
          </div>
        </div>

        <!-- 5. Contacto del hotel: solo los medios configurados; sin ninguno, la tarjeta no existe. -->
        <div v-if="contactLinks.length > 0" class="rounded-2xl border border-slate-200 bg-white p-5" data-testid="confirm-contact">
          <h3 class="text-base font-black text-navy">{{ t('confirm.contactTitle') }}</h3>
          <p class="mt-1 text-sm text-text-secondary">{{ t('confirm.contactBody') }}</p>
          <!-- A 375px una fila por medio (el número/correo se lee entero); desde sm, en columnas. -->
          <div class="mt-4 grid grid-cols-1 gap-2" :class="contactLinks.length === 1 ? '' : contactLinks.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'">
            <a
              v-for="link in contactLinks"
              :key="link.kind"
              :href="link.href"
              :target="link.kind === 'whatsapp' ? '_blank' : undefined"
              :rel="link.kind === 'whatsapp' ? 'noopener noreferrer' : undefined"
              :title="link.detail"
              class="flex min-h-12 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-left transition hover:border-cyan focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan/50 sm:flex-col sm:items-center sm:gap-1 sm:px-2 sm:py-3 sm:text-center"
              :data-testid="`confirm-contact-${link.kind}`"
            >
              <span class="h-5 w-5 shrink-0 [&_svg]:h-5 [&_svg]:w-5" :class="link.kind === 'whatsapp' ? 'text-success' : 'text-cyan'" v-html="link.icon" />
              <span class="min-w-0 max-w-full">
                <span class="block text-sm font-bold text-navy">{{ link.label }}</span>
                <span class="block truncate text-xs text-text-secondary">{{ link.detail }}</span>
              </span>
            </a>
          </div>
        </div>

        <!-- 6. Acciones: volver (principal) y cancelar (secundaria, discreta, con confirmación). -->
        <div class="pt-1 text-center">
          <router-link
            v-if="slug"
            :to="`/h/${slug}`"
            class="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-cyan px-6 py-3.5 text-base font-black text-white shadow-card transition hover:bg-cyan-light focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan/50"
            data-testid="confirm-back"
          >
            {{ t('confirm.backHome') }}
          </router-link>

          <!-- F4 #627 — auto-cancelación. Enlace discreto: no compite con "Volver al hotel". -->
          <button
            v-if="canCancel"
            type="button"
            class="mt-5 inline-flex min-h-11 items-center justify-center px-3 text-xs font-semibold text-text-secondary underline underline-offset-4 decoration-slate-300 transition hover:text-danger hover:decoration-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan/50 rounded-lg"
            data-testid="confirm-cancel-link"
            @click="showCancelModal = true"
          >
            {{ groupRooms.length > 1 ? t('confirm.cancelLinkGroup', { n: groupRooms.length }) : t('confirm.cancelLink') }}
          </button>
        </div>
      </section>

      <!-- PENDING -->
      <section v-else-if="pollingState === 'pending'" class="text-center py-6">
        <div class="mx-auto grid h-16 w-16 place-items-center rounded-full bg-gold/10 text-gold [&_svg]:h-9 [&_svg]:w-9" v-html="ICON_CLOCK" />
        <h2 class="mt-4 text-2xl font-black text-navy">{{ t('confirm.pending') }}</h2>
        <!-- #196: el huésped volvió de Azul/CardNet y el backend NO pudo verificar el pago (hash
             inválido o error al consultar). No es "en proceso": es "no sabemos si te cobraron".
             Se le dice, y se le pide que guarde el comprobante — polling eterno acá sería mentir. -->
        <p v-if="returnedUnverified" class="text-sm font-bold text-gold mt-2" data-testid="confirm-unverified">{{ t('confirm.unverifiedBody') }}</p>
        <p v-else class="text-sm text-text-secondary mt-2">{{ t('confirm.pendingBody') }}</p>
        <button
          type="button"
          class="mt-5 min-h-11 rounded-xl border-2 border-cyan px-6 py-3 text-sm font-bold text-cyan transition hover:bg-cyan hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan/50"
          @click="startPolling"
        >
          {{ t('confirm.retry') }}
        </button>
      </section>

      <!--
        REJECTED (#271 MR-06) — el hotel revisó la reserva pendiente de aprobación y la rechazó.
        No es un error del huésped ni un pago fallido: se le dice el motivo que el hotel escribió
        y cuánto se le devolvió. Sin "Cancelar reserva": ya está cancelada.
      -->
      <section v-else-if="pollingState === 'rejected'" class="text-center py-6" data-testid="confirm-rejected">
        <div class="mx-auto grid h-16 w-16 place-items-center rounded-full bg-slate-100 text-text-secondary [&_svg]:h-9 [&_svg]:w-9" v-html="ICON_X_CIRCLE" />
        <h2 class="mt-4 text-2xl font-black text-navy">{{ t('confirm.rejectedTitle') }}</h2>
        <p v-if="rejectedRefundAmount > 0" class="text-sm text-text-secondary mt-2" data-testid="confirm-rejected-refund">
          {{ t('confirm.rejectedRefund', { amount: fmtMoney(rejectedRefundAmount) }) }}
        </p>
        <p v-else class="text-sm text-text-secondary mt-2" data-testid="confirm-rejected-no-refund">
          {{ t('confirm.rejectedNoRefund') }}
        </p>
        <div
          v-if="rejectionReason"
          class="mt-5 rounded-2xl border border-slate-200 bg-white p-4 text-left text-sm"
          data-testid="confirm-rejected-reason"
        >
          <p class="text-[11px] font-bold uppercase tracking-wide text-text-secondary">{{ t('confirm.rejectedReason') }}</p>
          <p class="mt-1 text-navy whitespace-pre-line break-words">{{ rejectionReason }}</p>
        </div>
        <router-link
          v-if="slug"
          :to="`/book/${slug}`"
          class="mt-6 inline-flex min-h-12 items-center justify-center rounded-xl bg-cyan px-6 py-3 text-sm font-black text-white shadow-card transition hover:bg-cyan-light focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan/50"
          data-testid="confirm-rejected-cta"
        >
          {{ t('confirm.expiredCta') }}
        </router-link>
      </section>

      <!-- EXPIRED (#266) — venció el plazo de pago: cancelada por el sistema, no por un pago fallido. -->
      <section v-else-if="pollingState === 'expired'" class="text-center py-6" data-testid="booking-expired">
        <div class="mx-auto grid h-16 w-16 place-items-center rounded-full bg-gold/10 text-gold [&_svg]:h-9 [&_svg]:w-9" v-html="ICON_CLOCK" />
        <h2 class="mt-4 text-2xl font-black text-navy">{{ t('confirm.expiredTitle') }}</h2>
        <p class="text-sm text-text-secondary mt-2">{{ t('confirm.expiredBody') }}</p>
        <router-link
          v-if="slug"
          :to="`/book/${slug}`"
          class="mt-5 inline-flex min-h-12 items-center justify-center rounded-xl bg-cyan px-6 py-3 text-sm font-black text-white shadow-card transition hover:bg-cyan-light focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan/50"
          data-testid="booking-expired-cta"
        >
          {{ t('confirm.expiredCta') }}
        </router-link>
      </section>

      <!-- ERROR -->
      <section v-else class="text-center py-6">
        <div class="mx-auto grid h-16 w-16 place-items-center rounded-full bg-danger/10 text-danger [&_svg]:h-9 [&_svg]:w-9" v-html="ICON_WARNING" />
        <h2 class="mt-4 text-2xl font-black text-navy">{{ t('confirm.errorTitle') }}</h2>
        <p class="text-sm text-text-secondary mt-2">{{ errorMessage }}</p>
        <router-link
          v-if="slug"
          :to="`/book/${slug}`"
          class="mt-5 inline-flex min-h-12 items-center justify-center rounded-xl bg-cyan px-6 py-3 text-sm font-black text-white shadow-card transition hover:bg-cyan-light focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan/50"
        >
          {{ t('confirm.retryCta') }}
        </router-link>
      </section>

      <!-- F4 #627 — Modal de confirmación de cancelación. -->
      <AppModal
        :open="showCancelModal"
        :title="t('confirm.cancelTitle')"
        size="sm"
        :closable="!isCancelling"
        :close-on-backdrop="!isCancelling"
        @close="showCancelModal = false"
      >
        <div class="space-y-3">
          <p v-if="cancelError" class="text-sm text-danger font-medium" role="alert">{{ cancelError }}</p>
          <p v-else class="text-sm text-text-secondary">{{ groupRooms.length > 1 ? t('confirm.cancelBodyGroup', { n: groupRooms.length }) : t('confirm.cancelBody') }}</p>
        </div>
        <template #footer>
          <button
            type="button"
            class="min-h-11 rounded-xl px-5 py-2.5 text-sm font-bold text-text-secondary hover:bg-surface transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan/50 disabled:opacity-50"
            :disabled="isCancelling"
            @click="showCancelModal = false"
          >
            {{ t('confirm.cancelKeep') }}
          </button>
          <button
            type="button"
            class="min-h-11 rounded-xl bg-danger px-5 py-2.5 text-sm font-bold text-white hover:opacity-80 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-danger/50 disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="isCancelling"
            data-testid="confirm-cancel-yes"
            @click="confirmCancellation"
          >
            {{ isCancelling ? t('confirm.cancelling') : t('confirm.cancelYes') }}
          </button>
        </template>
      </AppModal>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { BookingService } from '@/services/Booking.service'
import { PublicHotelService } from '@/services/PublicHotel.service'
import { readStoredReservation, clearStoredReservation, cancelReservation } from '@/composables/useBooking'
import { useBookingI18nStore } from '@/composables/useBookingI18n'
import { mealPlanLabelKey } from '@/utils/meal-plans'
import { useTracking, initTracking } from '@/composables/useTracking'
import AppModal from '@/components/ui/AppModal.vue'
import {
  ICON_PIN, ICON_PHONE, ICON_MAIL, ICON_CLOCK, ICON_CHECK_CIRCLE, ICON_CHECK, ICON_X_CIRCLE,
  ICON_WARNING, ICON_CLIPBOARD, ICON_WHATSAPP, ICON_COPY,
} from '@/components/landing/landing-icons'
import {
  formatStayDate, nightsBetween, displayName, publicAddressLine, shortBookingCode, hotelTimeOrEmpty,
} from '@/utils/booking-confirmation-format'
import type { PublicReservationResponse, CancelReservationResponse, PublicGroupRoom } from '@/types/booking'
import type { PublicHotelInfo } from '@/types/public-hotel'
import { CurrencyCode } from '@/types/currency'

const route = useRoute()
const i18n = useBookingI18nStore()
const { t } = i18n

/** 'expired' (#266): cancelada por vencimiento del plazo de pago (`cancellationReason ===
 *  'payment_timeout'`) — no es un error del huésped, se le ofrece volver a reservar.
 *  'rejected' (#271 MR-06): el hotel rechazó la reserva pendiente de aprobación
 *  (`approvalStatus === 'rejected'`, `status === 'cancelled'`) — se muestra motivo y reembolso. */
type PollingState = 'loading' | 'success' | 'pending' | 'expired' | 'rejected' | 'error'
const pollingState = ref<PollingState>('loading')
const reservation = ref<PublicReservationResponse | null>(null)
const errorMessage = ref(t('confirm.errorDefault'))
/** Info pública del hotel (#241): identidad, dirección, contacto y horarios de la cabecera y
 *  las tarjetas. `null` mientras carga o si el endpoint falla — la página confirma igual. */
const hotel = ref<PublicHotelInfo | null>(null)
const slug = ref('')
// F4 4.1 — hotelId resuelto desde el slug. Lo lee firePurchaseTracking para persistir el
// evento 'purchase' (mapeado a 'confirm' server-side) con el hotel correcto en tracking_events.
const hotelIdForTracking = ref('')
// Currency real del hotel (para tracker). Default 'USD' si no carga (mismo fallback que antes).
const hotelCurrency = ref<string>(CurrencyCode.USD)

// ── #241 — Identidad, estadía y contacto ────────────────────────────────────
const addressLine = computed(() => publicAddressLine(hotel.value))
const bookingCode = computed(() => shortBookingCode(reservation.value?.reservation?.id))
const checkInLabel = computed(() => formatStayDate(reservation.value?.reservation?.checkIn, i18n.locale))
const checkOutLabel = computed(() => formatStayDate(reservation.value?.reservation?.checkOut, i18n.locale))
const nights = computed(() => nightsBetween(reservation.value?.reservation?.checkIn, reservation.value?.reservation?.checkOut))
/** Solo presentación: el nombre guardado no se toca (ver `displayName`). */
const guestDisplayName = computed(() => displayName(reservation.value?.guest?.name))

// ── MR-03 (#268) — régimen elegido (snapshot en la reserva) ─────────────────
/** Etiqueta del régimen (`mealPlanLabelKey`, mapa único en utils/meal-plans.ts), o '' con solo
 *  alojamiento / reserva anterior a la feature. */
const mealPlanLabel = computed(() => {
  const code = reservation.value?.reservation?.mealPlan
  if (!code || code === 'room_only') return ''
  const key = mealPlanLabelKey(code)
  return key ? t(key) : ''
})
const mealPlanTotal = computed(() => Number(reservation.value?.reservation?.mealPlanTotal ?? 0))
const hotelCheckInTime = computed(() => hotelTimeOrEmpty(hotel.value?.checkIn))
const hotelCheckOutTime = computed(() => hotelTimeOrEmpty(hotel.value?.checkOut))

interface ContactLink {
  kind: 'phone' | 'whatsapp' | 'email'
  href: string
  label: string
  /** Lo que se ve al pasar el mouse: el número/correo real. */
  detail: string
  icon: string
}

/** Medios de contacto que el hotel publicó, en el orden en que un huésped los usa. Vacío = sin
 *  tarjeta. El `wa.me` lo arma el servidor en E.164 (`whatsappUrl`); acá no se adivinan prefijos. */
const contactLinks = computed<ContactLink[]>(() => {
  const h = hotel.value
  if (!h) return []
  const links: ContactLink[] = []
  const phone = String(h.phone ?? '').trim()
  if (phone) links.push({ kind: 'phone', href: `tel:${phone.replace(/[^\d+]/g, '')}`, label: t('confirm.call'), detail: phone, icon: ICON_PHONE })
  const wa = String(h.whatsappUrl ?? '').trim()
  if (wa.startsWith('https://wa.me/')) links.push({ kind: 'whatsapp', href: wa, label: t('confirm.whatsapp'), detail: String(h.whatsapp ?? ''), icon: ICON_WHATSAPP })
  const email = String(h.email ?? '').trim()
  if (email) links.push({ kind: 'email', href: `mailto:${email}`, label: t('confirm.emailAction'), detail: email, icon: ICON_MAIL })
  return links
})

// Copiar el número de reserva. `navigator.clipboard` no existe en http:// ni en webviews viejos:
// ahí cae a un textarea temporal + execCommand, y si tampoco, el número sigue visible para
// seleccionarlo a mano — nunca se muestra "Copiado" sin haber copiado.
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null
async function copyBookingCode(): Promise<void> {
  const code = bookingCode.value
  if (!code) return
  let ok = false
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(code)
      ok = true
    }
  } catch { /* cae al fallback */ }
  if (!ok && typeof document !== 'undefined') {
    try {
      const ta = document.createElement('textarea')
      ta.value = code
      ta.setAttribute('readonly', '')
      ta.className = 'sr-only'
      document.body.appendChild(ta)
      ta.select()
      ok = document.execCommand('copy')
      document.body.removeChild(ta)
    } catch { ok = false }
  }
  if (!ok) return
  copied.value = true
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => { copied.value = false }, 2000)
}

// ── Pago del huésped ────────────────────────────────────────────────────────
// El backend deriva estos tres de `payments` (fuente de verdad del dinero). Antes mandaba
// `paymentStatus` leyendo una columna inexistente de `reservations` y siempre decía 'unpaid'.
const amountPaid = computed(() => Number(reservation.value?.reservation?.amountPaid ?? 0))
const pendingAmount = computed(() => Number(reservation.value?.reservation?.pendingAmount ?? 0))
const paymentState = computed(() => String(reservation.value?.reservation?.paymentStatus ?? 'pending'))

/** Importe con su moneda: "613.60 USD". Sin esto la pantalla mostraba "613.6" pelado. */
function fmtMoney(amount: unknown): string {
  const n = Number(amount)
  if (!Number.isFinite(n)) return '—'
  const currency = String(reservation.value?.reservation?.currency || hotelCurrency.value || '').toUpperCase()
  return currency ? `${n.toFixed(2)} ${currency}` : n.toFixed(2)
}

const MAX_ATTEMPTS = 10
const POLL_INTERVAL_MS = 3000
let timer: ReturnType<typeof setTimeout> | null = null
let attempts = 0
let trackedPurchase = false // guard anti-doble-fire (StrictMode, onMounted twice, etc.)

// ── F4 #627 — Auto-cancelación del huésped ──────────────────────────────────
// El botón "Cancelar reserva" aparece solo en estado SUCCESS con reserva activa
// (confirmed/pending). El modal confirma la acción; el penalty se revela en el
// resultado (no hay endpoint de preview — la política se computa al cancelar).
const showCancelModal = ref(false)
const isCancelling = ref(false)
const cancelResult = ref<CancelReservationResponse | null>(null)
const cancelError = ref<string | null>(null)

/** Solo se puede cancelar si la reserva está activa (confirmed/pending). */
const canCancel = computed(() => {
  if (cancelResult.value) return false
  const rs = reservation.value?.reservation?.status?.toLowerCase() || ''
  return rs === 'confirmed' || rs === 'pending'
})

// ── #272 (MR-07) — grupo de habitaciones y estado real del reembolso ────────
/** Habitaciones del grupo al que pertenece la reserva. `[]` = reserva de una sola habitación
 *  (o backend viejo sin `group`): la página se comporta exactamente como antes. */
const groupRooms = computed<PublicGroupRoom[]>(() => reservation.value?.group?.rooms ?? [])

type RefundStateKind = 'done' | 'pending' | 'none'
/** 'done' = Stripe ya lo aceptó; 'pending' = en curso o falló (el hotel lo gestiona/reintenta —
 *  al huésped no se le muestra el fallo interno); 'none' = no hay nada que devolver. */
const refundStateKind = computed<RefundStateKind>(() => {
  const r = cancelResult.value
  if (!r || !(Number(r.refundAmount) > 0)) return 'none'
  return r.refundStatus === 'done' ? 'done' : 'pending'
})
const refundStateText = computed(() => {
  const r = cancelResult.value
  if (!r) return ''
  const amount = fmtMoney(r.refundAmount)
  if (refundStateKind.value === 'done') return t('confirm.refundDone', { amount })
  if (refundStateKind.value === 'pending') return t('confirm.refundPending', { amount })
  return t('confirm.noRefund')
})

/** Tarea 3.4 (corrección 2026-08-25) — el pago se completó (por eso llegamos a SUCCESS) pero
 *  el hotel todavía no aprobó la reserva ("confirmación instantánea" apagada). */
const isPendingApproval = computed(() => reservation.value?.reservation?.approvalStatus === 'pending')
/** #271 (MR-06) — plazo (horas) en que el hotel se comprometió a revisar. El backend manda
 *  `booking_config.approvalDeadlineHours`; 24 si no vino (reserva vieja / config sin el campo). */
const approvalDeadlineHours = computed(() => {
  const n = Number(reservation.value?.reservation?.approvalDeadlineHours)
  return Number.isFinite(n) && n > 0 ? n : 24
})
/** #271 (MR-06) — el hotel rechazó la reserva. El backend solo manda `rejectionReason` y
 *  `refundAmount` en este estado (fuera de él son `null`). */
const isRejected = computed(() => reservation.value?.reservation?.approvalStatus === 'rejected')
const rejectionReason = computed(() => String(reservation.value?.reservation?.rejectionReason ?? '').trim())
const rejectedRefundAmount = computed(() => Number(reservation.value?.reservation?.refundAmount ?? 0))
/** #196: `payment=` lo agrega el backend al redirigir desde el retorno de Azul/CardNet. */
const returnedUnverified = computed(() => {
  const p = typeof route.query.payment === 'string' ? route.query.payment : ''
  return p === 'unverified' || p === 'error'
})

async function confirmCancellation(): Promise<void> {
  const ids = resolveIds()
  if (!ids) {
    cancelError.value = t('confirm.cancelErrorIds')
    return
  }
  isCancelling.value = true
  cancelError.value = null
  try {
    const result = await cancelReservation(ids.id, ids.token)
    cancelResult.value = result
    showCancelModal.value = false
    clearStoredReservation(slug.value)
  } catch (e: unknown) {
    const msg = e instanceof Error && e.message ? e.message : t('confirm.cancelErrorDefault')
    // 409 (checked_in) o 404 (token inválido) → el mensaje del backend es legible.
    cancelError.value = msg
  } finally {
    isCancelling.value = false
  }
}

/** Wallet pass opcional en el response. Hoy el backend NO lo devuelve (deuda del backend,
 *  ver header comment). Definimos el tipo inline para no acoplarnos a un módulo backend. */
interface WalletPassInfo {
  appleUrl?: string | null
  googleUrl?: string | null
  lockCode?: string | null
}

/** Acceso defensivo al campo `walletPass` que el response podría incluir en el futuro.
 *  Casting via unknown para evitar `any` y mantener typecheck estricto. */
const walletPass = computed<WalletPassInfo | null>(() => {
  const raw = (reservation.value as unknown as { walletPass?: WalletPassInfo } | null)?.walletPass
  return raw ?? null
})

const hasWalletPass = computed(() =>
  !!walletPass.value && (!!walletPass.value.appleUrl || !!walletPass.value.googleUrl || !!walletPass.value.lockCode),
)

/** Body del mensaje de éxito, con el email embebido como <strong>. Sanitizado básico de
 *  <>&"' para no abrir superficie XSS por un email raro. */
const successBody = computed(() => {
  const email = reservation.value?.guest?.email || ''
  const safe = email.replace(/[<>&"']/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === '"' ? '&quot;' : '&#39;',
  )
  return t('confirm.sentTo', { email: `<strong class="text-navy">${safe}</strong>` })
})

/**
 * Resuelve (reservationId, accessToken) priorizando query params reales, con fallback a
 * sessionStorage si los placeholders llegaron literales. DEUDA del backend stripe.ts
 * (no reemplaza `:id`/`:token`) — F2 dejó el backup en sessionStorage.
 *
 * Casos que cubre:
 *   - Query real: ?booking=abc&token=xyz → directamente válido.
 *   - Placeholders literales: ?booking=:id&token=:token → cae a sessionStorage.
 *   - Sin query params pero con backup en sessionStorage (poco común pero posible si Stripe
 *     recorta la query al redirigir) → cae a sessionStorage.
 *   - Sin nada → no podemos recuperar, mostramos error "no encontramos tu reserva".
 */
function resolveIds(): { id: string; token: string } | null {
  const qId = typeof route.query.booking === 'string' ? route.query.booking : ''
  const qToken = typeof route.query.token === 'string' ? route.query.token : ''
  // Detectar placeholders literales (deuda backend) → forzar fallback.
  if (qId && qToken && qId !== ':id' && qToken !== ':token') {
    return { id: qId, token: qToken }
  }
  // Fallback al backup que useBooking.pay() dejó ANTES del redirect off-site a Stripe.
  const stored = readStoredReservation(slug.value)
  if (stored) return { id: stored.reservationId, token: stored.accessToken }
  return null
}

/** Un tick del poll: valida ids, pide estado, clasifica resultado. */
async function tick(): Promise<void> {
  const ids = resolveIds()
  if (!ids) {
    pollingState.value = 'error'
    errorMessage.value = t('confirm.errorNotFound')
    return
  }
  try {
    const res = await BookingService.getReservation(ids.id, ids.token)
    reservation.value = res
    const ps = String(res.paymentStatus || '').toLowerCase()
    const rs = String(res.reservation.status || '').toLowerCase()
    // #271 (MR-06): el hotel rechazó la reserva pendiente de aprobación. Va ANTES de la rama de
    // éxito y de la de cancelada: la reserva viene `cancelled` y no es ni "pago rechazado" ni
    // "venció" — se le muestra el motivo del hotel y el importe devuelto.
    if (isRejected.value) {
      pollingState.value = 'rejected'
      clearStoredReservation(slug.value)
      return
    }
    // #272 (MR-07): el huésped (o el hotel) ya canceló y el backend trae el snapshot del
    // reembolso. Se muestra la vista CANCELADA con el estado real (`cancelResult` va primero en
    // el template), no el error de "pago rechazado" ni SUCCESS (una reserva pagada y luego
    // cancelada sigue trayendo paymentStatus='paid'). Reservas canceladas antes de esta feature no
    // traen `refundStatus` ni `cancelledAt` → siguen cayendo al error genérico de abajo. La
    // vencida por falta de pago (#266) es otra cosa: se le ofrece reservar de nuevo (EXPIRED).
    const expiredByTimeout = rs === 'cancelled' && res.reservation.cancellationReason === 'payment_timeout'
    if (rs === 'cancelled' && !expiredByTimeout && (res.reservation.refundStatus || res.reservation.cancelledAt)) {
      const r = res.reservation
      cancelResult.value = {
        reservationId: r.id,
        status: 'cancelled',
        refundAmount: Number(r.refundAmount ?? 0),
        cancellationFee: Number(r.cancellationFee ?? 0),
        policyApplied: null,
        refundStatus: r.refundStatus,
        refundedAt: r.refundedAt ?? null,
        roomsCount: res.group?.rooms?.length,
        idempotent: true,
      }
      pollingState.value = 'success'
      clearStoredReservation(slug.value)
      return
    }
    if (ps === 'paid' || rs === 'confirmed' || rs === 'checked_in' || rs === 'checked_out') {
      pollingState.value = 'success'
      clearStoredReservation(slug.value) // limpieza: reserva confirmada
      firePurchaseTracking(res.reservation.id, res.reservation.totalAmount)
      return
    }
    // #266 (MR-01): el cron / checkout.session.expired cancelan la reserva pendiente sin pago con
    // cancellationReason='payment_timeout'. No es "pago rechazado": venció. Se le dice y se le
    // ofrece reservar de nuevo (la habitación ya volvió a estar disponible).
    if (expiredByTimeout) {
      pollingState.value = 'expired'
      clearStoredReservation(slug.value)
      return
    }
    if (ps === 'failed' || rs === 'cancelled' || rs === 'no_show') {
      pollingState.value = 'error'
      errorMessage.value = t('confirm.errorPayment')
      clearStoredReservation(slug.value)
      return
    }
    // pending / partial / unpaid → seguimos pollando si quedan intentos.
    pollingState.value = 'pending'
    attempts++
    if (attempts >= MAX_ATTEMPTS) return // dejamos "pending" con botón reintentar
    timer = setTimeout(tick, POLL_INTERVAL_MS)
  } catch {
    // 404 (token inválido / sin reserva) o error de red → error genérico.
    pollingState.value = 'error'
    errorMessage.value = t('confirm.errorToken')
  }
}

function startPolling(): void {
  if (timer) clearTimeout(timer)
  attempts = 0
  pollingState.value = 'loading'
  void tick()
}

/** Dispara 'purchase' client-side con event_id=reservationId para dedup con CAPI server-side.
 *  Idempotente (guard `trackedPurchase`): StrictMode o doble onMounted no lo duplica. */
function firePurchaseTracking(reservationId: string, amount?: number): void {
  if (trackedPurchase) return
  trackedPurchase = true
  try {
    useTracking().track('purchase', {
      eventId: reservationId,
      reservationId,
      value: typeof amount === 'number' ? amount : undefined,
      currency: hotelCurrency.value,
      optIn: true,
      hotelId: hotelIdForTracking.value,
    })
  } catch {
    // Tracking NUNCA debe romper la página de confirmación. Silencioso.
  }
}

onMounted(async () => {
  // Slug desde el path param.
  slug.value = typeof route.params.slug === 'string' ? route.params.slug : ''

  // Tracking: init con env vars si están (aceptance 3.18). Sin IDs → no-op silencioso.
  // Cuando exista endpoint público `GET /api/public/hotels/:slug/tracking-config`, el caller
  // lo consume y pasa los IDs al init aquí mismo.
  initTracking({
    metaPixelId: import.meta.env.VITE_META_PIXEL_ID ?? null,
    ga4MeasurementId: import.meta.env.VITE_GA4_MEASUREMENT_ID ?? null,
  })
  // Cargar el hotel (para header + nombre en success message). Best-effort: si falla, no
  // rompemos la confirmación (lo principal es mostrar el estado del pago).
  // F4 4.1 — Resolvemos el hotel ANTES de disparar 'view' para que el POST server-side del
  // funnel lleve el hotelId correcto (mismo cambio que en booking-widget.vue).
  if (slug.value) {
    try {
      const info = await PublicHotelService.getBySlug(slug.value, i18n.locale)
      hotel.value = info
      hotelIdForTracking.value = info.id
      // FE fix (audit) — Currency real del hotel (antes era hardcoded 'USD' en el tracker).
      if (info.currency) hotelCurrency.value = info.currency
    } catch {
      hotel.value = null
    }
  }

  // 'view' al montar (complementa page_view GA4 nativo).
  try {
    useTracking().track('view', { hotelId: hotelIdForTracking.value })
  } catch { /* noop */ }

  startPolling()
})

onUnmounted(() => {
  if (timer) clearTimeout(timer)
  if (copiedTimer) clearTimeout(copiedTimer)
})
</script>
