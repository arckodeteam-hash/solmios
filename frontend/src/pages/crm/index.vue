<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <div class="flex items-center gap-2.5">
          <h2 class="text-xl font-black text-navy">CRM y Fidelización</h2>
          <span class="inline-flex items-center gap-1.5 rounded-full bg-[#DCFCE7] px-2.5 py-1 text-[10px] font-extrabold uppercase text-[#16A34A]">
            <span class="relative flex h-1.5 w-1.5">
              <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22C55E] opacity-60"></span>
              <span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#22C55E]"></span>
            </span>
            En vivo
          </span>
        </div>
        <p class="text-sm text-text-muted mt-0.5">Segmentación, puntos, cupones y valor de vida del cliente</p>
      </div>
    </div>

    <!-- Skeletons: cuatro KPI + la fila de tiers -->
    <template v-if="loading">
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <div v-for="i in 4" :key="i" class="h-28 animate-pulse rounded-[16px] bg-surface"></div>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <div v-for="i in 5" :key="i" class="h-24 animate-pulse rounded-2xl bg-surface"></div>
      </div>
    </template>

    <template v-else-if="dashboard">
      <!-- KPIs -->
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <KpiHeroCard label="Total Huéspedes" :value="totalGuestsCount" icon="users" accent="blue"
          unit="En la cartera del hotel" />
        <KpiHeroCard label="Activos Este Mes" :value="activeThisMonthCount" icon="checkin" accent="teal"
          unit="Con movimiento reciente" :progress="activeShare" />
        <KpiHeroCard label="Puntos Emitidos" :value="pointsIssuedCount" icon="money" accent="amber"
          unit="Programa de fidelización" />
        <KpiHeroCard label="LTV Promedio" :value="avgLtvCount" icon="bookings" accent="purple"
          prefix="$" unit="Valor de vida por cliente" />
      </div>

      <!-- Tiers -->
      <SectionCard title="Distribución por tier" subtitle="Cómo se reparte la cartera de huéspedes" class="mb-6">
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div v-for="(count, tier) in dashboard.topTierCounts" :key="tier"
            class="rounded-2xl border border-border p-4 transition-transform duration-300 hover:-translate-y-0.5">
            <div class="flex items-center gap-3">
              <div class="grid h-11 w-11 shrink-0 place-items-center rounded-full" :class="tierBg(tier)">
                <span class="h-5 w-5" v-html="tierIcon(tier)"></span>
              </div>
              <div class="min-w-0">
                <div class="text-xl font-black leading-none tabular-nums text-navy">{{ count }}</div>
                <div class="mt-1 truncate text-[10px] font-bold uppercase tracking-wide text-text-muted">{{ tier }}</div>
              </div>
            </div>
            <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-surface">
              <div class="h-full rounded-full transition-all" :class="tierBarColor(tier)" :style="{ width: tierPercent(count) + '%' }"></div>
            </div>
          </div>
        </div>
      </SectionCard>
    </template>

    <EmptyState v-else title="No se pudo cargar" message="Hubo un error consultando los indicadores de CRM. Probá de nuevo." class="mb-6">
      <template #action>
        <button @click="loadData" class="px-4 py-2 rounded-xl bg-navy text-white text-sm font-bold">Reintentar</button>
      </template>
    </EmptyState>

    <!-- Tabs -->
    <div class="flex flex-wrap gap-2 mb-6">
      <button v-for="tab in tabs" :key="tab.value" @click="activeTab = tab.value"
        class="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold transition-all cursor-pointer"
        :class="activeTab === tab.value ? 'bg-navy text-white' : 'bg-white text-text-secondary border border-border hover:border-navy/30'">
        <span class="w-4 h-4 shrink-0" v-html="tab.icon"></span>
        {{ tab.label }}
      </button>
    </div>

    <!-- LTV -->
    <SectionCard v-if="activeTab === 'ltv' && !loading"
      title="Valor de vida del cliente" :subtitle="`${ltv.length} huésped(es) con historial`" body-class="p-0">
      <EmptyState v-if="!ltv.length" :icon="ICON_CHART_EMPTY"
        title="Todavía no hay datos de LTV"
        message="El valor de vida se calcula a partir de las estadías facturadas de cada huésped." />

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[900px] text-sm tbl-head">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-[10px]">Huésped</th>
              <th class="text-left px-4 py-3 text-[10px]">Tier</th>
              <th class="text-right px-4 py-3 text-[10px]">Estancias</th>
              <th class="text-right px-4 py-3 text-[10px]">Total Gastado</th>
              <th class="text-right px-4 py-3 text-[10px] hidden lg:table-cell">Promedio</th>
              <th class="text-right px-4 py-3 text-[10px]">Puntos</th>
              <th class="text-right px-4 py-3 text-[10px] hidden xl:table-cell">Última Visita</th>
              <th class="text-right px-4 py-3 text-[10px]">LTV Score</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="g in ltv" :key="g.guestId" class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
              <td class="px-4 py-3">
                <div class="flex items-center gap-3">
                  <div class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-navy/10 text-[11px] font-black text-navy">
                    {{ initialsOf(g.name) }}
                  </div>
                  <span class="font-bold text-navy whitespace-nowrap">{{ g.name }}</span>
                </div>
              </td>
              <td class="px-4 py-3">
                <span class="rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase" :class="tierBadge(g.tier)">{{ g.tier }}</span>
              </td>
              <td class="px-4 py-3 text-right tabular-nums text-text-secondary">{{ g.totalStays }}</td>
              <td class="px-4 py-3 text-right font-bold tabular-nums text-navy">${{ g.totalSpent.toLocaleString() }}</td>
              <td class="px-4 py-3 text-right tabular-nums text-text-secondary hidden lg:table-cell">${{ g.avgPerStay.toLocaleString() }}</td>
              <td class="px-4 py-3 text-right">
                <span class="inline-flex items-center rounded-full bg-gold/10 px-2.5 py-1 text-[11px] font-extrabold tabular-nums text-gold">
                  {{ g.loyaltyPoints }}
                </span>
              </td>
              <td class="px-4 py-3 text-right tabular-nums text-text-secondary whitespace-nowrap hidden xl:table-cell">
                <!-- Llama = volvió hace poco. -->
                <span v-if="g.daysSinceLastVisit <= RECENT_DAYS" class="inline-flex items-center gap-1 font-bold text-coral">
                  <span class="h-3 w-3 shrink-0" v-html="ICON_FLAME"></span>{{ g.daysSinceLastVisit }}d
                </span>
                <span v-else>{{ g.daysSinceLastVisit }}d</span>
              </td>
              <td class="px-4 py-3 text-right font-extrabold tabular-nums"
                :class="g.ltvScore >= 50 ? 'text-teal' : g.ltvScore >= 30 ? 'text-gold' : 'text-text-secondary'">
                {{ g.ltvScore }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>

    <!-- Cupones -->
    <SectionCard v-if="activeTab === 'coupons' && !loading"
      title="Cupones y descuentos" :subtitle="`${coupons.length} cupón(es)`" body-class="p-0">
      <template #actions>
        <button @click="showCouponForm = true"
          class="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-bold text-white hover:bg-white/15 transition-colors cursor-pointer">
          <span class="h-3.5 w-3.5" v-html="ICON_PLUS"></span> Nuevo cupón
        </button>
      </template>

      <EmptyState v-if="!coupons.length" :icon="ICON_TAG_EMPTY"
        title="Todavía no hay cupones"
        message="Creá un cupón para aplicar descuentos por código en las reservas.">
        <template #action>
          <button @click="showCouponForm = true"
            class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">
            Nuevo cupón
          </button>
        </template>
      </EmptyState>

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[720px] text-sm tbl-head">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-[10px]">Código</th>
              <th class="text-right px-4 py-3 text-[10px]">Descuento</th>
              <th class="text-right px-4 py-3 text-[10px]">Usos</th>
              <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Vence</th>
              <th class="text-right px-4 py-3 text-[10px]">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in coupons" :key="c.id" class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
              <td class="px-4 py-3">
                <div class="font-black text-navy whitespace-nowrap">{{ c.code }}</div>
                <div class="text-[11px] text-text-muted lg:hidden">{{ c.validTo || 'Sin vencimiento' }}</div>
              </td>
              <td class="px-4 py-3 text-right">
                <span class="inline-flex items-center rounded-full bg-teal/10 px-2.5 py-1 text-[11px] font-extrabold tabular-nums text-teal">
                  {{ c.kind === 'percent' ? c.value + '%' : '$' + c.value }}
                </span>
              </td>
              <td class="px-4 py-3 text-right tabular-nums text-text-secondary">
                {{ c.uses ?? 0 }}<span v-if="c.maxUses" class="text-text-muted">/{{ c.maxUses }}</span>
              </td>
              <td class="px-4 py-3 text-text-secondary whitespace-nowrap hidden lg:table-cell">{{ c.validTo || 'Sin vencimiento' }}</td>
              <td class="px-4 py-3 text-right">
                <button @click="deleteCoupon(c)" title="Eliminar cupón"
                  class="grid h-8 w-8 place-items-center rounded-lg text-coral hover:bg-coral/10 transition-colors cursor-pointer ml-auto">
                  <span class="h-4 w-4" v-html="ICON_TRASH"></span>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>

    <!-- Validar cupón -->
    <div v-if="activeTab === 'validate' && !loading" class="mx-auto max-w-md">
      <SectionCard title="Validar cupón" subtitle="Comprobá un código antes de aplicarlo">
        <div class="space-y-3">
          <div>
            <label for="crm-codigo" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Código</label>
            <input id="crm-codigo" name="validateCode" required aria-required="true" v-model="validateCode" placeholder="Código del cupón"
              class="w-full rounded-xl border border-border px-4 py-2.5 text-sm font-bold text-navy focus:border-navy focus:outline-none">
          </div>
          <div>
            <label for="crm-monto-de-la-compra" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Monto de la compra</label>
            <input id="crm-monto-de-la-compra" name="validateAmount" required aria-required="true" v-model.number="validateAmount" type="number" placeholder="0"
              class="w-full rounded-xl border border-border px-4 py-2.5 text-sm tabular-nums focus:border-navy focus:outline-none">
          </div>
          <button @click="doValidateCoupon"
            class="w-full rounded-full bg-teal py-3 text-sm font-extrabold text-white hover:bg-teal-light transition-colors cursor-pointer">
            Validar
          </button>
        </div>

        <div v-if="previewResult && previewResult.valid" class="mt-5 rounded-2xl border-2 border-teal/40 bg-teal/5 px-4 py-3">
          <div class="text-lg font-black text-teal">{{ previewResult.code || validateCode }}</div>
          <div class="mt-0.5 text-sm text-text-secondary">
            Descuento sobre el monto:
            <b class="text-navy tabular-nums">${{ previewResult.discount }}</b>
            — final: <b class="text-navy tabular-nums">${{ Math.max(0, (Number(validateAmount) || 0) - previewResult.discount).toFixed(2) }}</b>
          </div>
          <div class="mt-1 text-[11px] text-text-muted">Misma lógica que aplica el motor de reservas al huésped.</div>
        </div>
      </SectionCard>
    </div>

    <!-- Segmentos -->
    <SectionCard v-if="activeTab === 'segments' && !loading"
      title="Segmentos de huéspedes" :subtitle="`${segments.length} segmento(s)`" body-class="p-0">
      <template #actions>
        <button @click="showSegmentForm = true"
          class="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-bold text-white hover:bg-white/15 transition-colors cursor-pointer">
          <span class="h-3.5 w-3.5" v-html="ICON_PLUS"></span> Nuevo
        </button>
      </template>

      <EmptyState v-if="!segments.length" :icon="ICON_TARGET_EMPTY"
        title="No hay segmentos definidos"
        message="Agrupá huéspedes por comportamiento para dirigirles campañas.">
        <template #action>
          <button @click="showSegmentForm = true"
            class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">
            Nuevo segmento
          </button>
        </template>
      </EmptyState>

      <div v-else class="grid grid-cols-1 gap-4 p-4 md:grid-cols-3">
        <div v-for="s in segments" :key="s.id" class="rounded-2xl border border-border p-4 transition-transform duration-300 hover:-translate-y-0.5">
          <div class="flex items-start justify-between gap-2">
            <div class="text-sm font-black text-navy">{{ s.name }}</div>
            <span class="shrink-0 rounded-full bg-navy/10 px-2.5 py-1 text-[11px] font-extrabold tabular-nums text-navy">{{ s.count }}</span>
          </div>
          <div v-if="s.description" class="mt-1 text-[11px] text-text-muted">{{ s.description }}</div>
          <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            <button @click="viewSegmentGuests(s)"
              class="text-[11px] font-bold text-cyan hover:text-navy transition-colors cursor-pointer">
              Ver huéspedes →
            </button>
            <button @click="goToGuests(s)"
              class="text-[11px] font-bold text-cyan hover:text-navy transition-colors cursor-pointer">
              Ver en Huéspedes →
            </button>
            <button @click="exportSegment(s)"
              class="text-[11px] font-bold text-cyan hover:text-navy transition-colors cursor-pointer">
              Exportar CSV ↓
            </button>
          </div>
        </div>
      </div>
    </SectionCard>

    <!-- Modal: Nuevo Cupón -->
    <AppModal v-if="showCouponForm" size="md" title="Nuevo cupón"
      subtitle="Código de descuento aplicable en reservas" @close="showCouponForm = false">
      <div class="space-y-4">
              <div>
                <label for="crm-codigo-2" class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2 block">Código</label>
                <input id="crm-codigo-2" name="code" required aria-required="true" v-model="couponForm.code" placeholder="Ej: VERANO2026" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy">
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label for="crm-tipo" class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2 block">Tipo</label>
                  <select id="crm-tipo" name="type" required aria-required="true" v-model="couponForm.type" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm cursor-pointer focus:outline-none focus:border-navy">
                    <option value="percentage">% Descuento</option>
                    <option value="fixed">$ Fijo</option>
                  </select>
                </div>
                <div>
                  <label for="crm-valor" class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2 block">Valor</label>
                  <input id="crm-valor" name="value" required aria-required="true" v-model.number="couponForm.value" type="number" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy">
                </div>
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label for="crm-compra-min" class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2 block">Compra Mín.</label>
                  <input id="crm-compra-min" name="minPurchase" v-model.number="couponForm.minPurchase" type="number" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy">
                </div>
                <div>
                  <label for="crm-vence" class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2 block">Vence</label>
                  <input id="crm-vence" name="expiresAt" v-model="couponForm.expiresAt" type="date" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy">
                </div>
              </div>
      </div>

      <template #footer>
        <button @click="showCouponForm = false" class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cancelar</button>
        <button @click="createCoupon" class="rounded-full bg-navy px-5 py-2.5 text-sm font-extrabold text-white hover:bg-navy-light transition-colors cursor-pointer">Crear cupón</button>
      </template>
    </AppModal>

    <!-- Modal: Nuevo Segmento -->
    <AppModal v-if="showSegmentForm" size="md" title="Nuevo segmento"
      subtitle="Agrupa huéspedes por tier y cantidad de estadías" @close="showSegmentForm = false">
      <div class="space-y-4">
              <div>
                <label for="crm-nombre" class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2 block">Nombre</label>
                <input id="crm-nombre" name="name" required aria-required="true" v-model="segmentForm.name" placeholder="Ej: Huéspedes frecuentes" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy">
              </div>
              <div>
                <label for="crm-tier" class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2 block">Tier</label>
                <select id="crm-tier" name="tier" v-model="segmentForm.tier" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm cursor-pointer focus:outline-none focus:border-navy">
                  <option value="">Cualquier tier</option>
                  <option value="bronze">Bronze</option>
                  <option value="silver">Silver</option>
                  <option value="gold">Gold</option>
                  <option value="platinum">Platinum</option>
                  <option value="diamond">Diamond</option>
                </select>
              </div>
              <div>
                <label for="crm-min-estancias" class="text-[11px] font-bold text-text-muted uppercase tracking-wide mb-2 block">Mín. Estancias</label>
                <input id="crm-min-estancias" name="minStays" v-model.number="segmentForm.minStays" type="number" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy">
              </div>
      </div>

      <template #footer>
        <button @click="showSegmentForm = false" class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cancelar</button>
        <button @click="createSegment" class="rounded-full bg-navy px-5 py-2.5 text-sm font-extrabold text-white hover:bg-navy-light transition-colors cursor-pointer">Crear segmento</button>
      </template>
    </AppModal>

    <!-- Campañas a segmentos (spec crm-campaigns) -->
    <SectionCard v-if="activeTab === 'campaigns' && !loading"
      title="Campañas de email" :subtitle="`${campaigns.length} campaña(s)`" body-class="p-0">
      <template #actions>
        <button @click="openCampaignForm"
          class="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-bold text-white hover:bg-white/15 transition-colors cursor-pointer">
          <span class="h-3.5 w-3.5" v-html="ICON_PLUS"></span> Nueva campaña
        </button>
      </template>

      <EmptyState v-if="!campaigns.length" :icon="ICON_TAG_EMPTY"
        title="Todavía no hay campañas"
        message="Componé un email y envialo a un segmento de huéspedes.">
        <template #action>
          <button @click="openCampaignForm"
            class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">
            Nueva campaña
          </button>
        </template>
      </EmptyState>

      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[680px] text-sm tbl-head">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-[10px]">Campaña</th>
              <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Asunto</th>
              <th class="text-right px-4 py-3 text-[10px]">Enviados</th>
              <th class="text-left px-4 py-3 text-[10px] hidden lg:table-cell">Estado</th>
              <th class="text-right px-4 py-3 text-[10px]">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in campaigns" :key="c.id" class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
              <td class="px-4 py-3">
                <div class="font-black text-navy">{{ c.name }}</div>
                <div class="text-[11px] text-text-muted">{{ segmentName(c.segmentId) }}</div>
              </td>
              <td class="px-4 py-3 text-text-secondary hidden lg:table-cell">{{ c.subject }}</td>
              <td class="px-4 py-3 text-right tabular-nums text-text-secondary">{{ c.sentCount }}</td>
              <td class="px-4 py-3 hidden lg:table-cell">
                <span class="rounded-full px-2.5 py-1 text-[11px] font-extrabold"
                  :class="c.status === 'sent' ? 'bg-teal/10 text-teal' : 'bg-amber/10 text-amber'">
                  {{ c.status === 'sent' ? `Enviada ${fmtCampaignDate(c.sentAt)}` : 'Borrador' }}
                </span>
              </td>
              <td class="px-4 py-3 text-right">
                <button v-if="c.status === 'draft'" @click="confirmSend(c)" :disabled="sendingCampaign === c.id"
                  class="rounded-full bg-navy px-4 py-1.5 text-[11px] font-extrabold text-white hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50">
                  {{ sendingCampaign === c.id ? 'Enviando…' : 'Enviar' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </SectionCard>

    <!-- Modal: Nueva campaña -->
    <AppModal v-if="showCampaignForm" size="md" title="Nueva campaña"
      subtitle="Se enviará a los huéspedes del segmento elegido" @close="showCampaignForm = false">
      <div class="space-y-4">
        <div>
          <label for="crm-nombre-interno" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Nombre interno *</label>
          <input id="crm-nombre-interno" name="name" required aria-required="true" v-model="campaignForm.name" placeholder="Ej: Promo temporada alta" maxlength="120"
            class="w-full rounded-xl border border-border px-4 py-2.5 text-sm focus:border-navy focus:outline-none">
        </div>
        <div>
          <label for="crm-segmento" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Segmento *</label>
          <select id="crm-segmento" name="segmentId" required aria-required="true" v-model="campaignForm.segmentId"
            class="w-full rounded-xl border border-border px-4 py-2.5 text-sm bg-white focus:border-navy focus:outline-none cursor-pointer">
            <option value="" disabled>Elegí un segmento…</option>
            <option v-for="sg in segments" :key="sg.id" :value="sg.id">{{ sg.name }} ({{ sg.count }})</option>
          </select>
        </div>
        <div>
          <label for="crm-asunto" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Asunto *</label>
          <input id="crm-asunto" name="subject" required aria-required="true" v-model="campaignForm.subject" placeholder="Ej: Volvé con 20% de descuento" maxlength="200"
            class="w-full rounded-xl border border-border px-4 py-2.5 text-sm focus:border-navy focus:outline-none">
        </div>
        <div>
          <label for="crm-mensaje-html" class="mb-2 block text-[11px] font-bold uppercase tracking-wide text-text-muted">Mensaje (HTML)</label>
          <textarea id="crm-mensaje-html" name="body" v-model="campaignForm.body" rows="7" maxlength="20000"
            placeholder="<p>Hola {{nombre}}, tenés {{puntos}} puntos en {{hotel}}…</p>"
            class="w-full rounded-xl border border-border px-4 py-2.5 text-sm font-mono focus:border-navy focus:outline-none"></textarea>
          <p v-pre class="mt-1 text-[11px] text-text-muted">Variables: <code>{{ nombre }}</code>, <code>{{ hotel }}</code>, <code>{{ puntos }}</code> — se resuelven por huésped al enviar.</p>
        </div>
      </div>
      <template #footer>
        <button @click="showCampaignForm = false" class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cancelar</button>
        <button @click="saveCampaign" :disabled="savingCampaign"
          class="rounded-full bg-navy px-5 py-2.5 text-sm font-extrabold text-white hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50">
          {{ savingCampaign ? 'Guardando…' : 'Crear borrador' }}
        </button>
      </template>
    </AppModal>

    <!-- Confirmación de envío -->
    <ConfirmModal v-if="sendTarget" title="Enviar campaña"
      :message="`¿Enviar la campaña ${sendTarget.name} a los huéspedes del segmento ${segmentName(sendTarget.segmentId)}? Los sin email se omiten y no se puede deshacer.`"
      confirm-label="Enviar"
      :loading="sendingCampaign === sendTarget.id"
      @close="sendTarget = null"
      @confirm="doSendCampaign" />

    <!-- Configuración de fidelización (T2, spec crm-loyalty) -->
    <SectionCard v-if="activeTab === 'config' && !loading"
      title="Programa de puntos" subtitle="Ratio, valor del canje y estados — aplica desde el próximo checkout">
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label class="flex items-center justify-between gap-3 rounded-xl border border-border p-4 cursor-pointer">
          <span class="text-sm font-bold text-navy">Programa activo</span>
          <input id="crm-programa-activo" name="enabled" v-model="loyaltyCfg.enabled" type="checkbox" class="h-5 w-5 accent-teal cursor-pointer">
        </label>
        <div>
          <div class="mb-1 text-[11px] font-bold uppercase text-text-muted">Puntos por unidad de moneda</div>
          <input id="crm-points-per-currency-unit" name="pointsPerCurrencyUnit" aria-label="Puntos por unidad de moneda" v-model.number="loyaltyCfg.pointsPerCurrencyUnit" type="number" min="0" step="0.5"
            class="w-full rounded-xl border border-border px-4 py-2.5 text-sm font-bold text-navy tabular-nums">
          <div class="mt-1 text-[11px] text-text-muted">Ej: 10 → una estadía de $100 suma 1.000 puntos.</div>
        </div>
        <div>
          <div class="mb-1 text-[11px] font-bold uppercase text-text-muted">Valor de 1 punto al canjear</div>
          <input id="crm-point-value" name="pointValue" aria-label="Valor de 1 punto al canjear" v-model.number="loyaltyCfg.pointValue" type="number" min="0" step="0.1"
            class="w-full rounded-xl border border-border px-4 py-2.5 text-sm font-bold text-navy tabular-nums">
          <div class="mt-1 text-[11px] text-text-muted">Ej: 1 → canjear 500 puntos = código de $500.</div>
        </div>
        <div>
          <div class="mb-1 text-[11px] font-bold uppercase text-text-muted">Vigencia del código de canje (días)</div>
          <input id="crm-promo-valid-days" name="promoValidDays" aria-label="Vigencia del código de canje en días" v-model.number="loyaltyCfg.promoValidDays" type="number" min="1"
            class="w-full rounded-xl border border-border px-4 py-2.5 text-sm font-bold text-navy tabular-nums">
        </div>
      </div>
      <div class="mt-5 flex flex-wrap items-center gap-3">
        <button @click="saveLoyaltyConfig" :disabled="savingConfig"
          class="rounded-full bg-navy px-5 py-2.5 text-sm font-extrabold text-white hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50">
          {{ savingConfig ? 'Guardando…' : 'Guardar configuración' }}
        </button>
        <button @click="recomputeTiers" :disabled="recomputing"
          class="rounded-full border border-border px-5 py-2.5 text-sm font-bold text-navy hover:border-navy/40 transition-colors cursor-pointer disabled:opacity-50">
          {{ recomputing ? 'Recalculando…' : 'Recalcular niveles ahora' }}
        </button>
        <span class="text-[11px] text-text-muted">Sin configurar se usan los valores por defecto (10 · $1 · 90 días).</span>
      </div>
    </SectionCard>

    <!-- Modal: Huéspedes del segmento -->
    <AppModal v-if="openSegment" size="lg" :title="openSegment.name" subtitle="Huéspedes que caen en este segmento hoy" body-class="p-0" @close="openSegment = null">
      <div v-if="loadingGuests" class="space-y-2 p-4">
        <div v-for="i in 4" :key="i" class="h-10 animate-pulse rounded-lg bg-surface"></div>
      </div>
      <EmptyState v-else-if="!segmentGuests.length" :icon="ICON_TARGET_EMPTY"
        title="Sin huéspedes en este segmento"
        message="Nadie cumple hoy las reglas de tier/estadías que definiste." />
      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[560px] text-sm tbl-head">
          <thead>
            <tr>
              <th class="text-left px-4 py-3 text-[10px]">Huésped</th>
              <th class="text-left px-4 py-3 text-[10px]">Tier</th>
              <th class="text-right px-4 py-3 text-[10px]">Estancias</th>
              <th class="text-right px-4 py-3 text-[10px]">Gastado</th>
              <th class="text-right px-4 py-3 text-[10px]">Puntos</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="g in segmentGuests" :key="g.id" class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
              <td class="px-4 py-3">
                <div class="flex items-center gap-3">
                  <div class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-navy/10 text-[10px] font-black text-navy">{{ initialsOf(g.name) }}</div>
                  <div class="min-w-0">
                    <div class="font-bold text-navy whitespace-nowrap">{{ g.name }}</div>
                    <div v-if="g.email" class="text-[11px] text-text-muted truncate">{{ g.email }}</div>
                  </div>
                </div>
              </td>
              <td class="px-4 py-3"><span class="rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase" :class="tierBadge(g.tier)">{{ g.tier }}</span></td>
              <td class="px-4 py-3 text-right tabular-nums text-text-secondary">{{ g.totalStays }}</td>
              <td class="px-4 py-3 text-right font-bold tabular-nums text-navy">${{ g.totalSpent.toLocaleString() }}</td>
              <td class="px-4 py-3 text-right">
                <span class="inline-flex items-center rounded-full bg-gold/10 px-2.5 py-1 text-[11px] font-extrabold tabular-nums text-gold">{{ g.loyaltyPoints }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <template #footer>
        <button @click="openSegment = null" class="px-4 py-2.5 text-sm font-bold text-text-secondary hover:text-navy transition-colors cursor-pointer">Cerrar</button>
      </template>
    </AppModal>

    <!-- Confirmación de borrado (reemplaza el confirm() nativo) -->
    <ConfirmModal v-if="confirmModal" :title="confirmModal.title" :message="confirmModal.message"
      :confirm-label="confirmModal.confirmLabel" :danger="confirmModal.danger" :loading="confirmBusy"
      @confirm="runConfirm" @close="confirmModal = null" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { PromoCodeService, type PromoCode, type PromoValidationResult } from '@/services/PromoCode.service'
import { ConfigService } from '@/services/Platform.service'
import { CrmService, type Coupon, type GuestSegment, type GuestLTV, type CrmDashboard, type SegmentGuest, type Campaign } from '@/services/Crm.service'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth.store'
import { useApiError } from '@/composables/useApiError'
import { useConfirm } from '@/composables/useConfirm'
import { useCountUp } from '@/composables/useCountUp'
import EmptyState from '@/components/ui/EmptyState.vue'
import ConfirmModal from '@/components/features/ConfirmModal.vue'
import AppModal from '@/components/ui/AppModal.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'

const ICON_USERS = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"/></svg>'
const ICON_CHECK = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>'
const ICON_STAR = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="currentColor"><path d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.563.563 0 0 0-.586 0L6.982 21.44a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.563.563 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z"/></svg>'
const ICON_WALLET = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M21 12V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1.5M21 12h-4a1.5 1.5 0 0 0 0 3h4v-3Z"/></svg>'
const ICON_CHART = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M3 3v18h18M8 17V10m5 7V6m5 11v-4"/></svg>'
const ICON_TAG = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.169.659 1.591l9.5 9.5a2.25 2.25 0 0 0 3.182 0l4.318-4.318a2.25 2.25 0 0 0 0-3.182l-9.5-9.5A2.25 2.25 0 0 0 9.568 3Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 6.75h.008v.008H6.75V6.75Z"/></svg>'
const ICON_CARD = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="5" width="20" height="14" rx="2"/><path stroke-linecap="round" d="M2 10h20"/></svg>'
const ICON_TARGET = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-4.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0-3a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/></svg>'
const ICON_PLUS = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>'
const ICON_FLAME = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M15.362 5.214A8.252 8.252 0 0 1 12 21 8.25 8.25 0 0 1 6.038 7.048 8.287 8.287 0 0 0 9 9.6a8.983 8.983 0 0 1 3.361-6.867 8.21 8.21 0 0 0 3 2.48Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 18a3.75 3.75 0 0 0 .495-7.468 5.99 5.99 0 0 1-1.925 3.547 5.975 5.975 0 0 1-2.133 1.001A3.75 3.75 0 0 0 12 18Z"/></svg>'
const ICON_MEDAL = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M9 15.75 8.25 21l3.75-2 3.75 2-.75-5.25M15.75 9a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"/></svg>'
const ICON_GEM = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="m5.25 8.25 6.75 12 6.75-12M5.25 8.25 8 4.5h8l2.75 3.75M5.25 8.25h13.5"/></svg>'
const ICON_CROWN = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M3 17h18M4 17l-1-9 5 4 4-6 4 6 5-4-1 9"/></svg>'
const ICON_USER = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M17.982 18.725A7.488 7.488 0 0 0 12 15.75a7.488 7.488 0 0 0-5.982 2.975m11.963 0a9 9 0 1 0-11.963 0m11.963 0A8.966 8.966 0 0 1 12 21a8.966 8.966 0 0 1-5.982-2.275M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>'
const ICON_TRASH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></svg>'
// Variantes a 32px para EmptyState (su caja mide 64px; con w-full quedan gigantes).
const ICON_CHART_EMPTY = '<svg viewBox="0 0 24 24" class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3 3v18h18M8 17V10m5 7V6m5 11v-4"/></svg>'
const ICON_TAG_EMPTY = '<svg viewBox="0 0 24 24" class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.169.659 1.591l9.5 9.5a2.25 2.25 0 0 0 3.182 0l4.318-4.318a2.25 2.25 0 0 0 0-3.182l-9.5-9.5A2.25 2.25 0 0 0 9.568 3Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 6.75h.008v.008H6.75V6.75Z"/></svg>'
const ICON_TARGET_EMPTY = '<svg viewBox="0 0 24 24" class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-4.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0-3a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/></svg>'

const toast = useToast()
const router = useRouter()
const auth = useAuthStore()
const hotelId = computed(() => (auth.user?.hotelId && auth.user.hotelId !== 'platform' ? auth.user.hotelId : undefined))
const { handle } = useApiError()
const { confirmModal, confirmBusy, askConfirm, runConfirm } = useConfirm({
  onDone: () => loadData(),
  onError: (e) => handle(e, 'No se pudo eliminar el cupón'),
})
const activeTab = ref('ltv')
const loading = ref(true)

const tabs = [
  { value: 'ltv', label: 'LTV', icon: ICON_CHART },
  { value: 'coupons', label: 'Cupones', icon: ICON_TAG },
  { value: 'validate', label: 'Validar', icon: ICON_CARD },
  { value: 'segments', label: 'Segmentos', icon: ICON_TARGET },
  { value: 'campaigns', label: 'Campañas', icon: ICON_TAG },
  { value: 'config', label: 'Configuración', icon: ICON_TAG },
]

const dashboard = ref<CrmDashboard | null>(null)
const ltv = ref<GuestLTV[]>([])
const coupons = ref<PromoCode[]>([])
const segments = ref<GuestSegment[]>([])

const totalGuestsCount = computed(() => dashboard.value?.totalGuests ?? 0)
const activeThisMonthCount = computed(() => dashboard.value?.activeThisMonth ?? 0)
const pointsIssuedCount = computed(() => dashboard.value?.totalPointsIssued ?? 0)
const avgLtvCount = computed(() => dashboard.value?.avgLTV ?? 0)

// Los KPI los anima KpiHeroCard internamente (useCountUp propio).

// Porción de la cartera con movimiento este mes — anillo del KPI.
const activeShare = computed(() => totalGuestsCount.value
  ? Math.round((activeThisMonthCount.value / totalGuestsCount.value) * 100)
  : 0)

// Cliente "reciente" si volvió dentro de esta ventana (llama en la tabla de LTV).
const RECENT_DAYS = 30

function initialsOf(name?: string): string {
  if (!name) return '?'
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('')
}

const showCouponForm = ref(false)
const showSegmentForm = ref(false)
const couponForm = ref({ code: '', type: 'percentage', value: 10, minPurchase: 0, expiresAt: '' })
const segmentForm = ref({ name: '', tier: '', minStays: 0 })
const validateCode = ref('')
const validateAmount = ref(0)
const validatedCoupon = ref<Coupon | null>(null)
const previewResult = ref<PromoValidationResult | null>(null)
// Campañas (spec crm-campaigns)
const campaigns = ref<Campaign[]>([])
const showCampaignForm = ref(false)
const savingCampaign = ref(false)
const sendingCampaign = ref<string | null>(null)
const sendTarget = ref<Campaign | null>(null)
const campaignForm = ref({ name: '', segmentId: '', subject: '', body: '' })

function segmentName(segmentId: string): string {
  return segments.value.find((sg) => sg.id === segmentId)?.name ?? '—'
}

function fmtCampaignDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('es-DO') : ''
}

async function loadCampaigns() {
  try { campaigns.value = await CrmService.listCampaigns() } catch { /* vacío silencioso */ }
}

function openCampaignForm() {
  campaignForm.value = { name: '', segmentId: '', subject: '', body: '' }
  showCampaignForm.value = true
}

async function saveCampaign() {
  if (!campaignForm.value.name.trim() || !campaignForm.value.segmentId || !campaignForm.value.subject.trim()) {
    toast.warning('Completá nombre, segmento y asunto')
    return
  }
  savingCampaign.value = true
  try {
    await CrmService.createCampaign(campaignForm.value)
    toast.success('Campaña creada como borrador')
    showCampaignForm.value = false
    await loadCampaigns()
  } catch (e) {
    handle(e, 'No se pudo crear la campaña')
  } finally {
    savingCampaign.value = false
  }
}

function confirmSend(c: Campaign) { sendTarget.value = c }

async function doSendCampaign() {
  if (!sendTarget.value?.id) return
  sendingCampaign.value = sendTarget.value.id
  try {
    const r = await CrmService.sendCampaign(sendTarget.value.id)
    toast.success(`Campaña enviada: ${r.queued} email(s) en cola${r.skipped ? `, ${r.skipped} omitido(s)` : ''}`)
    sendTarget.value = null
    await loadCampaigns()
  } catch (e) {
    handle(e, 'No se pudo enviar la campaña')
  } finally {
    sendingCampaign.value = null
  }
}

const loyaltyCfg = ref({ enabled: true, pointsPerCurrencyUnit: 10, pointValue: 1, promoValidDays: 90 })
const savingConfig = ref(false)
const recomputing = ref(false)

async function loadLoyaltyConfig() {
  try {
    const v = await ConfigService.get('crm_loyalty', hotelId.value)
    if (v && typeof v === 'object') {
      loyaltyCfg.value = { ...loyaltyCfg.value, ...v }
    }
  } catch { /* sin config: defaults */ }
}

async function saveLoyaltyConfig() {
  savingConfig.value = true
  try {
    await ConfigService.set('crm_loyalty', { ...loyaltyCfg.value }, hotelId.value ?? undefined)
    toast.success('Configuración guardada')
  } catch {
    toast.error('No se pudo guardar la configuración')
  } finally {
    savingConfig.value = false
  }
}
const openSegment = ref<GuestSegment | null>(null)
const segmentGuests = ref<SegmentGuest[]>([])
const loadingGuests = ref(false)

function tierIcon(t: string) { return { bronze: ICON_MEDAL, silver: ICON_MEDAL, gold: ICON_MEDAL, platinum: ICON_GEM, diamond: ICON_CROWN }[t] || ICON_USER }
function tierBg(t: string) { return { bronze: 'bg-amber-50 text-amber-600', silver: 'bg-gray-50 text-gray-500', gold: 'bg-gold/10 text-gold', platinum: 'bg-cyan/10 text-cyan', diamond: 'bg-purple/10 text-purple' }[t] || '' }
function tierBadge(t: string) { return { bronze: 'bg-amber-100 text-amber-700', silver: 'bg-gray-200 text-gray-700', gold: 'bg-gold/10 text-gold', platinum: 'bg-cyan/10 text-cyan', diamond: 'bg-purple/10 text-purple' }[t] || '' }
function tierBarColor(t: string) { return { bronze: 'bg-amber-400', silver: 'bg-gray-400', gold: 'bg-gold', platinum: 'bg-cyan', diamond: 'bg-purple' }[t] || 'bg-navy/30' }
function tierPercent(count: number) { const total = dashboard.value?.totalGuests || 0; return total ? Math.round((count / total) * 100) : 0 }

async function loadData() {
  loading.value = true
  try {
    const [d, l, c, s] = await Promise.all([CrmService.getDashboard(), CrmService.getLTV(), PromoCodeService.list(), CrmService.listSegments()])
    dashboard.value = d; ltv.value = l; coupons.value = c; segments.value = s
  } catch { toast.error('Error al cargar') }
  finally { loading.value = false }
}
onMounted(() => { loadData(); loadLoyaltyConfig(); loadCampaigns() })

async function createCoupon() {
  if (!couponForm.value.code) { toast.warning('Código requerido'); return }
  try {
    // Spec crm-coupons: los "cupones" del CRM SON promo codes — una sola fuente de
    // descuentos, aplicable en el motor de reservas público.
    await PromoCodeService.create({
      code: couponForm.value.code.trim().toUpperCase(),
      kind: couponForm.value.type === 'percentage' ? 'percent' : 'fixed',
      value: Number(couponForm.value.value),
      minAmount: Number(couponForm.value.minPurchase) || null,
      validTo: couponForm.value.expiresAt || null,
      active: true,
    })
    toast.success('Cupón creado — aplicable en el motor de reservas')
    showCouponForm.value = false
    couponForm.value = { code: '', type: 'percentage', value: 10, minPurchase: 0, expiresAt: '' }
    loadData()
  }
  catch { toast.error('Error') }
}
// Borrar un cupón pasa por ConfirmModal: un código puede estar circulando ya.
function deleteCoupon(c: PromoCode) {
  askConfirm({
    title: 'Eliminar cupón',
    message: `El código ${c.code} deja de ser válido para quien todavía no lo usó.`,
    confirmLabel: 'Eliminar',
    danger: true,
    run: async () => {
      await PromoCodeService.remove(c.id)
      toast.success('Cupón eliminado')
    },
  })
}
async function doValidateCoupon() {
  try {
    // Preview con la MISMA lógica del motor (spec crm-coupons) — no una segunda implementación.
    previewResult.value = await PromoCodeService.preview(validateCode.value.trim().toUpperCase(), Number(validateAmount.value) || 0)
    validatedCoupon.value = previewResult.value.valid ? { code: validateCode.value.trim().toUpperCase() } as Coupon : null
    toast.success('¡Cupón válido!')
  } catch {
    previewResult.value = null
    validatedCoupon.value = null
    toast.error('Cupón inválido o expirado')
  }
}
async function createSegment() {
  const rules: any = {}
  if (segmentForm.value.tier) rules.tier = segmentForm.value.tier
  if (segmentForm.value.minStays > 0) rules.minStays = segmentForm.value.minStays
  try { await CrmService.createSegment({ name: segmentForm.value.name, rules: JSON.stringify(rules) }); toast.success('Segmento creado'); showSegmentForm.value = false; segmentForm.value = { name: '', tier: '', minStays: 0 }; loadData() }
  catch { toast.error('Error') }
}
/** El listado de Huéspedes filtra por segmento (spec crm-segments). */
function goToGuests(s: GuestSegment) {
  router.push({ path: '/panel/guests', query: { segment: s.id } })
}

/** Descarga el CSV server-side del segmento (spec crm-segments). */
async function exportSegment(s: GuestSegment) {
  try {
    const csv = await CrmService.exportSegment(s.id)
    const blob = new Blob([String(csv)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `segmento-${s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  } catch {
    toast.error('No se pudo exportar el segmento')
  }
}

/** Backfill de tiers tras cambiar umbrales en la config (spec crm-loyalty). */
async function recomputeTiers() {
  recomputing.value = true
  try {
    const r = await CrmService.recomputeTiers()
    toast.success(`Niveles recalculados: ${r.upgraded} de ${r.recomputed} huéspedes subieron`)
    loadData()
  } catch {
    toast.error('No se pudo recalcular los niveles')
  } finally {
    recomputing.value = false
  }
}

async function viewSegmentGuests(s: GuestSegment) {
  openSegment.value = s
  loadingGuests.value = true
  segmentGuests.value = []
  try { segmentGuests.value = await CrmService.getGuestsInSegment(s.id) }
  catch { toast.error('No se pudieron cargar los huéspedes del segmento'); openSegment.value = null }
  finally { loadingGuests.value = false }
}
</script>

<style scoped>
.modal-fade-enter-active, .modal-fade-leave-active { transition: opacity 0.2s ease; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }
.modal-fade-enter-active .modal-panel, .modal-fade-leave-active .modal-panel {
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
}
.modal-fade-enter-from .modal-panel, .modal-fade-leave-to .modal-panel {
  opacity: 0; transform: scale(0.95) translateY(12px);
}
</style>
