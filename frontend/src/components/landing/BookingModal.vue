<template>
  <!--
    BookingModal — el motor de reserva DENTRO de la landing pública (`/h/:slug`).

    POR QUÉ EXISTE: la landing sacaba al huésped hacia `/book/:slug` (el widget embebible) para
    reservar. Eso es una fuga: se pierde el contexto visual del hotel justo en el momento de
    mayor intención de compra, y el huésped tiene que volver a apretar "Ver disponibilidad" con
    las fechas que YA eligió en el hero. Acá el proceso completo (habitaciones → extras → datos →
    pago → confirmación) pasa encima de la propia landing y con su identidad visual.

    QUÉ SE REUSA Y QUÉ NO:
      - LÓGICA: el store `useBookingStore` (composables/useBooking.ts) y `BookingService`. Son la
        MISMA disponibilidad, tarifas, upsells, promo, creación de reserva y cobro con Stripe que
        usa el widget. Un segundo motor de pagos se desincroniza del primero y eso es plata real.
      - PRESENTACIÓN: nada. `components/booking/*Step.vue` son del widget embebible (layout de
        columna angosta, i18n propio del widget, header con switchers). Acá la UI es la de la
        landing: modal ancho, cards con foto, tipografía del tema del hotel.

    ENTRADA CON CONTEXTO (`props.options`, ver composables/useLandingBooking.ts):
      - desde el buscador del hero → fechas ya cargadas y `skipToRooms` dispara la búsqueda al
        abrir: se entra DIRECTO al paso de habitaciones.
      - desde una card de habitación → `roomTypeId` queda pendiente y se aplica apenas hay
        tarifas (`applyPendingRoom`), así el huésped ve elegida la habitación que clickeó.

    OCUPACIÓN — YA NO SE PIDE POR ADELANTADO (2026-08-20, decisión de producto): cada tipo de
    habitación tiene su propio límite de capacidad, editable en el panel al reservar; pedirle al
    huésped "cuántos son" antes de ver los tipos era redundante y podía excluir de la búsqueda
    tipos válidos. `store.guests` queda en su default (1, `useBooking.ts`) y las tarifas se
    consultan con esa ocupación mínima para no filtrar nada por capacidad. La ocupación REAL
    (huéspedes que se graban en la reserva) sale del carrito: cada fila "para N" agregada suma su
    ocupación — ver `store.cart`/`store.cartTotalGuests` (Tarea 10, permite combinar varias filas
    y varios tipos en una misma reserva).

    MATRIZ DE OCUPACIONES (paso de habitaciones): cada tipo despliega UNA FILA POR OCUPACIÓN
    ("para 1", "para 2", "para 4"…) con su precio total y por noche, igual que el motor de la
    competencia. Lo calcula el backend (`bookingengine/usecases/occupancy-matrix.ts`) y llega en
    `roomType.occupancies`. Las ocupaciones que el hotel NO puede vender **aparecen igual, en
    gris y con el motivo** — no se ocultan: esconderlas es indistinguible de "este hotel no
    ofrece habitaciones para 4". Si `occupancies` no viene (backend viejo, respuesta cacheada),
    se degrada a la tarjeta única con `fromPrice`, el comportamiento anterior.

    ERRORES: ningún paso puede quedar en blanco. Un fallo de `/rates` devuelve el modal al paso de
    fechas CON el aviso y el botón de reintentar; sin habitaciones se muestra `EmptyState`
    (regla del proyecto: el estado vacío cubre lista vacía Y error).

    ESCAPE: `AppModal` cierra con Escape. Los popovers de fechas/huéspedes (`useAnchoredPanel`)
    también escuchan Escape en `document`, así que con el calendario abierto un Escape cierra
    calendario Y modal. Se acepta a propósito: ambos listeners viven en `document` y silenciar uno
    apagaría al otro; "Escape = salir" es una lectura razonable y no deja estado inconsistente.
  -->
  <AppModal
    size="xl"
    :title="hotel.name"
    :subtitle="headerSubtitle"
    :close-on-backdrop="!store.isSubmitting"
    :closable="!store.isSubmitting"
    body-class="p-0"
    @close="requestClose"
  >
    <div ref="contentEl" class="flex flex-col">
      <!-- Progreso: 5 pasos. No es clickeable hacia adelante (no se salta sin datos); hacia
           atrás sí, delegado en store.goToStep (que ya valida que el destino esté completo). -->
      <ol class="flex items-center gap-1 border-b border-border bg-surface px-5 py-3">
        <li v-for="(s, i) in STEPS" :key="s.key" class="flex min-w-0 flex-1 items-center gap-1">
          <button
            type="button"
            :disabled="i >= stepIndex || store.isSubmitting || step === 'done'"
            :aria-current="i === stepIndex ? 'step' : undefined"
            class="flex min-w-0 items-center gap-1.5 text-left disabled:cursor-default"
            @click="store.goToStep(i)"
          >
            <span
              class="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-black transition-colors"
              :class="i < stepIndex ? 'bg-teal text-white' : i === stepIndex ? 'bg-navy text-white' : 'bg-surface-dark text-text-muted'"
            >{{ i < stepIndex ? '✓' : i + 1 }}</span>
            <span
              class="hidden truncate text-[11px] font-bold uppercase tracking-wide sm:inline"
              :class="i === stepIndex ? 'text-navy' : 'text-text-muted'"
            >{{ s.label }}</span>
          </button>
          <span v-if="i < STEPS.length - 1" class="h-px flex-1 bg-border" aria-hidden="true" />
        </li>
      </ol>

      <div class="p-5">
        <!-- ─── Paso 1: fechas ──────────────────────────────────────────────── -->
        <section v-if="step === 'dates'" class="space-y-4">
          <header>
            <h4 class="text-lg font-black text-navy">¿Cuándo venís?</h4>
            <p class="mt-0.5 text-sm text-text-secondary">
              Elegí las fechas. Te mostramos las habitaciones con el precio real para cada
              ocupación.
            </p>
          </header>

          <div class="flex flex-wrap items-stretch gap-1 rounded-2xl border border-border bg-white p-2">
            <RateCalendar
              v-model:check-in="checkIn"
              v-model:check-out="checkOut"
              :hotel-slug="hotel.slug"
              :guests="store.physicalGuests"
              :currency="store.displayCurrency || undefined"
              @validity="onCalendarValidity"
            />
          </div>

          <p v-if="datesError" class="text-xs font-bold text-danger" role="alert">{{ datesError }}</p>

          <!-- Fallo de /rates: el store vuelve a 'idle', así que el aviso vive acá. Nunca se
               queda una pantalla vacía: el huésped ve qué pasó y puede reintentar. -->
          <div
            v-if="store.ratesError"
            class="rounded-2xl border border-danger/30 bg-danger/5 px-4 py-3"
            role="alert"
          >
            <p class="text-sm font-bold text-danger">{{ store.ratesError }}</p>
            <button
              type="button"
              class="mt-2 cursor-pointer rounded-full border border-danger px-4 py-1.5 text-xs font-bold text-danger transition-colors hover:bg-danger hover:text-white"
              @click="submitSearch"
            >Reintentar</button>
          </div>
        </section>

        <!-- ─── Paso 2: habitaciones ───────────────────────────────────────── -->
        <section v-else-if="step === 'rooms'" class="space-y-4">
          <header class="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h4 class="text-lg font-black text-navy">Elegí tu habitación</h4>
              <p class="mt-0.5 text-sm text-text-secondary">{{ staySummary }}</p>
            </div>
            <button
              type="button"
              class="cursor-pointer text-xs font-extrabold text-cyan underline decoration-dotted underline-offset-2 hover:text-navy"
              @click="store.goToStep(0)"
            >Cambiar fechas</button>
          </header>

          <div v-if="store.ratesLoading" class="space-y-3" aria-hidden="true">
            <div v-for="i in 2" :key="i" class="h-28 animate-pulse rounded-2xl bg-surface" />
          </div>

          <!--
            El calendario (RateCalendar.vue) valida noche por noche si ALGÚN tipo de habitación
            tiene lugar (día agregado entre todos los tipos), no si un MISMO tipo cubre TODO el
            rango elegido seguido — por eso se puede llegar acá vacío con fechas que el calendario
            permitió elegir sin avisar nada. El mensaje explica esa causa probable en vez de un
            "sin disponibilidad" genérico que ya dice el título de arriba (spec
            booking-availability-pricing, requirement "El calendario no puede prometer un rango
            que la búsqueda no puede cumplir").
          -->
          <EmptyState
            v-else-if="availableRooms.length === 0"
            title="Sin habitaciones para esas fechas"
            message="Es posible que ninguna habitación tenga lugar para TODAS esas noches seguidas. Probá un rango más corto, otras fechas o menos huéspedes."
          >
            <template #action>
              <button
                type="button"
                class="cursor-pointer rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-navy-light"
                @click="store.goToStep(0)"
              >Cambiar fechas</button>
            </template>
          </EmptyState>

          <ul v-else class="space-y-3">
            <li v-for="rt in availableRooms" :key="rt.id">
              <article
                class="rounded-2xl border-2 bg-white p-3 transition-colors"
                :class="cartHasType(rt.id) ? 'border-cyan ring-2 ring-cyan/20' : 'border-border'"
              >
                <div class="flex gap-4">
                  <img
                    v-if="rt.photoUrl"
                    :src="rt.photoUrl"
                    :alt="prettify(rt.name)"
                    class="hidden h-24 w-32 shrink-0 rounded-xl object-cover sm:block"
                    loading="lazy"
                  />
                  <div class="flex min-w-0 flex-1 flex-col gap-1">
                    <span class="font-black text-navy">{{ prettify(rt.name) }}</span>
                    <span v-if="roomSpecs(rt)" class="text-xs font-bold text-text-muted">{{ roomSpecs(rt) }}</span>
                    <!--
                      `fromPrice` viene PRE-impuestos y el `taxBreakdown` llega aparte (ver
                      public-rates.ts). Decir "Incluye" acá anunciaba un precio que no incluye
                      nada: el huésped paga fromPrice + los impuestos de esta lista.
                    -->
                    <span v-if="rt.taxBreakdown.length > 0" class="text-[11px] text-text-muted">
                      +
                      <template v-for="(tax, i) in rt.taxBreakdown" :key="tax.name">
                        <template v-if="i > 0"> + </template>{{ tax.rate }}% {{ tax.name }}
                      </template>
                    </span>
                    <span v-if="urgency(rt.availableCount)" class="mt-0.5">
                      <span
                        class="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide"
                        :class="rt.availableCount <= 1 ? 'bg-danger/10 text-danger' : 'bg-gold/15 text-navy'"
                      >{{ urgency(rt.availableCount) }}</span>
                    </span>
                  </div>
                  <div class="flex shrink-0 flex-col items-end justify-center text-right">
                    <span class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Desde · total estadía</span>
                    <span class="text-lg font-black tabular-nums text-navy">{{ money(rt.fromPrice) }}</span>
                    <span class="text-[11px] font-bold tabular-nums text-text-muted">{{ money(perNight(rt)) }}/noche</span>
                  </div>
                </div>

                <!--
                  RÉGIMEN — catálogo real configurable por hotel (tasks.md 2.2/2.4, `meal_plans`).
                  "Sólo alojamiento" es la base implícita. Los otros 3 códigos vienen de
                  `store.mealPlans` (solo los `active` llegan del backend); sin fila = el hotel
                  no lo ofrece, se pinta deshabilitado con el motivo (nunca se oculta). Un
                  régimen con costo aparte se muestra informativo con su precio ("Próximamente")
                  — todavía no es seleccionable ni afecta el cobro (ver alcance del plan aprobado).
                -->
                <div class="mt-3">
                  <p class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Régimen</p>
                  <div class="mt-1 flex flex-wrap gap-1.5">
                    <span class="inline-flex items-center gap-1 rounded-full bg-navy px-2.5 py-1 text-[11px] font-bold text-white">
                      <span aria-hidden="true">●</span>Sólo alojamiento
                    </span>
                    <span
                      v-for="plan in boardPlanRows"
                      :key="plan.code"
                      :class="[
                        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold',
                        plan.state === 'included'
                          ? 'bg-navy text-white'
                          : plan.state === 'upcoming'
                            ? 'border border-cyan/40 bg-cyan/10 text-navy'
                            : 'cursor-not-allowed border border-border bg-surface text-text-muted',
                      ]"
                      :title="plan.title"
                      :aria-disabled="plan.state === 'unavailable' ? 'true' : undefined"
                    >
                      <span aria-hidden="true">{{ plan.state === 'included' ? '●' : '○' }}</span>{{ plan.label }}
                      <span v-if="plan.state === 'upcoming'" class="ml-0.5 text-[9px] font-black uppercase text-cyan">Próximamente</span>
                    </span>
                  </div>
                </div>

                <!--
                  Una fila por ocupación ("para 1", "para 2"…) — SALVO corridas de igual precio,
                  que se agrupan para pintar el número una sola vez (utils/occupancy-groups.ts:
                  "para 1/2/3 $130" repetido lee como bug; el precio distinto sí va fila por
                  fila). Las que el hotel NO puede vender se muestran deshabilitadas CON el
                  motivo — no se ocultan (ver comentario de cabecera del componente).
                -->
                <ul v-if="occupancyRows(rt).length > 0" class="mt-3 divide-y divide-border border-t border-border">
                  <li v-for="entry in groupedOccupancyRows(rt)" :key="entry.kind === 'group' ? `g-${entry.rows[0]!.occupancy}` : entry.row.occupancy" class="py-3">
                    <!-- Grupo de ocupaciones al mismo precio: el precio se pinta UNA vez, cada
                         ocupación es su propia fila con stepper propio (líneas de carrito distintas). -->
                    <div v-if="entry.kind === 'group'">
                      <div class="flex items-center justify-between gap-3">
                        <span class="text-[10px] font-bold uppercase tracking-wide text-text-muted">
                          Precio {{ store.nights || 1 }} {{ (store.nights || 1) === 1 ? 'noche' : 'noches' }}
                        </span>
                        <span class="text-right">
                          <span class="block text-sm font-black tabular-nums text-navy">{{ money(entry.rows[0]!.price) }}</span>
                          <span class="block text-[11px] tabular-nums text-text-muted">{{ money(entry.rows[0]!.pricePerNight) }}/noche</span>
                        </span>
                      </div>
                      <div class="mt-2 space-y-2">
                        <div v-for="row in entry.rows" :key="row.occupancy" :data-occupancy="row.occupancy" class="flex items-center gap-3">
                          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-navy/50">
                            <span class="h-4 w-4 [&_svg]:h-full [&_svg]:w-full" v-html="row.occupancy > 1 ? ICON_USERS : ICON_USER" />
                          </span>
                          <span class="flex-1 text-sm font-bold text-navy">para {{ row.occupancy }}</span>
                          <Stepper
                            :model-value="cartQuantity(rt, row.occupancy)"
                            :min="0"
                            :max="rt.availableCount"
                            :label="`${prettify(rt.name)} · para ${row.occupancy}`"
                            @update:model-value="onQtyChange(rt, row, $event)"
                          />
                        </div>
                      </div>
                    </div>
                    <!-- Fila individual: stepper de cantidad (combina varias ocupaciones/tipos en la misma reserva) -->
                    <div v-else :data-occupancy="entry.row.occupancy" class="flex w-full items-center gap-3" :class="!entry.row.available && 'opacity-60'">
                      <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-navy/50">
                        <span class="h-4 w-4 [&_svg]:h-full [&_svg]:w-full" v-html="entry.row.occupancy > 1 ? ICON_USERS : ICON_USER" />
                      </span>
                      <span class="min-w-0 flex-1">
                        <span class="block text-sm font-bold text-navy">para {{ entry.row.occupancy }}</span>
                        <template v-if="entry.row.available">
                          <span class="block text-[11px] tabular-nums text-text-muted">{{ money(entry.row.price) }} · {{ money(entry.row.pricePerNight) }}/noche</span>
                        </template>
                        <span v-else class="block text-[11px] font-bold text-text-secondary">{{ unavailableLabel(entry.row.unavailableReason) }}</span>
                      </span>
                      <Stepper
                        v-if="entry.row.available"
                        :model-value="cartQuantity(rt, entry.row.occupancy)"
                        :min="0"
                        :max="rt.availableCount"
                        :label="`${prettify(rt.name)} · para ${entry.row.occupancy}`"
                        @update:model-value="onQtyChange(rt, entry.row, $event)"
                      />
                    </div>
                  </li>
                </ul>

                <!-- Fallback sin matriz (backend viejo / respuesta cacheada): stepper con el
                     precio único de siempre. -->
                <div v-else class="mt-3 flex items-center justify-between gap-3 rounded-xl bg-surface px-3 py-2.5">
                  <span class="text-xs font-bold text-text-muted">Cantidad</span>
                  <Stepper
                    :model-value="cartQuantity(rt, 1)"
                    :min="0"
                    :max="rt.availableCount"
                    :label="prettify(rt.name)"
                    @update:model-value="onFallbackQtyChange(rt, $event)"
                  />
                </div>
              </article>
            </li>
          </ul>

          <!--
            Tipos SIN disponibilidad continua para estas fechas (catálogo, no `/rates`) — se
            muestran deshabilitados con el motivo en vez de ocultarse. Sin precio (no hay tarifa
            vigente que cotizar) ni CTA (no se puede elegir algo no reservable).
          -->
          <ul v-if="unavailableCatalogRooms.length > 0" class="space-y-3">
            <li v-for="rt in unavailableCatalogRooms" :key="rt.id">
              <article class="rounded-2xl border-2 border-dashed border-border bg-surface p-3 opacity-70">
                <div class="flex gap-4">
                  <img
                    v-if="rt.photoUrl"
                    :src="rt.photoUrl"
                    :alt="prettify(rt.name)"
                    class="hidden h-24 w-32 shrink-0 rounded-xl object-cover grayscale sm:block"
                    loading="lazy"
                  />
                  <div class="flex min-w-0 flex-1 flex-col justify-center gap-1">
                    <span class="font-black text-navy">{{ prettify(rt.name) }}</span>
                    <span v-if="roomSpecs(rt)" class="text-xs font-bold text-text-muted">{{ roomSpecs(rt) }}</span>
                    <span class="mt-1 inline-flex w-fit items-center rounded-full bg-border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-text-secondary">
                      No disponible para estas fechas
                    </span>
                  </div>
                </div>
              </article>
            </li>
          </ul>

          <!--
            Carrito — resumen visible de lo agregado (Tarea 10, solmi-direct-booking-qa-fixes):
            combina distintos tipos/ocupaciones en una misma reserva. Muestra habitaciones totales,
            huéspedes totales y noches antes de avanzar al paso de extras.
          -->
          <div v-if="store.cart.length > 0" class="rounded-2xl border-2 border-cyan/30 bg-cyan/5 p-4 space-y-3">
            <h4 class="text-sm font-black text-navy">Tu selección</h4>
            <ul class="space-y-2">
              <li v-for="line in store.cart" :key="line.key" class="flex items-center justify-between gap-2 text-sm">
                <div class="min-w-0">
                  <p class="truncate font-bold text-navy">{{ prettify(line.roomName) }} · para {{ line.occupancy }}</p>
                  <p class="text-xs text-text-muted">{{ line.quantity }} × {{ money(line.unitPrice) }}</p>
                </div>
                <div class="flex shrink-0 items-center gap-2">
                  <span class="font-black tabular-nums text-navy">{{ money(line.unitPrice * line.quantity) }}</span>
                  <button
                    type="button"
                    class="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-text-muted hover:bg-danger/10 hover:text-danger"
                    aria-label="Quitar"
                    @click="store.removeCartLine(line.key)"
                  ><span class="h-3.5 w-3.5 [&_svg]:h-full [&_svg]:w-full" v-html="ICON_X" /></button>
                </div>
              </li>
            </ul>
            <div class="flex items-center justify-between border-t border-cyan/20 pt-2 text-xs font-bold text-text-muted">
              <span>{{ store.cartTotalRooms }} {{ store.cartTotalRooms === 1 ? 'habitación' : 'habitaciones' }} · {{ store.cartTotalGuests }} {{ store.cartTotalGuests === 1 ? 'huésped' : 'huéspedes' }} · {{ store.nights || 1 }} {{ (store.nights || 1) === 1 ? 'noche' : 'noches' }}</span>
              <span class="text-sm text-navy">{{ money(store.roomsSubtotal) }}</span>
            </div>
          </div>
        </section>

        <!-- ─── Paso 3: extras ─────────────────────────────────────────────── -->
        <section v-else-if="step === 'extras'" class="space-y-4">
          <header>
            <h4 class="text-lg font-black text-navy">¿Querés sumar algo?</h4>
            <p class="mt-0.5 text-sm text-text-secondary">Opcional. Podés seguir sin elegir nada.</p>
          </header>

          <div v-if="store.upsellsLoading" class="space-y-3" aria-hidden="true">
            <div v-for="i in 2" :key="i" class="h-20 animate-pulse rounded-2xl bg-surface" />
          </div>

          <EmptyState
            v-else-if="store.upsells.length === 0"
            title="Sin extras disponibles"
            message="Este hotel todavía no publicó servicios adicionales. Seguí con tus datos."
          />

          <ul v-else class="space-y-3">
            <li
              v-for="up in store.upsells"
              :key="up.id"
              class="rounded-2xl border-2 bg-white p-4 transition-colors"
              :class="isSelectedUpsell(up.id) ? 'border-cyan ring-2 ring-cyan/20' : 'border-border'"
            >
              <div class="flex items-start justify-between gap-3">
                <label class="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    class="mt-1 h-5 w-5 shrink-0 rounded border-border text-cyan focus:ring-cyan/30"
                    :checked="isSelectedUpsell(up.id)"
                    @change="toggleUpsell(up.id, ($event.target as HTMLInputElement).checked)"
                  />
                  <span class="min-w-0">
                    <span class="block font-bold text-navy">{{ up.name }}</span>
                    <span v-if="up.description" class="mt-0.5 block text-xs text-text-muted">{{ up.description }}</span>
                    <span class="mt-1 block text-[10px] font-bold uppercase tracking-wide text-text-muted">{{ UPSELL_KIND_LABEL[up.kind] }}</span>
                  </span>
                </label>
                <span class="shrink-0 text-right font-black tabular-nums text-navy">{{ money(up.price) }}</span>
              </div>

              <div v-if="isSelectedUpsell(up.id) && up.kind !== 'per_stay'" class="mt-3 flex items-center gap-2">
                <span class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Cantidad</span>
                <button
                  type="button"
                  :aria-label="`Quitar una unidad de ${up.name}`"
                  class="grid h-8 w-8 cursor-pointer place-items-center rounded-full border border-border font-black text-navy transition-colors hover:bg-surface"
                  @click="setUpsellQty(up.id, upsellQty(up.id) - 1)"
                >−</button>
                <span class="w-6 text-center font-black tabular-nums text-navy">{{ upsellQty(up.id) }}</span>
                <button
                  type="button"
                  :aria-label="`Agregar una unidad de ${up.name}`"
                  class="grid h-8 w-8 cursor-pointer place-items-center rounded-full border border-border font-black text-navy transition-colors hover:bg-surface"
                  @click="setUpsellQty(up.id, upsellQty(up.id) + 1)"
                >+</button>
              </div>
            </li>
          </ul>
        </section>

        <!-- ─── Paso 4: datos del huésped ──────────────────────────────────── -->
        <section v-else-if="step === 'guest'" class="space-y-4">
          <header>
            <h4 class="text-lg font-black text-navy">¿A nombre de quién?</h4>
            <p class="mt-0.5 text-sm text-text-secondary">Sin crear cuenta. Te mandamos la confirmación por email.</p>
          </header>

          <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="goNext">
            <label class="block sm:col-span-2">
              <span class="mb-1 block text-[10px] font-bold uppercase tracking-wide text-text-muted">Nombre y apellido</span>
              <input
                v-model="store.guest.name"
                type="text"
                autocomplete="name"
                class="w-full rounded-xl border border-border bg-white px-4 py-3 text-sm text-navy focus:border-cyan focus:outline-none focus:ring-2 focus:ring-cyan/30"
                :class="{ 'border-danger': touched && !!nameError }"
                @blur="touched = true"
              />
              <span v-if="touched && nameError" class="mt-1 block text-xs font-bold text-danger">{{ nameError }}</span>
            </label>

            <label class="block">
              <span class="mb-1 block text-[10px] font-bold uppercase tracking-wide text-text-muted">Email</span>
              <input
                v-model="store.guest.email"
                type="email"
                inputmode="email"
                autocomplete="email"
                class="w-full rounded-xl border border-border bg-white px-4 py-3 text-sm text-navy focus:border-cyan focus:outline-none focus:ring-2 focus:ring-cyan/30"
                :class="{ 'border-danger': touched && !!emailError }"
                @blur="touched = true"
              />
              <span v-if="touched && emailError" class="mt-1 block text-xs font-bold text-danger">{{ emailError }}</span>
            </label>

            <label class="block">
              <span class="mb-1 block text-[10px] font-bold uppercase tracking-wide text-text-muted">Teléfono</span>
              <input
                v-model="store.guest.phone"
                type="tel"
                inputmode="tel"
                autocomplete="tel"
                class="w-full rounded-xl border border-border bg-white px-4 py-3 text-sm text-navy focus:border-cyan focus:outline-none focus:ring-2 focus:ring-cyan/30"
                :class="{ 'border-danger': touched && !!phoneError }"
                @blur="touched = true"
              />
              <span v-if="touched && phoneError" class="mt-1 block text-xs font-bold text-danger">{{ phoneError }}</span>
            </label>

            <label class="block sm:col-span-2">
              <span class="mb-1 block text-[10px] font-bold uppercase tracking-wide text-text-muted">Pedidos especiales (opcional)</span>
              <textarea
                v-model="store.guest.notes"
                rows="2"
                placeholder="Hora estimada de llegada, cuna, piso alto…"
                class="w-full rounded-xl border border-border bg-white px-4 py-3 text-sm text-navy focus:border-cyan focus:outline-none focus:ring-2 focus:ring-cyan/30"
              />
            </label>

            <!--
              Aviso de privacidad. Este es el punto donde se piden datos personales, así que el
              para-qué y el quién se dicen ACÁ, no en una página que no existe. NO se promete
              cumplimiento de ninguna ley ni se enlaza a una política que el hotel no cargó.

              Ojo con la redacción: decía "usamos tus datos SOLO para gestionar esta reserva", y esa
              palabra era falsa — el sistema además segmenta al huésped y le calcula LTV (módulo
              `crm`), le manda campañas (`marketing`) y correos de recuperación si abandona el
              checkout (`abandon-recovery`). Una limitación de finalidad es una promesa concreta y
              exigible: prometer de menos no cuesta nada, prometer de más lo paga el hotel. Por lo
              mismo se nombra también a la plataforma: la base es multi-tenant y el cobro pasa por
              la pasarela, así que el hotel no es el único que toca estos datos.
            -->
            <p
              data-testid="privacy-note"
              class="rounded-xl bg-surface px-4 py-3 text-xs leading-relaxed text-text-secondary sm:col-span-2"
            >
              Usamos tu nombre, email y teléfono para gestionar esta reserva y contactarte por ella.
              Los datos los trata {{ hotel.name }} y la plataforma que opera sus reservas.
            </p>
          </form>
        </section>

        <!-- ─── Paso 5: pago ───────────────────────────────────────────────── -->
        <section v-else-if="step === 'pay'" class="space-y-4">
          <header>
            <h4 class="text-lg font-black text-navy">Revisá y confirmá</h4>
            <p class="mt-0.5 text-sm text-text-secondary">El cobro lo procesa Stripe. No guardamos los datos de tu tarjeta.</p>
          </header>

          <!--
            CONDICIONES — va PRIMERO en el paso, no al pie.
            El cuerpo del modal scrollea y el botón de pagar vive en el footer fijo: cualquier
            cosa puesta al final del paso queda debajo del fold (a 1280×720 el paso mide más que
            el alto visible) y el huésped puede pagar sin haberla visto nunca. Eso era lo que
            pasaba con la línea gris de "Cancelación". Arriba del todo es el único lugar donde se
            ve sin scrollear, y el monto que se cobra se repite acá para que la condición y la
            plata se lean juntas.

            Los impuestos NO se repiten: ya están en el desglose de abajo.
          -->
          <section
            data-testid="booking-terms"
            class="rounded-2xl border-2 p-4"
            :class="bookingTerms.tone === 'danger' ? 'border-danger/40 bg-danger/5' : 'border-navy/20 bg-white'"
          >
            <h5 class="text-[11px] font-black uppercase tracking-wide text-navy">Condiciones de la reserva</h5>

            <dl class="mt-3 space-y-3">
              <div>
                <dt class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Política de cancelación</dt>
                <dd
                  data-testid="cancellation-headline"
                  class="mt-0.5 text-sm font-bold"
                  :class="bookingTerms.tone === 'danger' ? 'text-danger' : 'text-navy'"
                >{{ bookingTerms.cancellationHeadline }}</dd>
                <dd
                  v-if="bookingTerms.cancellationDetail"
                  class="mt-0.5 text-xs leading-relaxed text-text-secondary"
                >{{ bookingTerms.cancellationDetail }}</dd>
              </div>

              <div>
                <dt class="text-[10px] font-bold uppercase tracking-wide text-text-muted">Qué se cobra ahora</dt>
                <dd class="mt-0.5 text-sm font-bold text-navy">
                  <span class="tabular-nums">{{ money(currentTotal) }}</span> · el total de la reserva, no una seña
                </dd>
                <dd class="mt-0.5 text-xs leading-relaxed text-text-secondary">{{ bookingTerms.refundDetail }}</dd>
              </div>
            </dl>

            <label class="mt-3 flex cursor-pointer items-start gap-3 rounded-xl bg-surface p-3">
              <input
                v-model="termsAccepted"
                data-testid="accept-terms"
                type="checkbox"
                class="mt-0.5 h-5 w-5 shrink-0 rounded border-border text-cyan focus:ring-cyan/30"
              />
              <span class="text-sm font-bold text-navy">
                Acepto las condiciones de reserva y la política de cancelación
              </span>
            </label>
          </section>

          <dl class="space-y-2 rounded-2xl border border-border bg-white p-4 text-sm">
            <div class="flex items-center justify-between gap-3">
              <dt class="text-text-muted">Fechas</dt>
              <dd class="font-bold text-navy">{{ staySummary }}</dd>
            </div>
            <div class="flex items-start justify-between gap-3">
              <dt class="text-text-muted">{{ store.cart.length === 1 ? 'Habitación' : 'Habitaciones' }}</dt>
              <dd class="text-right font-bold text-navy">
                <div v-for="line in store.cart" :key="line.key">{{ prettify(line.roomName) }} · para {{ line.occupancy }}{{ line.quantity > 1 ? ` × ${line.quantity}` : '' }}</div>
              </dd>
            </div>
            <div class="flex items-center justify-between gap-3">
              <dt class="text-text-muted">Huéspedes</dt>
              <dd class="font-bold text-navy">{{ occupancySummary }}</dd>
            </div>
            <div v-if="store.guest.name" class="flex items-center justify-between gap-3">
              <dt class="text-text-muted">A nombre de</dt>
              <dd class="truncate font-bold text-navy">{{ store.guest.name }}</dd>
            </div>
          </dl>

          <div class="space-y-2">
            <span class="block text-[10px] font-bold uppercase tracking-wide text-text-muted">¿Tenés un código de descuento?</span>
            <div class="flex gap-2">
              <input
                v-model="store.promoCode"
                type="text"
                autocomplete="off"
                aria-label="Código de descuento"
                placeholder="CODIGO"
                class="min-w-0 flex-1 rounded-xl border border-border bg-white px-4 py-3 text-sm uppercase text-navy focus:border-cyan focus:outline-none focus:ring-2 focus:ring-cyan/30"
                :disabled="store.promoLoading"
                @keyup.enter="applyPromo"
              />
              <button
                type="button"
                :disabled="!store.promoCode.trim() || store.promoLoading"
                class="shrink-0 cursor-pointer rounded-xl bg-navy px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-navy-light disabled:cursor-not-allowed disabled:opacity-50"
                @click="applyPromo"
              >Aplicar</button>
            </div>
            <p v-if="store.promoResult?.valid" class="text-sm font-bold text-teal">
              Descuento aplicado: −{{ money(store.promoDiscount) }}
            </p>
            <p v-else-if="store.promoResult" class="text-sm font-bold text-danger">
              {{ PROMO_REASON[store.promoResult.reason ?? 'not_found'] }}
            </p>
          </div>

          <div class="space-y-2 rounded-2xl bg-surface p-4 text-sm">
            <div class="flex justify-between">
              <span class="text-text-muted">Alojamiento ({{ store.nights }} {{ store.nights === 1 ? 'noche' : 'noches' }})</span>
              <span class="font-bold tabular-nums text-navy">{{ money(store.roomsSubtotal) }}</span>
            </div>
            <div v-if="store.upsellsTotal > 0" class="flex justify-between">
              <span class="text-text-muted">Extras</span>
              <span class="font-bold tabular-nums text-navy">{{ money(store.upsellsTotal) }}</span>
            </div>
            <div v-if="store.promoDiscount > 0" class="flex justify-between text-teal">
              <span>Descuento</span>
              <span class="font-bold tabular-nums">−{{ money(store.promoDiscount) }}</span>
            </div>
            <div v-if="store.estimatedTaxes > 0" class="flex justify-between">
              <span class="text-text-muted">Impuestos</span>
              <span class="font-bold tabular-nums text-navy">{{ money(store.estimatedTaxes) }}</span>
            </div>
            <div class="flex items-baseline justify-between border-t border-border pt-2">
              <span class="font-black text-navy">Total</span>
              <span class="text-xl font-black tabular-nums text-navy">{{ money(currentTotal) }}</span>
            </div>
          </div>

          <!-- La cancelación NO se repite acá: vive arriba, en el bloque de condiciones. -->
          <p v-if="store.error" class="rounded-xl bg-danger/5 px-4 py-3 text-sm font-bold text-danger" role="alert">
            {{ store.error }}
          </p>
        </section>

        <!-- ─── Confirmación ───────────────────────────────────────────────── -->
        <section v-else class="space-y-4 py-4 text-center">
          <span class="mx-auto grid h-14 w-14 place-items-center rounded-full bg-teal/10 text-teal [&_svg]:h-7 [&_svg]:w-7" v-html="ICON_CHECK" />
          <div>
            <h4 class="text-lg font-black text-navy">{{ confirmTitle }}</h4>
            <p class="mx-auto mt-1 max-w-md text-sm text-text-secondary">{{ confirmBody }}</p>
          </div>
          <p v-if="store.reservation" class="text-xs text-text-muted">
            Número de reserva
            <span class="font-mono font-bold text-navy">{{ store.reservation.reservationId.slice(0, 8) }}</span>
          </p>
        </section>
      </div>
    </div>

    <template #footer>
      <span v-if="footerTotal !== null" class="mr-auto text-sm">
        <span class="block text-[10px] font-bold uppercase tracking-wide text-text-muted">Total estimado</span>
        <span class="block text-lg font-black tabular-nums text-navy">{{ money(footerTotal) }}</span>
      </span>

      <!-- Por qué el botón está apagado. Sin esto el CTA gris no dice nada (mismo criterio que
           CancelReservationModal). Oculto en móvil: el footer a 375px ya lleva total + dos
           botones, y ahí el bloque de condiciones queda igual de visible al ser lo primero. -->
      <span
        v-if="step === 'pay' && !termsAccepted"
        data-testid="terms-required"
        class="hidden text-xs font-bold text-text-muted sm:block"
      >Aceptá las condiciones para poder pagar.</span>

      <button
        v-if="canGoBack"
        type="button"
        :disabled="store.isSubmitting"
        class="cursor-pointer px-4 py-2.5 text-sm font-bold text-text-secondary transition-colors hover:text-navy disabled:opacity-50"
        @click="store.back()"
      >Volver</button>

      <button
        v-if="step === 'done'"
        type="button"
        class="cursor-pointer rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-navy-light"
        @click="emit('close')"
      >Cerrar</button>

      <button
        v-else
        type="button"
        :disabled="!primaryEnabled"
        class="cursor-pointer rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-navy-light disabled:cursor-not-allowed disabled:opacity-50"
        @click="onPrimary"
      >
        <span v-if="primaryBusy" class="inline-flex items-center gap-2">
          <span class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
          Procesando…
        </span>
        <span v-else>{{ primaryLabel }}</span>
      </button>
    </template>
  </AppModal>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import AppModal from '@/components/ui/AppModal.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import RateCalendar from './RateCalendar.vue'
import Stepper from '@/components/booking/Stepper.vue'

import { useBookingStore } from '@/composables/useBooking'
import { PublicHotelService } from '@/services/PublicHotel.service'
import { formatMoney, formatShortDate, nightsBetween } from '@/utils/rate-calendar'
import { groupOccupancyRows } from '@/utils/occupancy-groups'
import type {
  MealPlanCode,
  OccupancyUnavailableReason,
  OpenBookingOptions,
  PromoValidationReason,
  PublicHotelInfo,
  RoomOccupancyRate,
  RoomTypeCatalogEntry,
  RoomTypeRate,
  UpsellKind,
} from '@/types'

const props = defineProps<{
  hotel: PublicHotelInfo
  /** Contexto de apertura (fechas/ocupación del hero, habitación de la card). */
  options?: OpenBookingOptions
  /**
   * CSS custom properties del tema del hotel (`hotel-landing.vue:themeCssVars`). El panel del
   * modal lo teletransporta `AppModal` a `<body>`, FUERA del `<main>` que declara esas variables
   * — sin pasarlas explícitamente el modal saldría con la paleta por defecto del panel SaaS y no
   * con la del hotel, que es justamente lo que se busca al no sacar al huésped de la landing.
   */
  themeVars?: Record<string, string>
}>()

const emit = defineEmits<{ close: [] }>()

const store = useBookingStore()

// ─── Pasos ────────────────────────────────────────────────────────────────────
type ModalStep = 'dates' | 'rooms' | 'extras' | 'guest' | 'pay' | 'done'

const STEPS: { key: ModalStep; label: string }[] = [
  { key: 'dates', label: 'Fechas' },
  { key: 'rooms', label: 'Habitación' },
  { key: 'extras', label: 'Extras' },
  { key: 'guest', label: 'Datos' },
  { key: 'pay', label: 'Pago' },
]

/**
 * El paso visible se deriva del status del store (fuente de verdad única, igual que el widget).
 * `reservation` no-null significa que el POST /public/booking ya salió bien: o el redirect a
 * Stripe está en curso, o el hotel no tiene pasarela y la reserva quedó pendiente. En ambos
 * casos lo honesto es mostrar la confirmación, no el botón de pagar otra vez.
 */
const step = computed<ModalStep>(() => {
  if (store.reservation) return 'done'
  switch (store.status) {
    case 'selecting': return 'rooms'
    case 'upselling': return 'extras'
    case 'checkingout': return 'guest'
    case 'paying':
    case 'failed': return 'pay'
    case 'confirmed': return 'done'
    default: return 'dates'
  }
})

const stepIndex = computed(() => {
  const i = STEPS.findIndex((s) => s.key === step.value)
  return i === -1 ? STEPS.length : i
})

const headerSubtitle = computed(() => {
  if (step.value === 'done') return 'Reserva registrada'
  return `Paso ${stepIndex.value + 1} de ${STEPS.length} · ${STEPS[stepIndex.value]?.label ?? ''}`
})

// ─── Bindings al store ────────────────────────────────────────────────────────
// El store ES el estado; los v-model escriben directo ahí para que volver atrás no pierda nada.
const checkIn = computed<string>({
  get: () => store.checkIn,
  set: (v) => { store.checkIn = v },
})
const checkOut = computed<string>({
  get: () => store.checkOut,
  set: (v) => { store.checkOut = v },
})
const currency = computed(() => store.displayCurrency || props.hotel.currency || 'USD')
function money(value: number): string {
  return formatMoney(value, currency.value)
}

const staySummary = computed(() => {
  if (!store.checkIn || !store.checkOut) return 'Elegí tus fechas'
  const n = nightsBetween(store.checkIn, store.checkOut)
  return `${formatShortDate(store.checkIn)} → ${formatShortDate(store.checkOut)} · ${n} ${n === 1 ? 'noche' : 'noches'}`
})

// Huéspedes YA NO se piden por adelantado (2026-08-20): se muestra la ocupación que
// EFECTIVAMENTE va a la reserva. Tarea 10 (combinar tipos/ocupaciones distintos en una misma
// reserva): la ocupación ya no es "una fila para N" sino la suma de todas las líneas del
// carrito, así que ya no alcanza `formatOccupancy({adults, rooms})` pensado para una sola línea.
const occupancySummary = computed(() => {
  const guests = store.cartTotalGuests
  const parts = [plural(Math.max(1, guests), 'huésped', 'huéspedes')]
  if (store.children > 0) parts.push(plural(store.children, 'niño', 'niños'))
  if (store.cartTotalRooms > 1) parts.push(plural(store.cartTotalRooms, 'habitación', 'habitaciones'))
  return parts.join(', ')
})

// ─── Paso fechas ──────────────────────────────────────────────────────────────
const datesError = ref('')
const calendarError = ref('')

function onCalendarValidity(payload: { ok: boolean; message: string }): void {
  calendarError.value = payload.ok ? '' : payload.message
  if (payload.ok && datesError.value === payload.message) datesError.value = ''
}

async function submitSearch(): Promise<void> {
  datesError.value = ''
  if (!store.checkIn || !store.checkOut) {
    datesError.value = 'Elegí las fechas de llegada y salida.'
    return
  }
  if (nightsBetween(store.checkIn, store.checkOut) < 1) {
    datesError.value = 'La salida debe ser posterior a la llegada.'
    return
  }
  if (calendarError.value) {
    datesError.value = calendarError.value
    return
  }
  await store.search()
}

// ─── Paso habitaciones ────────────────────────────────────────────────────────
const availableRooms = computed(() =>
  (store.ratesResponse?.roomTypes ?? []).filter((rt) => rt.availableCount > 0),
)

/**
 * Tipos que el hotel vende (catálogo, `GET /room-types` — mismo endpoint que la vitrina de la
 * landing, ver `solmi-direct-booking-qa-fixes`) pero que `/rates` NO devolvió para el rango
 * buscado: ningún unidad de ese tipo tiene disponibilidad continua esas fechas.
 *
 * Decisión de producto (2026-08-20): acá el huésped YA está buscando fechas concretas, así que
 * "no disponible" es información real y útil — se muestran DESHABILITADOS con el motivo en vez
 * de ocultarse (a diferencia de la búsqueda en sí, que sigue sin ofrecer algo no reservable).
 * Tolerante a fallos: si el catálogo no carga, esta lista queda vacía y el paso se comporta
 * exactamente como antes (solo `availableRooms`).
 */
const unavailableCatalogRooms = ref<RoomTypeCatalogEntry[]>([])

async function loadUnavailableCatalogRooms(): Promise<void> {
  if (!store.ratesResponse) { unavailableCatalogRooms.value = []; return }
  try {
    const catalog = await PublicHotelService.getRoomTypes(store.slug)
    const availableIds = new Set(availableRooms.value.map((r) => r.id))
    unavailableCatalogRooms.value = catalog.roomTypes.filter((t) => !availableIds.has(t.id))
  } catch {
    unavailableCatalogRooms.value = []
  }
}

/** roomType que la card de la landing pidió preseleccionar. Se aplica cuando llegan las tarifas. */
const pendingRoomTypeId = ref('')

function applyPendingRoom(): void {
  if (!pendingRoomTypeId.value) return
  const match = availableRooms.value.find((rt) => rt.id === pendingRoomTypeId.value)
  if (!match) return
  pendingRoomTypeId.value = ''
  // Sin ocupación declarada de antemano (2026-08-20, ya no se pide en el buscador), se intenta
  // agregar la fila "para 1" (el default de `store.physicalGuests`) si es vendible — el
  // huésped puede agregar/ajustar más filas a mano en la matriz de abajo (carrito, Tarea 10).
  // Si no existe o no es vendible, queda la tarjeta con `fromPrice` sin fila — nunca se agrega
  // algo no vendible.
  const row = match.occupancies?.find((o) => o.occupancy === store.physicalGuests && o.available)
  void store.addToCart(match, row?.occupancy)
}

watch(() => store.ratesResponse, () => { applyPendingRoom(); void loadUnavailableCatalogRooms() })

function prettify(name: string): string {
  if (!name) return 'Habitación'
  return name.charAt(0).toUpperCase() + name.slice(1)
}

function perNight(rt: RoomTypeRate): number {
  const n = store.nights > 0 ? store.nights : 1
  return rt.fromPrice / n
}

/** Compartido entre `RoomTypeRate` (disponibles) y `RoomTypeCatalogEntry` (deshabilitadas) —
 *  ambos exponen los mismos 2 campos. */
function roomSpecs(rt: { capacity: number; surfaceArea: number }): string {
  const parts: string[] = []
  if (rt.capacity > 0) parts.push(`${rt.capacity} ${rt.capacity === 1 ? 'huésped' : 'huéspedes'}`)
  if (rt.surfaceArea > 0) parts.push(`${rt.surfaceArea} m²`)
  return parts.join(' · ')
}

/** Urgencia con el dato real del PMS. Con más de 3 unidades NO se muestra nada (inventar
 *  escasez destruye la confianza y es la única moneda de la reserva directa). */
function urgency(count: number): string {
  if (count <= 0) return ''
  if (count <= 1) return 'Última disponible'
  if (count <= 3) return 'Pocas a este precio'
  return ''
}

/** Misma fórmula de key que `cartLineKey` en el store (no exportada) — mantenida en paralelo. */
function cartKey(rt: RoomTypeRate, occupancy: number): string {
  return `${rt.id}|${occupancy}`
}

/** Stepper del fallback (sin matriz): cada tarjeta representa ocupación=1 fija. */
async function onFallbackQtyChange(rt: RoomTypeRate, qty: number): Promise<void> {
  const current = cartQuantity(rt, 1)
  if (qty > current) await store.addToCart(rt)
  else if (qty < current) store.setCartLineQuantity(cartKey(rt, 1), qty)
}

// ─── Régimen de alimentación (tasks.md 2.2/2.4) ───────────────────────────────
type BoardPlanState = 'included' | 'upcoming' | 'unavailable'
interface BoardPlanRow { code: MealPlanCode; label: string; state: BoardPlanState; title: string }

/** Orden fijo — mismo criterio que el backend (`public-meal-plans.ts` CODE_ORDER). No usa el
 *  store de i18n (la landing no soporta locale) — mismas strings hardcodeadas que el resto del
 *  modal. */
const BOARD_PLAN_LABELS: Record<MealPlanCode, string> = {
  breakfast: 'Desayuno incluido',
  half_board: 'Desayuno y cena',
  all_inclusive: 'Todo incluido',
}
const BOARD_PLAN_ORDER: MealPlanCode[] = ['breakfast', 'half_board', 'all_inclusive']

/** Mapea el catálogo fijo contra `store.mealPlans` (solo trae los `active`): sin fila → el
 *  hotel no lo ofrece, se pinta deshabilitado con el motivo (nunca se oculta). */
const boardPlanRows = computed<BoardPlanRow[]>(() =>
  BOARD_PLAN_ORDER.map((code) => {
    const label = BOARD_PLAN_LABELS[code]
    const found = store.mealPlans.find((m) => m.code === code)
    if (!found) return { code, label, state: 'unavailable', title: 'Este hotel no ofrece este régimen' }
    if (found.priceMode === 'included') return { code, label, state: 'included', title: '' }
    return {
      code, label, state: 'upcoming',
      title: `Disponible como upgrade por ${money(found.price)} — todavía no se puede agregar al carrito`,
    }
  }),
)

/** Motivo → texto. Mapa explícito: un motivo nuevo en el backend rompe el typecheck acá en vez
 *  de mostrarle al huésped una fila muda o un código en inglés. */
const UNAVAILABLE_LABEL: Record<OccupancyUnavailableReason, string> = {
  no_rate: 'Sin tarifa para esta ocupación',
  no_availability: 'Sin disponibilidad en estas fechas',
  stop_sell: 'Cerrada a la venta',
  over_capacity: 'Supera la capacidad de la habitación',
}

/** Filas de ocupación del tipo, ascendentes. Vacío = backend sin matriz → fallback. */
function occupancyRows(rt: RoomTypeRate): RoomOccupancyRate[] {
  const rows = rt.occupancies
  if (!Array.isArray(rows) || rows.length === 0) return []
  return [...rows].sort((a, b) => a.occupancy - b.occupancy)
}

/** Filas (individual) o grupos (corrida de igual precio) para pintar sin repetir el número. */
function groupedOccupancyRows(rt: RoomTypeRate) {
  return groupOccupancyRows(occupancyRows(rt))
}

function unavailableLabel(reason: OccupancyUnavailableReason | null): string {
  // `available:false` sin motivo no debería pasar, pero una fila muda parece un bug de render.
  return reason ? UNAVAILABLE_LABEL[reason] : 'No disponible'
}

/** Cantidad ya agregada al carrito para (tipo, ocupación). 0 si no está. */
function cartQuantity(rt: RoomTypeRate, occupancy: number): number {
  return store.cart.find((l) => l.key === cartKey(rt, occupancy))?.quantity ?? 0
}

/** El tipo tiene AL MENOS una línea en el carrito (cualquier ocupación) — resalta la tarjeta. */
function cartHasType(roomTypeId: string): boolean {
  return store.cart.some((l) => l.roomType === roomTypeId)
}

/** Ícono de persona(s) de la fila (single/dos siluetas), sin emoji — mismo trazo que
 *  `OccupancySelector.vue` (buscador del hero) para consistencia visual en toda la landing. */
const ICON_USER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/></svg>'
const ICON_USERS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"/><path d="M16.5 5.2a3.5 3.5 0 0 1 0 6.6M18 13.9c2.1.8 3.5 2.8 3.5 5.1"/></svg>'
const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'

/** Stepper de una fila de ocupación: sube con `addToCart` (crea la línea si no existía),
 *  baja con `setCartLineQuantity` (existe porque solo baja desde una cantidad > 0). */
async function onQtyChange(rt: RoomTypeRate, row: RoomOccupancyRate, qty: number): Promise<void> {
  if (!row.available) return
  const current = cartQuantity(rt, row.occupancy)
  if (qty > current) await store.addToCart(rt, row.occupancy)
  else if (qty < current) store.setCartLineQuantity(cartKey(rt, row.occupancy), qty)
}

// ─── Paso extras ──────────────────────────────────────────────────────────────
const UPSELL_KIND_LABEL: Record<UpsellKind, string> = {
  per_room: 'Por habitación',
  per_person: 'Por persona',
  per_stay: 'Por estadía',
}

function isSelectedUpsell(id: string): boolean {
  return store.selectedUpsells.some((u) => u.id === id)
}

function upsellQty(id: string): number {
  return store.selectedUpsells.find((u) => u.id === id)?.quantity ?? 1
}

function toggleUpsell(id: string, checked: boolean): void {
  const rest = store.selectedUpsells.filter((u) => u.id !== id)
  if (!checked) {
    store.setSelectedUpsells(rest)
    return
  }
  const up = store.upsells.find((u) => u.id === id)
  // Cantidad por defecto según cómo se cobra: por habitación → habitaciones del carrito; por
  // persona → ocupación REAL de la reserva (los niños también desayunan). Tarea 10: el carrito
  // puede tener varias líneas (tipos/ocupaciones distintas), así que la ocupación total ya no es
  // una sola fila "para N" sino la suma de todas (`cartTotalGuests`) más los niños.
  const qty = up?.kind === 'per_room'
    ? store.cartTotalRooms
    : up?.kind === 'per_person'
      ? store.cartTotalGuests + store.children
      : 1
  store.setSelectedUpsells([...rest, { id, quantity: Math.max(1, qty) }])
}

function setUpsellQty(id: string, qty: number): void {
  const rest = store.selectedUpsells.filter((u) => u.id !== id)
  store.setSelectedUpsells([...rest, { id, quantity: Math.max(1, Math.min(20, qty)) }])
}

// ─── Paso datos ───────────────────────────────────────────────────────────────
const touched = ref(false)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const nameError = computed(() => (store.guest.name.trim().length < 2 ? 'Necesitamos tu nombre completo.' : ''))
const emailError = computed(() => (!EMAIL_RE.test(store.guest.email.trim()) ? 'Revisá el email: ahí te mandamos la confirmación.' : ''))
const phoneError = computed(() => (store.guest.phone.trim().length < 5 ? 'Dejanos un teléfono de contacto.' : ''))

// ─── Paso pago ────────────────────────────────────────────────────────────────
const PROMO_REASON: Record<PromoValidationReason, string> = {
  not_found: 'Ese código no existe.',
  inactive: 'Ese código ya no está activo.',
  expired: 'Ese código venció.',
  max_uses_reached: 'Ese código llegó a su límite de usos.',
  min_amount_not_met: 'Ese código pide un monto mínimo mayor.',
}

const currentTotal = computed(() => store.totalBreakdown?.total ?? store.estimatedTotal)

/**
 * Qué se puede afirmar hoy sobre la devolución del dinero.
 *
 * NO decimos "se te devuelve": la devolución automática NO existe. Cancelar calcula el monto y lo
 * guarda en la reserva (`bookingengine/usecases/public-cancel.ts`), y el único efecto posterior es
 * marcar registros de depósito — el reintegro real por Stripe solo lo dispara alguien del hotel a
 * mano (`payments/controller.ts`; ver el `TODO #627` en `connectors/bookingengine-deposits.ts`).
 * Prometer la devolución acá era peor que en cualquier otro lado del producto: es el único texto
 * que el huésped ACEPTA con una casilla, así que convierte una deuda técnica en un compromiso.
 * Cuando se cablee el reintegro automático, este es el texto que hay que volver a endurecer.
 */
const REFUND_IS_MANUAL = 'Si cancelás dentro de ese plazo no se te retiene nada; la devolución la gestiona el hotel.'

/** "1 día" / "7 días" — nunca "1 día(s)". Escribir el paréntesis es delegarle al huésped una
 *  concordancia que la máquina ya sabe hacer. */
function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** Ventana de cancelación gratuita en palabras. `hours` viene del backend en horas. */
function freeWindowPhrase(hours: number): string {
  // 0 (o negativo por dato raro) = la ventana llega hasta el propio check-in: "0 horas antes"
  // no es castellano y suena a que no hay ventana, que es lo contrario.
  if (hours <= 0) return 'hasta el momento del check-in'
  if (hours >= 24) return `hasta ${plural(Math.round(hours / 24), 'día', 'días')} antes del check-in`
  return `hasta ${plural(hours, 'hora', 'horas')} antes del check-in`
}

interface BookingTerms {
  /** 'danger' = la plata se pierde (no reembolsable / estricta / política desconocida). */
  tone: 'danger' | 'neutral'
  cancellationHeadline: string
  cancellationDetail: string
  refundDetail: string
}

/**
 * Condiciones que el huésped acepta antes de pagar. Se derivan SOLO de `store.cancellationSummary`
 * (lo que el backend calcula desde los tiers de la política real del hotel).
 *
 * ⚠️ NUNCA se cae a `store.cancellationPolicy`: es un texto libre que el admin escribe a mano en
 * /panel/booking-engine y que en producción dice "flexible" mientras la política real (la que el
 * backend aplica al cancelar y la que decide cuánta plata se devuelve) es estricta. Anunciar el
 * texto libre es prometer un reembolso que no va a existir. Sin `cancellationSummary` se dice que
 * no hay política publicada — no se rellena con genéricos ni se manda a "consultar los términos",
 * que es justo la página que no existe.
 *
 * Tampoco se inventa el destino de la plata: hoy Stripe cobra el TOTAL de la reserva (el backend
 * pasa `totalAmount` a `createReservationCheckout`), no una seña, y si eso se devuelve o no lo
 * decide la misma política de cancelación. Eso es lo que se dice, y de dónde sale.
 */
const bookingTerms = computed<BookingTerms>(() => {
  const summary = store.cancellationSummary

  if (!summary) {
    return {
      tone: 'danger',
      cancellationHeadline: 'Este hotel no publicó su política de cancelación.',
      cancellationDetail: 'No podemos mostrarte qué pasa si cancelás esta reserva.',
      refundDetail: 'Sin esa política tampoco podemos anticiparte si el cobro se devuelve.',
    }
  }

  const penalty = summary.penaltyDescription.trim()

  // Sin ningún tier gratuito el backend manda `freeUntilHours: null`: no hay ventana de
  // cancelación sin cargo en ningún momento. Se dice con esas palabras, sin suavizar.
  if (summary.freeUntilHours === null) {
    return {
      tone: 'danger',
      cancellationHeadline: 'Tarifa NO reembolsable.',
      cancellationDetail: penalty || 'Cancelar no da derecho a devolución.',
      refundDetail: 'Ese cobro no se devuelve si cancelás.',
    }
  }

  // Sin NINGÚN tier con penalidad la política es gratuita siempre. Hay que detectarlo por los
  // tiers y no por `freeUntilHours`: el backend usa un plazo centinela enorme para "sin límite"
  // (la política `default` manda `deadlineHours: 99999`) y traducirlo literal escupía
  // "cancelación sin cargo hasta 4167 días antes del check-in" — un número absurdo que además
  // suena a restricción donde no la hay. Verificado contra /rates de un hotel real.
  // `source: 'default'` NO es una política del hotel: es el fallback defensivo del backend cuando
  // no hay ninguna configurada (para no bloquear una cancelación legítima). Anunciarlo como
  // "cancelación gratuita" sería prometer en nombre del hotel algo que nunca eligió — el mismo
  // error que este bloque vino a corregir. `PoliciesBlock.vue` aplica este criterio en la landing;
  // acá pesa MÁS, porque además se firma con una casilla de aceptación.
  if (summary.source === 'default') {
    return {
      tone: 'danger',
      cancellationHeadline: 'Este hotel no publicó su política de cancelación.',
      cancellationDetail: 'No podemos mostrarte qué pasa si cancelás esta reserva.',
      refundDetail: 'Consultá con el hotel antes de pagar si necesitás poder cancelar.',
    }
  }

  if (!summary.tiers.some((t) => t.penaltyPercent > 0)) {
    return {
      tone: 'neutral',
      cancellationHeadline: 'Cancelación gratuita en cualquier momento.',
      cancellationDetail: '',
      refundDetail: REFUND_IS_MANUAL,
    }
  }

  const phrase = freeWindowPhrase(summary.freeUntilHours)
  // Estricta = pasada la ventana se pierde el importe entero. Se detecta SOLO por el porcentaje:
  // el preset `strict` del backend manda `{penaltyPercent: 100, refundable: true}` (ver
  // cancellation-math.ts), así que exigir `!refundable` dejaba fuera justamente al caso más común
  // y el hotel estricto veía el aviso en gris, con la buena noticia primero. `refundable` describe
  // si el depósito se puede devolver, no cuánto se retiene.
  const strict = summary.tiers.some((t) => t.penaltyPercent >= 100)

  if (strict) {
    const extra = penalty && penalty !== 'No reembolsable' ? ` ${penalty}` : ''
    return {
      tone: 'danger',
      cancellationHeadline: `Política estricta: cancelación sin cargo solo ${phrase}.`,
      cancellationDetail: `Pasado ese plazo la reserva no es reembolsable.${extra}`.trim(),
      refundDetail: `${REFUND_IS_MANUAL} Pasado el plazo, no se devuelve.`,
    }
  }

  return {
    tone: 'neutral',
    cancellationHeadline: `Cancelación sin cargo ${phrase}.`,
    cancellationDetail: penalty,
    refundDetail: `${REFUND_IS_MANUAL} Después aplica la penalidad indicada.`,
  }
})

/**
 * Aceptación explícita de las condiciones. Arranca en `false` SIEMPRE y se vuelve a pedir cada vez
 * que se entra al paso de pago: volver atrás para cambiar fechas o habitación puede traer otra
 * tarifa con otra política, y un tilde viejo sería una aceptación de condiciones que ya no son.
 */
const termsAccepted = ref(false)
watch(step, (s) => { if (s !== 'pay') termsAccepted.value = false })

async function applyPromo(): Promise<void> {
  if (!store.promoCode.trim()) return
  await store.applyPromo()
}

// ─── Confirmación ─────────────────────────────────────────────────────────────
const confirmTitle = computed(() =>
  store.reservation?.checkoutUrl ? 'Te llevamos al pago' : 'Tu reserva quedó registrada',
)
const confirmBody = computed(() => {
  if (store.reservation?.checkoutUrl) return 'Estamos abriendo la pasarela segura para completar el cobro.'
  return store.error || 'La reserva quedó tomada. Te contactamos para completar el pago.'
})

// ─── Footer / acción primaria ────────────────────────────────────────────────
const footerTotal = computed<number | null>(() => {
  if (step.value === 'dates' || step.value === 'done') return null
  if (store.cart.length === 0) return null
  return currentTotal.value
})

const canGoBack = computed(() => step.value === 'rooms' || step.value === 'extras' || step.value === 'guest' || step.value === 'pay')

const primaryBusy = computed(() => (step.value === 'dates' && store.ratesLoading) || store.isSubmitting)

const primaryLabel = computed(() => {
  switch (step.value) {
    case 'dates': return 'Ver disponibilidad'
    case 'rooms': return 'Continuar'
    case 'extras': return 'Continuar'
    case 'guest': return 'Ir al pago'
    case 'pay': return `Reservar y pagar ${money(currentTotal.value)}`
    default: return 'Cerrar'
  }
})

const primaryEnabled = computed(() => {
  if (primaryBusy.value) return false
  switch (step.value) {
    // Fechas: el botón queda HABILITADO aunque falten datos. Un CTA gris no dice qué falta;
    // `submitSearch` sí (fechas vacías, salida anterior a la llegada, estadía mínima del día).
    case 'dates': return true
    case 'rooms': return store.roomsValid
    case 'extras': return !store.upsellsLoading
    case 'guest': return store.guestValid
    // Sin el tilde no se paga. El footer dice por qué está apagado (`terms-required`).
    case 'pay': return store.cart.length > 0 && termsAccepted.value
    default: return true
  }
})

function goNext(): void {
  touched.value = true
  if (!primaryEnabled.value) return
  store.next()
}

async function onPrimary(): Promise<void> {
  switch (step.value) {
    case 'dates': await submitSearch(); return
    case 'pay':
      // El botón ya está bloqueado sin el tilde, pero el guard va IGUAL: un doble evento, un
      // atajo de teclado o un refactor que pierda el `:disabled` no pueden cobrarle a alguien
      // que nunca aceptó las condiciones. Mismo criterio que CancelReservationModal.confirm().
      if (!termsAccepted.value || store.cart.length === 0) return
      await store.pay()
      return
    default: goNext()
  }
}

function requestClose(): void {
  if (store.isSubmitting) return
  emit('close')
}

// Expuesto para que el guard de `onPrimary` se pueda ejercer sin el botón (el test lo llama
// directo, que es lo que haría un doble evento o un atajo que se saltee el `:disabled`).
defineExpose({ onPrimary })

// ─── Ciclo de vida ────────────────────────────────────────────────────────────
// El modal se monta al abrirse (v-if en la landing) → arranca siempre limpio y toma el contexto
// que le pasó el bloque de origen. Sin esto, reabrirlo después de un pago fallido mostraría el
// estado viejo.
onMounted(async () => {
  const opts = props.options ?? {}
  store.reset()
  store.init(props.hotel.slug, {
    checkIn: opts.checkIn,
    checkOut: opts.checkOut,
    guests: opts.adults,
    children: opts.children,
    rooms: opts.rooms,
  })
  pendingRoomTypeId.value = opts.roomTypeId ?? ''

  await nextTick()
  attachPanel()

  // El huésped ya apretó "Ver disponibilidad" en el hero: repetir ese click acá es un paso muerto.
  if (opts.skipToRooms && store.searchValid) {
    await store.search()
    applyPendingRoom()
  }
})

onBeforeUnmount(() => {
  detachPanel()
  // El store es global (lo comparte el widget). Al cerrar el modal se limpia salvo que haya una
  // reserva creada en curso (el redirect a Stripe podría estar navegando).
  if (!store.isSubmitting && !store.reservation) store.reset()
})

// ─── Foco atrapado ────────────────────────────────────────────────────────────
// AppModal aporta Escape + bloqueo de scroll, pero no trampa de foco. Se engancha sobre el panel
// real (`.app-modal-panel`) para incluir el header y el footer del propio AppModal, no solo el
// contenido de este componente.
const contentEl = ref<HTMLElement | null>(null)
let panelEl: HTMLElement | null = null

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusables(): HTMLElement[] {
  if (!panelEl) return []
  return Array.from(panelEl.querySelectorAll<HTMLElement>(FOCUSABLE))
}

function onTrapKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Tab' || !panelEl) return
  const list = focusables()
  if (list.length === 0) return
  const first = list[0]!
  const last = list[list.length - 1]!
  const active = document.activeElement as HTMLElement | null
  if (!active || !panelEl.contains(active)) {
    e.preventDefault()
    first.focus()
    return
  }
  if (e.shiftKey && active === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
  }
}

/** Engancha la trampa de foco Y pinta el tema del hotel sobre el panel teletransportado. */
function attachPanel(): void {
  panelEl = contentEl.value?.closest<HTMLElement>('.app-modal-panel') ?? null
  if (!panelEl) return
  for (const [name, value] of Object.entries(props.themeVars ?? {})) {
    if (name.startsWith('--') && value) panelEl.style.setProperty(name, value)
  }
  panelEl.addEventListener('keydown', onTrapKeydown)
  focusables()[0]?.focus()
}

function detachPanel(): void {
  panelEl?.removeEventListener('keydown', onTrapKeydown)
  panelEl = null
}

const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>'
</script>

<style scoped>
/* Sin CSS propio: el look sale de las utilities de Tailwind sobre los tokens del tema, que se
   aplican al panel teletransportado en `attachPanel()` (ver prop `themeVars`). */
</style>
