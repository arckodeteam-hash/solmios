<template>
  <div>
    <!-- Header -->
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <div>
        <div class="flex flex-wrap items-center gap-2.5">
          <h2 class="text-xl font-black text-navy">Facturación</h2>
          <span class="inline-flex items-center gap-1.5 rounded-full bg-[#DCFCE7] px-2.5 py-1 text-[10px] font-extrabold uppercase text-[#16A34A]">
            <span class="relative flex h-1.5 w-1.5">
              <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22C55E] opacity-60"></span>
              <span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#22C55E]"></span>
            </span>
            En vivo
          </span>
        </div>
        <p class="text-sm text-text-muted mt-0.5">Pagos, facturación electrónica LATAM y folios</p>
      </div>
      <div class="flex gap-2">
        <button @click="exportCsv" class="flex items-center gap-1.5 px-4 py-2 border border-border rounded-xl text-sm font-bold text-text-secondary hover:border-navy/30 transition-colors cursor-pointer">
          <span class="w-4 h-4 shrink-0" v-html="ICON_DOWNLOAD"></span>
          Exportar CSV
        </button>
        <button v-if="canCreateInvoice" @click="openNewInvoice" class="flex items-center gap-1.5 bg-cyan text-navy font-extrabold text-sm px-5 py-2.5 rounded-xl hover:shadow-lg transition-all cursor-pointer">
          <span class="w-4 h-4 shrink-0" v-html="ICON_PLUS"></span>
          Nueva Factura
        </button>
      </div>
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
      <KpiHeroCard label="Ingresos del Mes" :value="totalMonth" icon="money" accent="blue"
        prefix="$" :unit="formatSecondary(totalMonth) || 'Facturado este mes'" />
      <KpiHeroCard label="Cobrado Hoy" :value="totalToday" icon="checkin" accent="teal"
        prefix="$" :unit="formatSecondary(totalToday) || 'Ingresado hoy'" />
      <KpiHeroCard label="Pendiente" :value="totalPending" icon="checkout" accent="amber"
        prefix="$" :unit="formatSecondary(totalPending) || 'Por cobrar + vencido'"
        :progress="collectedShare" />
      <KpiHeroCard label="Facturas Emitidas" :value="totalInvoices" icon="bookings" accent="purple"
        unit="Documentos del período" />
    </div>

    <!-- Tabs -->
    <div class="flex gap-2 mb-6">
      <button
        v-for="tab in tabs"
        :key="tab.value"
        @click="activeTab = tab.value"
        class="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold transition-all cursor-pointer"
        :class="activeTab === tab.value ? 'bg-navy text-white' : 'bg-white text-text-secondary border border-border hover:border-navy/30'"
      >
        <span class="w-4 h-4 shrink-0" v-html="tab.icon"></span>
        {{ tab.label }}
      </button>
    </div>

    <!-- Loading -->
    <SectionCard v-if="loading" title="Facturas" body-class="p-0">
      <SkeletonLoader variant="table" :rows="8" />
    </SectionCard>

    <!-- Invoices Tab -->
    <SectionCard v-if="activeTab === 'invoices' && !loading"
      title="Facturas" :subtitle="`${totalItems} documento(s)`" body-class="p-0">
      <template #actions>
        <select id="billing-invoice-filter" name="invoiceFilter" aria-label="Filtrar facturas por estado" v-model="invoiceFilter" @change="applyInvoiceFilter"
          class="px-3 py-2 rounded-lg border border-white/15 bg-white/10 text-sm font-semibold text-white focus:outline-none focus:border-cyan cursor-pointer">
          <option class="text-navy" value="all">Todas</option>
          <option class="text-navy" value="paid">Pagadas</option>
          <option class="text-navy" value="pending">Pendientes</option>
          <option class="text-navy" value="overdue">Vencidas</option>
          <option class="text-navy" value="cancelled">Anuladas</option>
        </select>
      </template>

      <EmptyState v-if="invoices.length === 0"
        :icon="ICON_DOCUMENT"
        :title="invoiceFilter !== 'all' ? 'Sin facturas con este filtro' : 'Todavía no hay facturas'"
        :message="invoiceFilter !== 'all' ? 'Probá con otro estado o mirá todas.' : 'Emití la primera factura o cerrá un folio para generarla.'">
        <template #action>
          <button v-if="invoiceFilter !== 'all'" @click="invoiceFilter = 'all'; applyInvoiceFilter()"
            class="rounded-full border border-border px-5 py-2.5 text-sm font-bold text-navy hover:bg-surface transition-colors cursor-pointer">Ver todas</button>
          <button v-else-if="canCreateInvoice" @click="openNewInvoice"
            class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">Nueva factura</button>
        </template>
      </EmptyState>

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[880px] tbl-head">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-[10px]">Factura</th>
              <th class="text-left px-4 py-3 text-[10px]">Huésped</th>
              <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Concepto</th>
              <th class="text-left px-4 py-3 text-[10px]">Estado</th>
              <th class="text-left px-4 py-3 text-[10px] hidden xl:table-cell">Fecha</th>
              <th class="text-right px-4 py-3 text-[10px]">Total</th>
              <th class="text-right px-4 py-3 text-[10px]">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="inv in invoices"
              :key="inv.id"
              data-testid="invoice-row"
              :data-invoice-id="inv.id"
              @click="openViewInvoice(inv)"
              class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors cursor-pointer"
            >
              <td class="px-4 py-3">
                <div class="text-sm font-black text-navy">#{{ inv.number }}</div>
                <div v-if="inv.room" class="text-[11px] text-text-muted">Hab {{ inv.room }}</div>
              </td>
              <td class="px-4 py-3">
                <!-- Una factura puede no tener huésped (cargo suelto): la celda lo dice
                     en vez de quedar muda. -->
                <div class="max-w-[180px] truncate text-sm font-bold" :class="inv.guest ? 'text-navy' : 'text-text-muted'">
                  {{ inv.guest || 'Sin huésped' }}
                </div>
                <div class="max-w-[180px] truncate text-[11px] text-text-muted lg:hidden">{{ inv.concept }}</div>
              </td>
              <td class="px-4 py-3 text-sm text-text-secondary hidden lg:table-cell">
                <span class="block truncate max-w-[240px]">{{ inv.concept }}</span>
              </td>
              <td class="px-4 py-3">
                <span class="rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase" :class="invoiceStatusClass(inv.status)">
                  {{ invoiceStatusLabel(inv.status) }}
                </span>
              </td>
              <td class="px-4 py-3 text-sm text-text-secondary hidden xl:table-cell">{{ inv.date }}</td>
              <td class="px-4 py-3 text-right">
                <div class="text-sm font-extrabold text-navy tabular-nums">${{ inv.total.toLocaleString() }}</div>
                <!-- Saldo: lo que todavía falta cobrar de esta factura. -->
                <div v-if="inv.balance > 0" class="text-[11px] font-bold text-gold tabular-nums">
                  Saldo ${{ inv.balance.toLocaleString() }}
                </div>
              </td>
              <td class="px-4 py-3 text-right">
                <div class="flex items-center justify-end gap-1.5">
                  <button @click.stop="openViewInvoice(inv)" title="Ver factura"
                    class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_EYE"></span>
                  </button>
                  <button v-if="inv.balance > 0 && inv.status !== 'cancelled'" data-testid="invoice-pay-btn" @click.stop="openRecordPayment(inv)" title="Registrar cobro"
                    class="grid h-8 w-8 place-items-center rounded-lg text-teal hover:bg-teal/10 transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_CASH"></span>
                  </button>
                  <!-- Una factura con efectos contables se anula, no se borra. -->
                  <button v-if="inv.deletable" @click.stop="openDeleteModal(inv)" title="Eliminar"
                    class="grid h-8 w-8 place-items-center rounded-lg text-coral hover:bg-coral/10 transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_TRASH"></span>
                  </button>
                  <button v-else-if="inv.status !== 'cancelled'" data-testid="invoice-credit-note-btn" @click.stop="openCreditNoteModal(inv)" title="Anular con nota de crédito"
                    class="grid h-8 w-8 place-items-center rounded-lg text-gold hover:bg-gold/10 transition-colors cursor-pointer">
                    <span class="h-4 w-4" v-html="ICON_BAN"></span>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div v-if="totalPages > 1" class="flex items-center justify-between border-t border-border px-4 py-3">
        <span class="text-[11px] font-bold text-text-muted">{{ rangeLabel }}</span>
        <div class="flex items-center gap-1">
          <button @click="page = 1; loadData()" :disabled="page <= 1" class="px-2 py-1 rounded-lg text-xs font-bold text-navy hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">«</button>
          <button @click="page--; loadData()" :disabled="page <= 1" class="px-2 py-1 rounded-lg text-xs font-bold text-navy hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">‹</button>
          <span class="px-2 text-xs font-bold text-navy">{{ page }} / {{ totalPages }}</span>
          <button @click="page++; loadData()" :disabled="page >= totalPages" class="px-2 py-1 rounded-lg text-xs font-bold text-navy hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">›</button>
          <button @click="page = totalPages; loadData()" :disabled="page >= totalPages" class="px-2 py-1 rounded-lg text-xs font-bold text-navy hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">»</button>
        </div>
      </div>
    </SectionCard>

    <!-- Payments Tab -->
    <SectionCard v-if="activeTab === 'payments' && !loading"
      title="Pagos recientes" subtitle="Cobros asentados en caja y pasarela" body-class="p-0">
      <EmptyState v-if="payments.length === 0" :icon="ICON_CARD"
        title="Todavía no hay pagos"
        message="Los cobros aparecen acá apenas se registran contra una factura o folio." />

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[720px] tbl-head">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-[10px]">Huésped</th>
              <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Concepto</th>
              <th class="text-left px-4 py-3 text-[10px]">Método</th>
              <th class="text-left px-4 py-3 text-[10px]">Estado</th>
              <th class="text-left px-4 py-3 text-[10px] hidden xl:table-cell">Fecha</th>
              <th class="text-right px-4 py-3 text-[10px]">Monto</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="payment in payments" :key="payment.id" class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
              <td class="px-4 py-3">
                <div class="text-sm font-bold text-navy truncate max-w-[200px]">{{ payment.guest }}</div>
                <div class="text-[11px] text-text-muted lg:hidden truncate max-w-[200px]">{{ payment.concept }}</div>
              </td>
              <td class="px-4 py-3 text-sm text-text-secondary hidden lg:table-cell">
                <span class="block truncate max-w-[240px]">{{ payment.concept }}</span>
              </td>
              <td class="px-4 py-3">
                <span class="rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase" :class="methodClass(payment.method)">
                  {{ methodLabel(payment.method) }}
                </span>
              </td>
              <td class="px-4 py-3">
                <span class="rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase" :class="paymentStatusClass(payment.status)">
                  {{ paymentStatusLabel(payment.status) }}
                </span>
              </td>
              <td class="px-4 py-3 text-sm text-text-secondary hidden xl:table-cell">{{ payment.date }}</td>
              <td class="px-4 py-3 text-right text-sm font-extrabold text-navy tabular-nums">${{ payment.amount }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>

    <!-- Folios Tab -->
    <SectionCard v-if="activeTab === 'folios' && !loading"
      title="Folios de habitación" subtitle="Cargos abiertos por habitación" body-class="p-0">
      <EmptyState v-if="folios.length === 0" :icon="ICON_DOCUMENT"
        title="No hay folios abiertos"
        message="El folio se abre solo al hacer el check-in de una reserva." />

      <ul v-else class="divide-y divide-border">
        <li v-for="folio in folios" :key="folio.id" :data-folio-id="folio.id" class="flex flex-wrap items-center gap-4 px-4 py-4 transition-colors hover:bg-surface/60">
          <!-- Habitación como ancla visual de la fila -->
          <div class="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-xs font-black"
            :class="folio.status === 'open' ? 'bg-cyan/10 text-cyan' : 'bg-surface text-text-muted'">
            {{ folio.roomNumber || '—' }}
          </div>

          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="truncate text-sm font-bold text-navy">{{ folio.guestName || 'Huésped' }}</span>
              <span class="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase"
                :class="folio.status === 'open' ? 'bg-cyan/10 text-cyan' : 'bg-teal/10 text-teal'">
                {{ folio.status === 'open' ? 'Abierto' : 'Cerrado' }}
              </span>
              <span v-if="folio.status === 'closed' && folio.invoiceId" class="shrink-0 text-[10px] font-bold text-teal">✓ Facturado</span>
            </div>
            <div class="mt-0.5 text-[11px] text-text-muted">
              <template v-if="folio.chargeCount">{{ folio.chargeCount }} cargo(s)</template>
              <template v-else>Sin cargos</template>
            </div>
          </div>

          <div class="shrink-0 text-right">
            <div class="text-base font-black text-navy tabular-nums">${{ (folio.chargesTotal || 0).toLocaleString() }}</div>
            <div class="text-[11px] font-bold tabular-nums" :class="(folio.balance || 0) > 0 ? 'text-gold' : 'text-teal'">
              Saldo ${{ (folio.balance || 0).toLocaleString() }}
            </div>
          </div>

          <div v-if="folio.status === 'open'" class="flex shrink-0 items-center gap-1.5">
            <button @click="openAddCharge(folio)" title="Agregar cargo"
              class="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:bg-navy/10 hover:text-navy transition-colors cursor-pointer">
              <span class="h-4 w-4" v-html="ICON_PLUS"></span>
            </button>
            <button @click="openRecordPaymentForFolio(folio)" title="Registrar pago"
              class="grid h-8 w-8 place-items-center rounded-lg text-teal hover:bg-teal/10 transition-colors cursor-pointer">
              <span class="h-4 w-4" v-html="ICON_CASH"></span>
            </button>
            <button @click="openCloseFolioModal(folio)" data-testid="folio-close-invoice-btn"
              class="rounded-full bg-navy px-4 py-2 text-[11px] font-extrabold text-white hover:bg-navy-light transition-colors cursor-pointer">
              Cerrar y facturar
            </button>
          </div>
        </li>
      </ul>
    </SectionCard>

    <!-- View Invoice Modal -->
    <AppModal v-if="showViewModal && viewInvoice" size="lg" body-class="p-0" @close="closeViewModal">
      <template #header>
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <h3 class="text-lg font-black text-white">{{ typeLabel(viewInvoice.type) }} #{{ viewInvoice.number }}</h3>
            <span class="rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase" :class="invoiceStatusClass(viewInvoice.status)">
              {{ invoiceStatusLabel(viewInvoice.status) }}
            </span>
          </div>
          <p class="mt-0.5 text-[11px] text-white/60">
            Emitida {{ viewInvoice.date }}<template v-if="viewInvoice.dueDate"> · Vence {{ viewInvoice.dueDate }}</template>
            <template v-if="viewInvoice.ncf"> · NCF {{ viewInvoice.ncf }}</template>
          </p>
          <p v-if="viewInvoice.ncf && !viewInvoice.fiscalSent" class="mt-1 text-[10px] font-bold text-gold">
            ⚠ Pendiente de envío a la autoridad fiscal
          </p>
        </div>
      </template>

      <!-- Cabecera de datos -->
      <div class="grid grid-cols-3 gap-px border-b border-border bg-border">
        <div v-for="d in invoiceHeaderFields" :key="d.label" class="bg-white px-4 py-3">
          <div class="text-[10px] font-semibold uppercase tracking-wide text-text-muted">{{ d.label }}</div>
          <div class="mt-0.5 truncate text-sm font-bold text-navy">{{ d.value }}</div>
        </div>
      </div>

      <div class="p-5">
        <!-- Conceptos -->
        <section class="overflow-hidden rounded-2xl border border-border">
          <header class="flex items-center gap-2 border-b border-border bg-surface px-4 py-2.5">
            <span class="grid h-6 w-6 place-items-center rounded-lg bg-navy/10 text-navy">
              <span class="h-3.5 w-3.5" v-html="ICON_DOCUMENT"></span>
            </span>
            <h4 class="text-[11px] font-black uppercase tracking-wide text-navy">Conceptos facturados</h4>
          </header>
          <ul class="divide-y divide-border">
            <li v-for="(item, idx) in viewInvoice.items" :key="idx" class="flex items-center justify-between gap-3 px-4 py-2.5">
              <span class="min-w-0 truncate text-sm text-text-secondary">{{ item.description }}</span>
              <span class="shrink-0 text-sm font-bold text-navy tabular-nums">{{ currencySymbol(viewInvoice.currency) }}{{ Number(item.amount).toFixed(2) }}</span>
            </li>
          </ul>
        </section>

        <!-- Resumen financiero: el total es lo que se busca de un vistazo -->
        <section class="mt-4 overflow-hidden rounded-2xl border-2 border-navy">
          <div class="space-y-2 px-4 py-3">
            <div class="flex justify-between text-sm">
              <span class="text-text-secondary">Subtotal</span>
              <span class="font-bold text-navy tabular-nums">{{ currencySymbol(viewInvoice.currency) }}{{ viewInvoice.subtotal.toFixed(2) }}</span>
            </div>
            <div class="flex justify-between text-sm">
              <span class="text-text-secondary">Impuestos ({{ viewInvoice.taxRate }}%)</span>
              <span class="font-bold text-navy tabular-nums">{{ currencySymbol(viewInvoice.currency) }}{{ viewInvoice.tax.toFixed(2) }}</span>
            </div>
          </div>
          <div class="flex items-center justify-between bg-navy px-4 py-3">
            <span class="text-[11px] font-black uppercase tracking-wide text-white/70">Total</span>
            <span class="text-xl font-black text-white tabular-nums">{{ currencySymbol(viewInvoice.currency) }}{{ viewInvoice.total.toFixed(2) }}</span>
          </div>
          <div v-if="viewInvoice.amountPaid > 0" class="space-y-2 px-4 py-3">
            <div class="flex justify-between text-sm">
              <span class="font-bold text-teal">Pagado</span>
              <span class="font-bold text-teal tabular-nums">−{{ currencySymbol(viewInvoice.currency) }}{{ viewInvoice.amountPaid.toFixed(2) }}</span>
            </div>
            <div class="flex justify-between text-sm">
              <span class="font-black text-gold">Saldo pendiente</span>
              <span class="font-black text-gold tabular-nums">{{ currencySymbol(viewInvoice.currency) }}{{ viewInvoice.balance.toFixed(2) }}</span>
            </div>
          </div>
        </section>

        <!-- Método de pago -->
        <div v-if="viewInvoice.method" class="mt-4 flex items-center gap-3 rounded-2xl border border-border px-4 py-3">
          <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-teal/10 text-teal">
            <span class="h-4 w-4" v-html="paymentMethodIcon(viewInvoice.method)"></span>
          </span>
          <div>
            <div class="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Método de pago</div>
            <div class="text-sm font-bold text-navy">{{ paymentMethodLabel(viewInvoice.method) }}</div>
          </div>
        </div>

        <!-- Notas -->
        <section v-if="viewInvoice.notes" class="mt-4 overflow-hidden rounded-2xl border border-gold/30 bg-gold/5">
          <header class="border-b border-gold/20 px-4 py-2.5 text-[11px] font-black uppercase tracking-wide text-gold">Notas</header>
          <p class="whitespace-pre-wrap px-4 py-3 text-sm text-text-secondary">{{ viewInvoice.notes }}</p>
        </section>
      </div>

      <template #footer>
        <button @click="printInvoice" title="Imprimir"
          class="mr-auto inline-flex items-center gap-1.5 px-3 py-2 text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">
          <span class="h-4 w-4" v-html="ICON_PRINT"></span> Imprimir
        </button>
        <button @click="openEmailModal" class="px-3 py-2 text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Email</button>
        <button @click="downloadPdf" class="px-3 py-2 text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">PDF</button>
        <button v-if="viewInvoice.status === 'pending' || viewInvoice.balance > 0"
          @click="closeViewModal(); openRecordPayment(viewInvoice)"
          class="inline-flex items-center gap-2 rounded-full bg-teal px-5 py-2.5 text-sm font-extrabold text-white hover:bg-teal-light transition-colors cursor-pointer">
          <span class="h-4 w-4" v-html="ICON_CASH"></span> Registrar pago
        </button>
      </template>
    </AppModal>

    <!-- New Payment Modal -->
    <AppModal v-if="showPaymentModal" size="md" title="Registrar pago"
      :subtitle="paymentForm.guest || undefined" @close="closePaymentModal">
      <div class="space-y-4">
        <div>
          <label for="billing-pay-amount" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Monto ($) <span class="text-coral">*</span></label>
          <input id="billing-pay-amount" name="payAmount" required aria-required="true" v-model.number="paymentForm.amount" data-testid="pay-amount-input" type="number" min="0"
            class="w-full rounded-xl border border-border px-4 py-2.5 text-lg font-black text-navy tabular-nums focus:border-navy focus:outline-none" />
        </div>

        <div>
          <label class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Método de pago</label>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="method in paymentMethods"
              :key="method.value"
              :data-testid="'pay-method-' + method.value"
              @click="paymentForm.method = method.value"
              class="flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[11px] font-bold transition-all cursor-pointer"
              :class="paymentForm.method === method.value ? 'border-navy bg-navy text-white' : 'border-border text-text-secondary hover:border-navy/30'"
            >
              <span class="h-3.5 w-3.5 shrink-0" v-html="method.icon"></span>
              {{ method.label }}
            </button>
          </div>
        </div>

        <div>
          <label for="billing-pay-reference" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Referencia</label>
          <input id="billing-pay-reference" name="payReference" v-model="paymentForm.reference" type="text" placeholder="N° transacción, comprobante, etc."
            class="w-full rounded-xl border border-border px-4 py-2.5 text-sm focus:border-navy focus:outline-none" />
        </div>

        <div>
          <label for="billing-pay-notes" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Notas</label>
          <textarea id="billing-pay-notes" name="payNotes" v-model="paymentForm.notes" rows="2" placeholder="Opcional..."
            class="w-full resize-none rounded-xl border border-border px-4 py-2.5 text-sm focus:border-navy focus:outline-none"></textarea>
        </div>
      </div>

      <template #footer>
        <button @click="closePaymentModal" class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cancelar</button>
        <button @click="savePayment" data-testid="pay-confirm-btn" :disabled="savingPayment"
          class="inline-flex items-center gap-2 rounded-full bg-teal px-5 py-2.5 text-sm font-extrabold text-white hover:bg-teal-light transition-colors cursor-pointer disabled:opacity-50">
          <span class="h-4 w-4" v-html="ICON_CASH"></span>
          {{ savingPayment ? 'Guardando…' : 'Confirmar pago' }}
        </button>
      </template>
    </AppModal>

    <!-- Add Charge Modal -->
    <AppModal v-if="showChargeModal" size="md" title="Agregar cargo"
      :subtitle="`Habitación ${chargeRoom}`" @close="closeChargeModal">
      <div class="space-y-4">
        <div>
          <label for="billing-charge-description" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Concepto</label>
          <select id="billing-charge-description" name="chargeDescription" v-model="chargeForm.description" class="w-full cursor-pointer rounded-xl border border-border px-4 py-2.5 text-sm focus:border-navy focus:outline-none">
            <option value="">Seleccionar…</option>
            <option value="Minibar">Minibar</option>
            <option value="Servicio de habitación">Servicio de habitación</option>
            <option value="Lavandería">Lavandería</option>
            <option value="Spa">Spa</option>
            <option value="Restaurante">Restaurante</option>
            <option value="Telefonía">Telefonía</option>
            <option value="Otro">Otro</option>
          </select>
        </div>

        <div>
          <label for="billing-charge-amount" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Monto ($) <span class="text-coral">*</span></label>
          <input id="billing-charge-amount" name="chargeAmount" required aria-required="true" v-model.number="chargeForm.amount" type="number" min="0"
            class="w-full rounded-xl border border-border px-4 py-2.5 text-lg font-black text-navy tabular-nums focus:border-navy focus:outline-none" />
        </div>

        <div>
          <label for="billing-charge-notes" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Notas</label>
          <textarea id="billing-charge-notes" name="chargeNotes" v-model="chargeForm.notes" rows="2" placeholder="Detalle del cargo…"
            class="w-full resize-none rounded-xl border border-border px-4 py-2.5 text-sm focus:border-navy focus:outline-none"></textarea>
        </div>
      </div>

      <template #footer>
        <button @click="closeChargeModal" class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cancelar</button>
        <button @click="saveCharge" :disabled="savingCharge"
          class="rounded-full bg-navy px-5 py-2.5 text-sm font-extrabold text-white hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50">
          {{ savingCharge ? 'Agregando…' : 'Agregar cargo' }}
        </button>
      </template>
    </AppModal>

    <!-- New Invoice Modal -->
    <AppModal v-if="showNewInvoiceModal" size="lg" title="Nueva factura"
      subtitle="Buscá la habitación y cargá los conceptos" @close="closeNewInvoiceModal">
      <div class="space-y-4">
              <!-- Room Search -->
              <div>
                <label for="invoice-room-search" class="flex items-center gap-1.5 text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">
                  <span class="w-3.5 h-3.5 shrink-0" v-html="ICON_SEARCH"></span>
                  Buscar Habitación
                </label>
                <div class="relative">
                  <input id="invoice-room-search" name="roomSearch" v-model="newInvoice.roomSearch" @input="filterRooms" @focus="showRoomDropdown = true" @blur="closeRoomDropdown" type="text" placeholder="Escribí número de hab, nombre del huésped..." class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy" />
                  <div v-if="showRoomDropdown && filteredRooms.length" class="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-border rounded-xl shadow-lg max-h-56 overflow-y-auto">
                    <div v-for="room in filteredRooms" :key="room.id" @mousedown.prevent="selectRoom(room)" class="px-4 py-3 hover:bg-surface cursor-pointer border-b border-border last:border-0">
                      <div class="flex justify-between items-center">
                        <div>
                          <span class="text-sm font-bold text-navy">Hab {{ room.number }}</span>
                          <span class="text-[10px] text-text-muted ml-1.5 px-1.5 py-0.5 bg-surface rounded">{{ room.type }}</span>
                        </div>
                        <div class="text-right">
                          <div v-if="room.guestName" class="text-xs font-bold text-teal">{{ room.guestName }}</div>
                          <div v-else class="text-[10px] text-text-muted">Sin huésped</div>
                          <div class="text-[10px] text-text-muted">${{ room.basePrice }}/noche</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Guest (auto-filled) -->
              <div v-if="newInvoice.guestName" class="flex items-center gap-3 py-3 border-b border-border">
                <span class="w-5 h-5 text-teal shrink-0" v-html="ICON_USER"></span>
                <div>
                  <div class="text-[10px] text-text-muted uppercase tracking-wide">Huésped</div>
                  <div class="text-sm font-bold text-navy mt-0.5">{{ newInvoice.guestName }}</div>
                </div>
              </div>

              <!-- Line Items -->
              <div>
                <div class="flex items-center justify-between mb-2">
                  <label class="text-[11px] font-bold text-text-muted uppercase tracking-wide">Conceptos</label>
                  <button @click="addInvoiceItem" class="text-[10px] font-bold text-cyan hover:text-navy transition-colors cursor-pointer">+ Agregar</button>
                </div>
                <div class="space-y-2">
                  <div v-for="(item, idx) in newInvoice.items" :key="idx" class="flex gap-2 items-start">
                    <select :id="`invoice-item-${idx}-description`" :name="`itemDescription${idx}`" :aria-label="`Concepto del ítem ${idx + 1}`" v-model="item.description" class="flex-1 px-3 py-2 rounded-xl border border-border text-sm focus:outline-none focus:border-navy cursor-pointer">
                      <option value="">Concepto...</option>
                      <option value="Hospedaje">Hospedaje</option>
                      <option value="Minibar">Minibar</option>
                      <option value="Restaurante">Restaurante</option>
                      <option value="Spa">Spa</option>
                      <option value="Lavandería">Lavandería</option>
                      <option value="Servicio de habitación">Serv. habitación</option>
                      <option value="Telefonía">Telefonía</option>
                      <option value="Otros">Otros</option>
                    </select>
                    <input :id="`invoice-item-${idx}-amount`" :name="`itemAmount${idx}`" :aria-label="`Monto del ítem ${idx + 1}`" v-model.number="item.amount" type="number" min="0" step="0.01" placeholder="Monto" class="w-24 px-3 py-2 rounded-xl border border-border text-sm text-right focus:outline-none focus:border-navy" />
                    <button v-if="newInvoice.items.length > 1" @click="removeInvoiceItem(idx)" class="w-8 h-8 rounded-full bg-coral/10 text-coral flex items-center justify-center hover:bg-coral/20 transition-colors cursor-pointer">
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                </div>
              </div>

              <!-- Notes -->
              <div>
                <label for="invoice-notes" class="block text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2">Notas</label>
                <textarea id="invoice-notes" name="notes" v-model="newInvoice.notes" rows="2" placeholder="Detalle adicional..." class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy resize-none"></textarea>
              </div>

        <!-- Total en vivo: lo que se va a emitir -->
        <section class="overflow-hidden rounded-2xl border-2 border-navy">
          <div class="space-y-1.5 px-4 py-3">
            <div class="flex justify-between text-sm">
              <span class="text-text-secondary">Subtotal</span>
              <span class="font-bold text-navy tabular-nums">${{ invoiceSubtotal.toFixed(2) }}</span>
            </div>
            <div v-if="hotelTaxRate > 0" class="flex justify-between text-sm">
              <span class="text-text-secondary">Impuestos ({{ hotelTaxRate }}%)</span>
              <span class="font-bold text-navy tabular-nums">${{ invoiceTaxes.toFixed(2) }}</span>
            </div>
          </div>
          <div class="flex items-center justify-between bg-navy px-4 py-3">
            <span class="text-[11px] font-black uppercase tracking-wide text-white/70">Total</span>
            <span class="text-xl font-black text-white tabular-nums">${{ invoiceTotal.toFixed(2) }}</span>
          </div>
        </section>
      </div>

      <template #footer>
        <button @click="closeNewInvoiceModal" class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cancelar</button>
        <button @click="saveNewInvoice" :disabled="savingInvoice || invoiceTotal <= 0"
          class="rounded-full bg-navy px-5 py-2.5 text-sm font-extrabold text-white hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50">
          {{ savingInvoice ? 'Creando…' : 'Crear factura' }}
        </button>
      </template>
    </AppModal>

    <!-- Delete Confirmation Modal -->
    <AppModal v-if="showDeleteModal && deleteTarget" size="sm" title="Eliminar factura" @close="closeDeleteModal">
      <div class="text-center">
        <div class="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-coral/10">
          <span class="h-6 w-6 text-coral" v-html="ICON_ALERT_TRIANGLE"></span>
        </div>
        <p class="text-sm text-text-secondary">
          ¿Eliminar la factura <strong class="text-navy">#{{ deleteTarget.number }}</strong>?
        </p>
        <p class="mt-1 text-xs text-text-muted">Esta acción no se puede deshacer.</p>
      </div>
      <template #footer>
        <button @click="closeDeleteModal" class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cancelar</button>
        <button @click="confirmDelete" :disabled="deleting"
          class="inline-flex items-center gap-2 rounded-full bg-coral px-5 py-2.5 text-sm font-extrabold text-white hover:opacity-90 transition-colors cursor-pointer disabled:opacity-50">
          <span class="h-4 w-4" v-html="ICON_TRASH"></span>
          {{ deleting ? 'Eliminando…' : 'Eliminar' }}
        </button>
      </template>
    </AppModal>

    <!-- Close Folio + Invoice Modal -->
    <AppModal v-if="showCloseFolioModal && closeFolioTarget" size="sm" title="Cerrar y facturar" @close="closeCloseFolioModal">
      <div class="text-center">
        <div class="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-cyan/10">
          <span class="h-6 w-6 text-cyan" v-html="ICON_DOCUMENT"></span>
        </div>
        <p class="text-sm text-text-secondary">
          Se cierra el folio de <strong class="text-navy">{{ closeFolioTarget.guestName || 'huésped' }}</strong> y se emite la factura.
        </p>
        <div class="mx-auto mt-3 w-fit rounded-xl bg-surface px-5 py-2.5">
          <div class="text-2xl font-black text-navy tabular-nums">${{ (closeFolioTarget.chargesTotal || 0).toLocaleString() }}</div>
          <div class="text-[10px] font-bold uppercase tracking-wide text-text-muted">A facturar</div>
        </div>
        <p class="mt-3 text-xs text-text-muted">El folio no admite más cargos después de cerrarse.</p>
      </div>
      <template #footer>
        <button @click="closeCloseFolioModal" class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cancelar</button>
        <button @click="confirmCloseAndInvoice" data-testid="folio-close-confirm-btn" :disabled="closingFolio"
          class="rounded-full bg-navy px-5 py-2.5 text-sm font-extrabold text-white hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50">
          {{ closingFolio ? 'Facturando…' : 'Cerrar y facturar' }}
        </button>
      </template>
    </AppModal>

    <!-- Credit Note Modal -->
    <AppModal v-if="showCreditNoteModal && creditNoteTarget" size="md"
      :title="`Anular factura #${creditNoteTarget.number}`" subtitle="Se emite una nota de crédito" @close="closeCreditNoteModal">
      <div class="space-y-4">
        <div class="flex gap-3 rounded-2xl border border-gold/30 bg-gold/5 px-4 py-3">
          <span class="mt-0.5 h-5 w-5 shrink-0 text-gold" v-html="ICON_ALERT_TRIANGLE"></span>
          <p class="text-sm text-text-secondary">
            Esta factura ya tiene efectos contables, así que no se elimina: se emite una
            <strong class="text-navy">nota de crédito</strong> por
            <strong class="text-navy tabular-nums">${{ creditNoteTarget.total.toLocaleString() }}</strong>
            que la anula dejando el rastro.
          </p>
        </div>
        <div>
          <label for="credit-note-reason" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Motivo de la anulación <span class="text-coral">*</span></label>
          <textarea id="credit-note-reason" name="creditNoteReason" required aria-required="true" v-model="creditNoteReason" data-testid="credit-note-reason-input" rows="3" placeholder="Ej: error en el monto facturado, servicio no prestado…"
            class="w-full resize-none rounded-xl border border-border px-4 py-2.5 text-sm focus:border-navy focus:outline-none"></textarea>
        </div>
      </div>
      <template #footer>
        <button @click="closeCreditNoteModal" class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cancelar</button>
        <button @click="confirmCreditNote" data-testid="credit-note-confirm-btn" :disabled="issuingCreditNote"
          class="rounded-full bg-gold px-5 py-2.5 text-sm font-extrabold text-white hover:opacity-90 transition-colors cursor-pointer disabled:opacity-50">
          {{ issuingCreditNote ? 'Emitiendo…' : 'Emitir nota de crédito' }}
        </button>
      </template>
    </AppModal>

    <!-- Enviar factura por email -->
    <AppModal v-if="showEmailModal && emailTarget" size="md"
      :title="`Enviar factura #${emailTarget.number}`" @close="closeEmailModal">
      <form class="space-y-4" @submit.prevent="confirmEmail">
        <div>
          <label for="email-to" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Email del destinatario</label>
          <input
            id="email-to"
            v-model.trim="emailTo"
            type="email"
            autocomplete="email"
            placeholder="huesped@ejemplo.com"
            class="w-full rounded-xl border px-4 py-2.5 text-sm transition-colors focus:outline-none"
            :class="emailError ? 'border-red-400 focus:border-red-500' : 'border-border focus:border-navy'"
            @input="emailError = ''"
          />
          <p v-if="emailError" class="mt-2 text-xs font-bold text-red-500">{{ emailError }}</p>
        </div>
      </form>
      <template #footer>
        <button @click="closeEmailModal" class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cancelar</button>
        <button @click="confirmEmail" :disabled="sendingEmail || !emailTo"
          class="rounded-full bg-teal px-5 py-2.5 text-sm font-extrabold text-white hover:bg-teal-light transition-colors cursor-pointer disabled:opacity-50">
          {{ sendingEmail ? 'Enviando…' : 'Enviar' }}
        </button>
      </template>
    </AppModal>

    <!-- Invoice Print Frame (oculto) -->
    <iframe ref="printFrame" class="hidden" style="position:absolute;width:0;height:0;border:0;"></iframe>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { BillingService, isDeletable, type BillingStats, type Invoice, type InvoiceStatus } from '@/services/Billing.service'
import { RoomService } from '@/services/Room.service'
import { GuestService } from '@/services/Guest.service'
import { useCurrency } from '@/composables/useCurrency'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import SkeletonLoader from '@/components/ui/SkeletonLoader.vue'
import AppModal from '@/components/ui/AppModal.vue'
import { FoliosService, type Folio } from '@/services/Folios.service'
import { useAuthStore } from '@/stores/auth.store'
import { useToast } from '@/composables/useToast'
import { usePermissions } from '@/composables/usePermissions'

const auth = useAuthStore()
const toast = useToast()
const { can } = usePermissions()
// Gatea las acciones de escritura: un rol sin `billing:create` ve las facturas pero no puede
// emitirlas (el backend igual responde 403; esto evita ofrecer un botón que va a fallar).
const canCreateInvoice = computed(() => can('billing', 'create'))
const hotelId = computed(() => (auth.user?.hotelId && auth.user.hotelId !== 'platform' ? auth.user.hotelId : undefined))
const { formatSecondary, loadCurrencyConfig } = useCurrency()

/** Cuántos pagos recientes trae el tab "Pagos" (no está paginado). */
const PAYMENTS_PAGE_SIZE = 20

const activeTab = ref('invoices')
const invoiceFilter = ref<InvoiceStatus | 'all'>('all')
const showViewModal = ref(false)
const showPaymentModal = ref(false)
const showChargeModal = ref(false)
const viewInvoice = ref<any>(null)
const chargeRoom = ref('')

const ICON_DOCUMENT = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m1 5H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l4.414 4.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2Z"/></svg>'
const ICON_CARD = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="5" width="20" height="14" rx="2"/><path stroke-linecap="round" d="M2 10h20"/></svg>'
const ICON_BUILDING = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1m4 0h1m-6 4h1m4 0h1m-6 4h1m4 0h1"/></svg>'
const ICON_WALLET = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M16 12h.01M3 10h18"/></svg>'
const ICON_CHECK_PLAIN = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>'
const ICON_CLOCK = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>'
const ICON_PLUS = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>'
const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 12m0 0l4.5-4.5M12 12V3"/></svg>'
const ICON_SEARCH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>'
const ICON_USER = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M16 21v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/></svg>'
const ICON_ALERT_TRIANGLE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a1 1 0 0 0 .86 1.5h18.64a1 1 0 0 0 .86-1.5L13.71 3.86a1 1 0 0 0-1.72 0Z"/></svg>'
const ICON_CASH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path stroke-linecap="round" d="M6 9v.01M18 15v.01"/></svg>'
const ICON_BANK = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M3 10 12 3l9 7M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9M9 20v-6h6v6"/></svg>'
const ICON_PRINT = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M6 9V3h12v6M6 18H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-1M6 14h12v7H6v-7Z"/></svg>'
const ICON_EYE ='<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M2.04 12.32a1 1 0 0 1 0-.64C3.42 7.51 7.36 4.5 12 4.5c4.64 0 8.57 3.01 9.96 7.18a1 1 0 0 1 0 .64C20.58 16.49 16.64 19.5 12 19.5c-4.64 0-8.57-3.01-9.96-7.18Z"/><circle cx="12" cy="12" r="3"/></svg>'
const ICON_TRASH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></svg>'
const ICON_BAN = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path stroke-linecap="round" d="m5.6 5.6 12.8 12.8"/></svg>'
const ICON_LINK ='<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 10.5 21 3M16.5 3H21v4.5M10.5 13.5 3 21M7.5 21H3v-4.5"/></svg>'

const tabs = [
  { value: 'invoices', label: 'Facturas', icon: ICON_DOCUMENT },
  { value: 'payments', label: 'Pagos', icon: ICON_CARD },
  { value: 'folios', label: 'Folios', icon: ICON_BUILDING },
]

const paymentMethods = [
  { value: 'card', label: 'Tarjeta', icon: ICON_CARD },
  { value: 'cash', label: 'Efectivo', icon: ICON_CASH },
  { value: 'transfer', label: 'Transferencia', icon: ICON_BANK },
  { value: 'link', label: 'Link de pago', icon: ICON_LINK },
]

const paymentForm = ref({ guest: '', amount: 0, method: 'card', reference: '', notes: '' })
const chargeForm = ref({ description: '', amount: 0, notes: '' })

const invoices = ref<any[]>([])
const payments = ref<any[]>([])
const folios = ref<Folio[]>([])
const stats = ref<BillingStats>({ total: 0, pendingAmount: 0, paid: 0, overdueAmount: 0, cancelled: 0, monthlyRevenue: 0, todayRevenue: 0, totalTax: 0 })
const loading = ref(true)
const page = ref(1)
const totalPages = ref(1)
const totalItems = ref(0)
const showDeleteModal = ref(false)
const deleteTarget = ref<any>(null)
const deleting = ref(false)
const savingPayment = ref(false)
const savingCharge = ref(false)
const paymentTargetId = ref<string | null>(null)
const paymentTargetKind = ref<'invoice' | 'folio'>('invoice')
const chargeFolioId = ref<string | null>(null)

// Cerrar folio + facturar
const showCloseFolioModal = ref(false)
const closeFolioTarget = ref<Folio | null>(null)
const closingFolio = ref(false)

// Nota de crédito — la vía para anular una factura ya emitida
const showCreditNoteModal = ref(false)
const creditNoteTarget = ref<any>(null)
const creditNoteReason = ref('')
const issuingCreditNote = ref(false)

// Envío de factura por email
const showEmailModal = ref(false)
const emailTarget = ref<Invoice | null>(null)
const emailTo = ref('')
const emailError = ref('')
const sendingEmail = ref(false)

// New Invoice state
const showNewInvoiceModal = ref(false)
const savingInvoice = ref(false)
const rooms = ref<any[]>([])
const hotelTaxRate = ref(0)
const newInvoice = ref({ roomSearch: '', roomId: '', guestId: '', guestName: '', items: [{ description: '', amount: 0 }], notes: '' })
const showRoomDropdown = ref(false)
const filteredRooms = ref<any[]>([])

const invoiceSubtotal = computed(() => newInvoice.value.items.reduce((sum, i) => sum + (Number(i.amount) || 0), 0))
const invoiceTaxes = computed(() => Math.round(invoiceSubtotal.value * hotelTaxRate.value / 100 * 100) / 100)
const invoiceTotal = computed(() => Math.round((invoiceSubtotal.value + invoiceTaxes.value) * 100) / 100)

const conceptFor = (inv: any) => {
  if (Array.isArray(inv.items) && inv.items.length && inv.items[0]?.description) return inv.items[0].description
  return ({ invoice: 'Factura', payment: 'Pago', folio: 'Cargo / Folio' } as Record<string, string>)[inv.type] || inv.type
}

/** Vista de fila a partir del DTO del backend. */
function toRow(d: Invoice) {
  return {
    id: d.id,
    number: d.number,
    guest: d.guest || '',
    room: d.room || '',
    concept: conceptFor(d),
    status: d.status,
    type: d.type,
    date: d.issueDate || '',
    dueDate: d.dueDate || '',
    subtotal: d.subtotal,
    taxRate: d.taxRate,
    tax: d.tax,
    total: d.total,
    amountPaid: d.amountPaid || 0,
    balance: d.balance ?? d.total,
    currency: d.currency || 'USD',
    ncf: d.ncf,
    fiscalSent: d.fiscalSent ?? false,
    fiscalMessage: d.fiscalMessage || '',
    items: (Array.isArray(d.items) && d.items.length) ? d.items : [{ description: conceptFor(d), amount: d.total }],
    method: d.paymentMethod || '',
    notes: d.notes || '',
    deletable: isDeletable(d),
  }
}

/** Concepto legible del pago: descripción real, si no la referencia, si no el método. */
function paymentConcept(p: { description: string; reference: string; method: string }): string {
  return p.description || p.reference || methodLabel(p.method)
}

/**
 * Facturas y pagos: las facturas viven en `invoices` (`type=invoice`); los pagos ahora vienen del
 * módulo `payments` (`GET /api/payments`, fuente de verdad del dinero) con método, referencia y
 * estado REALES — NO los comprobantes `type:'payment'` de `invoices` (modelo viejo). El nombre del
 * huésped no lo trae `/payments` (solo `guestId`): se resuelve contra `/huespedes`.
 */
async function loadData() {
  loading.value = true
  try {
    const [invoiceRes, paymentRes, statsData, guestRes] = await Promise.all([
      BillingService.list({
        hotelId: hotelId.value,
        type: 'invoice',
        status: invoiceFilter.value === 'all' ? undefined : invoiceFilter.value,
        page: page.value,
      }),
      BillingService.listPayments({ hotelId: hotelId.value, limit: PAYMENTS_PAGE_SIZE }).catch(() => null),
      BillingService.stats().catch(() => null),
      GuestService.list({ hotelId: hotelId.value }).catch(() => null),
    ])
    if (statsData) stats.value = statsData
    totalPages.value = invoiceRes.pages
    totalItems.value = invoiceRes.total
    invoices.value = invoiceRes.invoices.map(toRow)
    const guestName = new Map((guestRes?.guests ?? []).map(g => [g.id, g.name]))
    payments.value = (paymentRes?.payments ?? []).map(p => ({
      id: p.id,
      guest: (p.guestId && guestName.get(p.guestId)) || '—',
      concept: paymentConcept(p),
      method: p.method,
      status: p.status,
      date: (p.createdAt || '').slice(0, 10),
      amount: p.amount,
    }))
    await loadFolios()
  } catch { toast.error("Error al cargar datos") }
  finally { loading.value = false }
}

/** El filtro de estado se resuelve en el servidor: hay que volver a la página 1. */
function applyInvoiceFilter() {
  page.value = 1
  loadData()
}

async function loadFolios() {
  try {
    folios.value = await FoliosService.list(hotelId.value)
  } catch { folios.value = []; toast.error('No se pudieron cargar los folios') }
}
onMounted(async () => {
  await loadCurrencyConfig(hotelId.value)
  loadData()
})

const totalMonth = computed(() => stats.value.monthlyRevenue)
const totalToday = computed(() => stats.value.todayRevenue)
const totalPending = computed(() => stats.value.pendingAmount + stats.value.overdueAmount)
const totalInvoices = computed(() => stats.value.total)

// Los KPI los anima KpiHeroCard internamente (useCountUp propio).

// Cabecera de datos del modal de factura. Se declara como datos para que el
// template solo itere, igual que la ficha del huésped.
const invoiceHeaderFields = computed(() => {
  const inv = viewInvoice.value
  if (!inv) return []
  return [
    { label: 'Huésped', value: inv.guest || '—' },
    { label: 'Habitación', value: inv.room || '—' },
    { label: 'Moneda', value: `${currencySymbol(inv.currency)} ${inv.currency}` },
  ]
})

// Porción ya cobrada del total facturado — alimenta el anillo del KPI "Pendiente".
const collectedShare = computed(() => {
  const billed = totalMonth.value + totalPending.value
  return billed > 0 ? Math.round((totalMonth.value / billed) * 100) : 0
})

// Rango de la página actual. El tamaño de página lo decide el backend, así que se
// deriva de total/pages en vez de hardcodear una constante que puede desincronizarse.
const rangeLabel = computed(() => {
  if (!totalItems.value) return '0 documentos'
  const size = Math.ceil(totalItems.value / Math.max(1, totalPages.value))
  const from = (page.value - 1) * size + 1
  const to = Math.min(page.value * size, totalItems.value)
  return `${from}–${to} de ${totalItems.value}`
})

function methodClass(method: string) {
  const m = String(method).toLowerCase()
  const classes: Record<string, string> = {
    'tarjeta': 'bg-blue-100 text-blue-700', 'card': 'bg-blue-100 text-blue-700',
    'transferencia': 'bg-teal/10 text-teal', 'transfer': 'bg-teal/10 text-teal',
    'efectivo': 'bg-gold/10 text-gold', 'cash': 'bg-gold/10 text-gold',
    'link de pago': 'bg-purple/10 text-purple', 'link': 'bg-purple/10 text-purple',
    'deposit': 'bg-navy/10 text-navy', 'other': 'bg-gray-100 text-gray-500',
  }
  return classes[m] ?? 'bg-gray-100 text-gray-500'
}

/** Etiqueta ES del método real del pago (`payments.method` viene en inglés). */
function methodLabel(method: string) {
  const labels: Record<string, string> = {
    card: 'Tarjeta', cash: 'Efectivo', transfer: 'Transferencia',
    link: 'Link de pago', deposit: 'Depósito', other: 'Otro',
  }
  return labels[String(method).toLowerCase()] ?? method
}

/** Estado real del ciclo de vida del pago (NO el de una factura). */
function paymentStatusLabel(status: string) {
  const labels: Record<string, string> = {
    completed: 'Cobrado', pending: 'Pendiente', processing: 'Procesando',
    failed: 'Fallido', refunded: 'Reembolsado',
  }
  return labels[String(status).toLowerCase()] ?? status
}

function paymentStatusClass(status: string) {
  const classes: Record<string, string> = {
    completed: 'bg-teal/10 text-teal',
    pending: 'bg-gold/10 text-gold',
    processing: 'bg-blue-100 text-blue-700',
    failed: 'bg-coral/10 text-coral',
    refunded: 'bg-gray-100 text-gray-500',
  }
  return classes[String(status).toLowerCase()] ?? 'bg-gray-100 text-gray-500'
}

function invoiceStatusClass(status: string) {
  const classes: Record<string, string> = {
    paid: 'bg-teal/10 text-teal',
    pending: 'bg-gold/10 text-gold',
    overdue: 'bg-coral/10 text-coral',
    cancelled: 'bg-gray-100 text-gray-500',
    draft: 'bg-navy/10 text-navy',
  }
  return classes[status] ?? 'bg-gray-100 text-gray-500'
}

function invoiceStatusLabel(status: string) {
  const labels: Record<string, string> = { paid: 'Pagada', pending: 'Pendiente', overdue: 'Vencida', cancelled: 'Anulada', draft: 'Borrador' }
  return labels[status] ?? status
}

function typeLabel(type: string) {
  // BM-4.2: payment/folio/receipt eran tipos muertos — mapInvoice() ya los reduce a 'invoice'
  // antes de llegar acá, así que nunca alcanzan estas labels.
  const labels: Record<string, string> = { invoice: 'Factura', credit_note: 'Nota de Crédito' }
  return labels[type] ?? type
}

function paymentMethodIcon(method: string) {
  const m = String(method).toLowerCase()
  const icons: Record<string, string> = { tarjeta: ICON_CARD, card: ICON_CARD, efectivo: ICON_CASH, cash: ICON_CASH, transferencia: ICON_BANK, transfer: ICON_BANK, link: ICON_LINK }
  return icons[m] ?? ICON_WALLET
}

function paymentMethodLabel(method: string) {
  const m = String(method).toLowerCase()
  const labels: Record<string, string> = { tarjeta: 'Tarjeta', card: 'Tarjeta', efectivo: 'Efectivo', cash: 'Efectivo', transferencia: 'Transferencia', transfer: 'Transferencia', link: 'Link de pago' }
  return labels[m] ?? method
}

function currencySymbol(currency: string) {
  const symbols: Record<string, string> = { USD: '$', DOP: 'RD$', EUR: '€', COP: '$', MXN: '$', ARS: '$', CLP: '$' }
  return symbols[currency] ?? currency
}

function openViewInvoice(inv: any) {
  viewInvoice.value = { ...inv }
  showViewModal.value = true
}

function closeViewModal() {
  showViewModal.value = false
  viewInvoice.value = null
}

const printFrame = ref<HTMLIFrameElement | null>(null)

async function printInvoice() {
  if (!viewInvoice.value) return
  try {
    const html = await BillingService.print(viewInvoice.value.id)
    if (typeof html === 'string' && html.includes('<!DOCTYPE html>') && printFrame.value) {
      const doc = printFrame.value.contentDocument
      if (doc) {
        doc.open()
        doc.write(html)
        doc.close()
        setTimeout(() => printFrame.value?.contentWindow?.print(), 300)
      }
    }
  } catch { toast.error('Error al generar impresión') }
}

// Un `prompt()` no valida nada y no distingue "cancelé" de "escribí cualquier cosa": el email salía
// al backend sin chequear formato. El modal valida antes de gastar el request.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function openEmailModal() {
  if (!viewInvoice.value) return
  emailTarget.value = viewInvoice.value
  emailTo.value = ''
  emailError.value = ''
  showEmailModal.value = true
}

function closeEmailModal() {
  showEmailModal.value = false
  emailTarget.value = null
  emailTo.value = ''
  emailError.value = ''
}

async function confirmEmail() {
  if (!emailTarget.value || sendingEmail.value) return
  const to = emailTo.value.trim()
  if (!to) { emailError.value = 'Ingresá un email'; return }
  if (!EMAIL_RE.test(to)) { emailError.value = 'El email no tiene un formato válido'; return }

  sendingEmail.value = true
  emailError.value = ''
  try {
    const res = await BillingService.emailInvoice(emailTarget.value.id, to)
    if (!res.configured) {
      toast.warning('El hotel no tiene email configurado (SMTP/Resend). Configurarlo en Settings.')
      closeEmailModal()
      return
    }
    toast.success(`Factura enviada a ${to}`)
    closeEmailModal()
  } catch {
    emailError.value = 'No se pudo enviar la factura. Intentá de nuevo.'
  } finally {
    sendingEmail.value = false
  }
}

async function downloadPdf() {
  if (!viewInvoice.value) return
  try {
    const blob = await BillingService.downloadPdf(viewInvoice.value.id)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${viewInvoice.value.number}.pdf`
    a.click()
    URL.revokeObjectURL(url)
  } catch { toast.error('Error al generar el PDF') }
}

async function openNewInvoice() {
  newInvoice.value = { roomSearch: '', roomId: '', guestId: '', guestName: '', items: [{ description: '', amount: 0 }], notes: '' }
  showNewInvoiceModal.value = true
  showRoomDropdown.value = false
  // Load rooms + tax rate in parallel
  const [roomsRes, rate] = await Promise.all([
    RoomService.list().catch(() => null),
    BillingService.taxRate().catch(() => 0),
  ])
  // Rooms — solo habitaciones con huésped (guestId o guestName)
  const roomList = roomsRes?.rooms || []
  rooms.value = (Array.isArray(roomList) ? roomList : [])
    .filter((r: any) => r.guestId || r.guestName)
    .map((r: any) => ({
      id: r.id, number: r.number, type: r.type, status: r.status,
      basePrice: r.basePrice, guestId: r.guestId || null,
      guestName: r.guestName || '', reservationId: r.reservationId || null,
    }))
  filteredRooms.value = rooms.value
  // La tasa la calcula el backend con la misma función que emite la factura (GET /facturas/tax-rate).
  // Recalcularla acá sobre la config creaba una segunda fuente de verdad: el preview podía mostrar
  // un total distinto del que terminaba facturado.
  hotelTaxRate.value = rate
}

function filterRooms() {
  const q = newInvoice.value.roomSearch.toLowerCase()
  filteredRooms.value = rooms.value.filter(r =>
    r.number.toLowerCase().includes(q) || r.guestName.toLowerCase().includes(q) || r.type.toLowerCase().includes(q)
  )
}

function selectRoom(room: any) {
  newInvoice.value.roomId = room.id
  newInvoice.value.roomSearch = `Hab ${room.number} — ${room.guestName || 'Sin huésped'}`
  newInvoice.value.guestId = room.guestId || ''
  newInvoice.value.guestName = room.guestName || 'Cliente general'
  showRoomDropdown.value = false
}

function closeRoomDropdown() {
  setTimeout(() => { showRoomDropdown.value = false }, 200)
}

function addInvoiceItem() {
  newInvoice.value.items.push({ description: '', amount: 0 })
}

function removeInvoiceItem(idx: number) {
  newInvoice.value.items.splice(idx, 1)
}

function closeNewInvoiceModal() {
  showNewInvoiceModal.value = false
}

async function saveNewInvoice() {
  const validItems = newInvoice.value.items.filter(i => i.description && i.amount > 0)
  if (!validItems.length) { toast.warning('Agregá al menos un concepto con monto'); return }
  savingInvoice.value = true
  try {
    // Items estructurados → se persisten en invoice_items (desglose real en template/PDF).
    // notes queda como texto libre (huésped/hab) para el listado y search.
    const guestTag = newInvoice.value.guestName ? `Huésped: ${newInvoice.value.guestName}` : ''
    const roomTag = newInvoice.value.roomId ? `${guestTag ? ' · ' : ''}Hab: ${newInvoice.value.roomSearch.split('—')[0].trim()}` : ''
    await BillingService.create({
      hotelId: hotelId.value,
      guestId: newInvoice.value.guestId || null,
      reservationId: null,
      type: 'invoice',
      amount: invoiceSubtotal.value,
      items: validItems.map(i => ({ description: i.description, amount: Number(i.amount) })),
      notes: `${guestTag}${roomTag}`.trim() || newInvoice.value.notes || null,
    })
    closeNewInvoiceModal()
    loadData()
    toast.success('Factura creada')
  } catch { toast.error('Error al crear la factura') }
  finally { savingInvoice.value = false }
}

function openRecordPayment(inv: any) {
  paymentTargetKind.value = 'invoice'
  paymentTargetId.value = inv.id
  // El saldo, no el total: una factura con pago parcial ya tiene plata aplicada.
  const outstanding = Math.max(0, inv.balance ?? inv.total)
  paymentForm.value = { guest: inv.guest, amount: outstanding, method: 'card', reference: '', notes: '' }
  showPaymentModal.value = true
}

function openRecordPaymentForFolio(folio: any) {
  paymentTargetKind.value = 'folio'
  paymentTargetId.value = folio.id ?? null
  paymentForm.value = { guest: folio.guestName || 'Huésped', amount: Math.max(0, folio.balance || 0), method: 'card', reference: '', notes: '' }
  showPaymentModal.value = true
}

function closePaymentModal() {
  showPaymentModal.value = false
}

async function savePayment() {
  if (!paymentForm.value.guest || paymentForm.value.amount <= 0) { toast.warning('Datos incompletos'); return }
  if (!paymentTargetId.value) { toast.warning('Seleccioná una factura o folio para registrar el pago'); return }
  savingPayment.value = true
  // El código canónico ('cash'), no la etiqueta en español: la API tiene un enum cerrado y la DB
  // habla inglés. Mandar "Efectivo" hacía que el pago cayera en `other` y no llegara a la caja.
  const method = paymentForm.value.method
  try {
    // Todo pago tiene un target (factura o folio). Ambos asientan el dinero en `payments` vía el
    // payment-port del backend — ya no se crea el comprobante `type:'payment'` suelto en `invoices`
    // (modelo viejo que no alimentaba la caja ni la conciliación). BM-4.3.
    if (paymentTargetKind.value === 'folio') {
      await FoliosService.pay(paymentTargetId.value, {
        amount: paymentForm.value.amount, method, reference: paymentForm.value.reference,
      })
    } else {
      await BillingService.pay(paymentTargetId.value, {
        method, amount: paymentForm.value.amount,
        reference: paymentForm.value.reference, notes: paymentForm.value.notes || undefined,
      })
    }
    closePaymentModal()
    closeViewModal()
    loadData()
    toast.success('Pago registrado')
  } catch { toast.error('Error al guardar el pago') }
  finally { savingPayment.value = false }
}

function openAddCharge(folio: Folio) {
  chargeFolioId.value = folio.id
  chargeRoom.value = folio.roomNumber || '—'
  chargeForm.value = { description: '', amount: 0, notes: '' }
  showChargeModal.value = true
}

function closeChargeModal() {
  showChargeModal.value = false
}

async function saveCharge() {
  if (!chargeFolioId.value || !chargeForm.value.description || chargeForm.value.amount <= 0) { toast.warning('Datos incompletos'); return }
  if (savingCharge.value) return
  savingCharge.value = true
  try {
    await FoliosService.charge(chargeFolioId.value, {
      description: `${chargeForm.value.description}${chargeForm.value.notes ? ` — ${chargeForm.value.notes}` : ''}`,
      amount: chargeForm.value.amount,
    })
    closeChargeModal()
    loadData()
    toast.success('Cargo agregado')
  } catch { toast.error('Error al guardar cargo') }
  finally { savingCharge.value = false }
}

function openCloseFolioModal(folio: Folio) {
  closeFolioTarget.value = folio
  showCloseFolioModal.value = true
}

function closeCloseFolioModal() {
  showCloseFolioModal.value = false
  closeFolioTarget.value = null
}

/** El backend cierra el folio, emite la factura y las vincula en una sola operación. */
async function confirmCloseAndInvoice() {
  const folio = closeFolioTarget.value
  if (!folio || closingFolio.value) return
  closingFolio.value = true
  try {
    const { invoice } = await FoliosService.closeAndInvoice(folio.id)
    closeCloseFolioModal()
    loadData()
    toast.success(`Folio cerrado — factura ${invoice?.invoiceNumber ?? ''} generada`.trim())
  } catch { toast.error('Error al cerrar el folio') }
  finally { closingFolio.value = false }
}

function exportCsv() {
  BillingService.downloadCsv(invoices.value, `facturas-${new Date().toISOString().split('T')[0]}.csv`)
  toast.success('CSV exportado')
}

function openDeleteModal(inv: any) {
  deleteTarget.value = inv
  showDeleteModal.value = true
}

function closeDeleteModal() {
  showDeleteModal.value = false
  deleteTarget.value = null
}

async function confirmDelete() {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await BillingService.remove(deleteTarget.value.id)
    closeDeleteModal()
    loadData()
    toast.success('Factura eliminada')
  } catch (e) {
    // El backend rechaza con 409 si la factura ya tiene efectos contables.
    const msg = e instanceof Error && e.message ? e.message : 'Error al eliminar la factura'
    toast.error(msg)
  }
  finally { deleting.value = false }
}

function openCreditNoteModal(inv: any) {
  creditNoteTarget.value = inv
  creditNoteReason.value = ''
  showCreditNoteModal.value = true
}

function closeCreditNoteModal() {
  showCreditNoteModal.value = false
  creditNoteTarget.value = null
}

async function confirmCreditNote() {
  if (!creditNoteTarget.value || issuingCreditNote.value) return
  if (!creditNoteReason.value.trim()) { toast.warning('Indicá el motivo de la anulación'); return }
  issuingCreditNote.value = true
  try {
    await BillingService.creditNote(creditNoteTarget.value.id, creditNoteReason.value.trim())
    closeCreditNoteModal()
    closeViewModal()
    loadData()
    toast.success('Nota de crédito emitida')
  } catch { toast.error('Error al emitir la nota de crédito') }
  finally { issuingCreditNote.value = false }
}
</script>

<style scoped>
/* Las transiciones de entrada/salida ahora las aporta AppModal. */
</style>
