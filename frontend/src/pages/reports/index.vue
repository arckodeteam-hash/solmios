<template>
  <div>
    <div class="flex items-center justify-between mb-4 flex-wrap gap-3">
      <div>
        <h2 class="text-xl font-black text-navy">Reportes</h2>
        <p class="text-xs text-text-muted mt-0.5">Análisis de rendimiento del hotel</p>
      </div>
      <div class="flex w-full items-center gap-2 flex-wrap sm:w-auto">
        <div class="flex items-center gap-1 rounded-full border border-border p-1 min-w-0 max-w-full overflow-x-auto">
          <button v-for="opt in RANGE_OPTIONS" :key="opt.value" @click="setRange(opt.value)"
            class="px-3 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer whitespace-nowrap"
            :class="range === opt.value ? 'bg-navy text-white' : 'text-text-secondary hover:text-navy'">
            {{ opt.label }}
          </button>
        </div>
        <template v-if="range === 'custom'">
          <input id="reports-from" name="from" aria-label="Reporte desde la fecha" v-model="from" type="date" class="px-3 py-2 rounded-xl border border-border text-xs focus:outline-none focus:border-navy" @change="load" />
          <span class="text-text-muted text-xs">→</span>
          <input id="reports-to" name="to" aria-label="Reporte hasta la fecha" v-model="to" type="date" class="px-3 py-2 rounded-xl border border-border text-xs focus:outline-none focus:border-navy" @change="load" />
        </template>
        <button @click="exportCsv" :disabled="!data" class="flex items-center gap-1.5 px-4 py-2 border border-border rounded-full text-xs font-bold text-text-secondary hover:border-navy/30 transition-colors cursor-pointer disabled:opacity-50">
          <span class="w-3.5 h-3.5 shrink-0" v-html="ICON_DOWNLOAD"></span>
          Exportar CSV
        </button>
      </div>
    </div>

    <!-- Tabs -->
    <div class="flex gap-2 mb-6 overflow-x-auto">
      <button v-for="(meta, key) in REPORT_META" :key="key" @click="changeTab(key as ReportType)"
        class="px-4 py-2 rounded-full text-sm font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-2"
        :class="activeTab === key ? 'bg-navy text-white' : 'bg-white text-text-secondary border border-border hover:border-navy/30'">
        <span class="w-4 h-4 shrink-0" v-html="TAB_ICON_MAP[meta.icon]"></span>
        <span>{{ meta.label }}</span>
      </button>
    </div>

    <p class="text-xs text-text-muted mb-4">{{ REPORT_META[activeTab].description }}</p>

    <!-- Loading -->
    <div v-if="loading" class="space-y-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div v-for="i in 4" :key="i" class="h-32 animate-pulse rounded-[16px] bg-surface"></div>
      </div>
      <div class="h-64 animate-pulse rounded-2xl bg-surface"></div>
    </div>

    <!-- Balance — base caja: solo plata que se movió -->
    <div v-else-if="activeTab === 'balance' && data" class="space-y-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <KpiHeroCard label="Ingresos cobrados" :value="(data as BalanceReport).ingresosCobrados"
          icon="money" accent="teal" prefix="$" unit="Plata efectivamente movida" />
        <KpiHeroCard label="Egresos pagados" :value="(data as BalanceReport).egresosPagados"
          icon="checkout" accent="rose" prefix="$" unit="Gastos ya desembolsados" />
        <KpiHeroCard label="Resultado" :value="Math.abs((data as BalanceReport).resultado)"
          icon="checkin" :accent="(data as BalanceReport).resultado >= 0 ? 'green' : 'rose'"
          :prefix="(data as BalanceReport).resultado < 0 ? '-$' : '$'" unit="Base caja del período" />
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SectionCard title="Ingresos por método" subtitle="Cobros del período" body-class="p-0">
          <EmptyState v-if="Object.keys((data as BalanceReport).ingresosPorMetodo).length === 0"
            :icon="ICON_WALLET" title="Sin cobros en el período"
            message="No se registraron pagos entre las fechas seleccionadas. Probá ampliar el rango." />
          <div v-else class="p-4 sm:p-5">
            <div class="divide-y divide-border">
              <div v-for="(val, method) in (data as BalanceReport).ingresosPorMetodo" :key="method"
                class="flex items-center justify-between gap-3 py-2 text-xs first:pt-0">
                <span class="text-navy font-bold">{{ METHOD_LABEL[method] || method }}</span>
                <span class="text-text-secondary tabular-nums">{{ formatMoney(val as number) }}</span>
              </div>
              <div class="flex items-center justify-between gap-3 pt-2 text-xs font-black text-navy">
                <span>Total</span>
                <span class="tabular-nums">{{ formatMoney((data as BalanceReport).ingresosCobrados) }}</span>
              </div>
            </div>
            <p class="text-[11px] text-text-muted mt-3">
              Un pago registra un monto y un método, no qué consumo saldó: por eso no se abre por habitación y extras.
            </p>
          </div>
        </SectionCard>

        <SectionCard title="Egresos por categoría" subtitle="Gastos pagados" body-class="p-0">
          <EmptyState v-if="Object.keys((data as BalanceReport).egresosPorCategoria).length === 0"
            :icon="ICON_RECEIPT" title="Sin gastos pagados en el período"
            message="No hay egresos desembolsados entre las fechas seleccionadas." />
          <div v-else class="p-4 sm:p-5">
            <div class="divide-y divide-border">
              <div v-for="(val, cat) in (data as BalanceReport).egresosPorCategoria" :key="cat"
                class="flex items-center justify-between gap-3 py-2 text-xs first:pt-0">
                <span class="text-navy font-bold">{{ CATEGORY_LABEL[cat] || cat }}</span>
                <span class="text-text-secondary tabular-nums">{{ formatMoney(val as number) }}</span>
              </div>
              <div class="flex items-center justify-between gap-3 pt-2 text-xs font-black text-navy">
                <span>Total</span>
                <span class="tabular-nums">{{ formatMoney((data as BalanceReport).egresosPagados) }}</span>
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      <!-- Compromisos: no entran en el resultado porque la plata no se movió. -->
      <SectionCard title="Pendientes" subtitle="Compromisos, no plata movida">
        <div class="divide-y divide-border">
          <div class="flex items-center justify-between gap-3 py-2 text-xs first:pt-0">
            <span class="text-navy font-bold">Por cobrar <span class="text-text-muted font-normal">(facturado {{ formatMoney((data as BalanceReport).facturado) }})</span></span>
            <span class="font-black text-gold tabular-nums">{{ formatMoney((data as BalanceReport).porCobrar) }}</span>
          </div>
          <div class="flex items-center justify-between gap-3 py-2 text-xs last:pb-0">
            <span class="text-navy font-bold">Gastos impagos</span>
            <span class="font-black text-coral tabular-nums">{{ formatMoney((data as BalanceReport).egresosPendientes) }}</span>
          </div>
        </div>
        <p class="text-[11px] text-text-muted mt-3">
          No entran en el resultado: son compromisos, no plata movida. El resultado es base caja y por eso cuadra con Caja y Conciliación.
        </p>
      </SectionCard>
    </div>

    <!-- Facturación -->
    <div v-else-if="activeTab === 'facturacion' && data" class="space-y-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiHeroCard label="Total bruto" :value="(data as FacturacionReport).total"
          icon="money" accent="blue" prefix="$" unit="Facturado en el período" />
        <KpiHeroCard label="Neto" :value="(data as FacturacionReport).net"
          icon="money" accent="teal" prefix="$" unit="Después de impuestos y comisiones" />
        <KpiHeroCard label="Habitaciones" :value="(data as FacturacionReport).roomRevenue"
          icon="bed" accent="purple" prefix="$" unit="Ingreso por alojamiento" />
        <KpiHeroCard label="Extras" :value="(data as FacturacionReport).extrasRevenue"
          icon="bookings" accent="amber" prefix="$" unit="Consumos y servicios" />
        <KpiHeroCard label="Impuestos" :value="(data as FacturacionReport).taxes"
          icon="building" accent="amber" prefix="$" unit="Retenido para el fisco" />
        <KpiHeroCard label="Comisiones OTA" :value="(data as FacturacionReport).commissionOTA"
          icon="users" accent="rose" prefix="$" unit="Retenido por los canales" />
        <!-- Devengado: incluye los gastos impagos. El Balance, en base caja, solo cuenta los pagados. -->
        <KpiHeroCard label="Gastos (devengado)" :value="(data as FacturacionReport).gastos"
          icon="checkout" accent="rose" prefix="$" unit="Incluye los impagos" />
        <KpiHeroCard label="Resultado (devengado)" :value="Math.abs((data as FacturacionReport).resultado)"
          icon="checkin" :accent="(data as FacturacionReport).resultado >= 0 ? 'green' : 'rose'"
          :prefix="(data as FacturacionReport).resultado < 0 ? '-$' : '$'" unit="Neto menos gastos devengados" />
      </div>
      <SectionCard title="Extras por categoría" subtitle="Consumos facturados" body-class="p-0">
        <EmptyState v-if="Object.keys((data as FacturacionReport).extrasByCategory).length === 0"
          :icon="ICON_TAG" title="Sin extras facturados en el período"
          message="No hay consumos cargados entre las fechas seleccionadas. Probá ampliar el rango." />
        <div v-else class="divide-y divide-border p-4 sm:p-5">
          <div v-for="(val, cat) in (data as FacturacionReport).extrasByCategory" :key="cat"
            class="flex items-center justify-between gap-3 text-xs py-2 first:pt-0 last:pb-0">
            <span class="text-navy font-bold capitalize">{{ cat }}</span>
            <span class="text-text-secondary tabular-nums">{{ formatMoney(val as number) }}</span>
          </div>
        </div>
      </SectionCard>
      <BarChart :data="series((data as FacturacionReport).daily)" :format="formatMoney" :label="longRange ? 'Ingresos mensuales' : 'Ingresos diarios'" />
    </div>

    <!-- Ocupación -->
    <div v-else-if="activeTab === 'ocupacion' && data" class="space-y-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiHeroCard label="Hab. totales" :value="(data as OcupacionReport).totalRooms"
          icon="building" accent="blue" unit="Inventario del hotel" />
        <KpiHeroCard label="Ocup. media real" :value="(data as OcupacionReport).avgRealOccupancy"
          icon="bed" accent="teal" suffix="%" :progress="(data as OcupacionReport).avgRealOccupancy"
          unit="Promedio del período" />
        <KpiHeroCard label="Ocupadas/día" :value="ocupAvgOccupied"
          icon="checkin" accent="purple" unit="Habitaciones vendidas por día" />
        <KpiHeroCard label="Libres/día" :value="ocupAvgFree"
          icon="checkout" accent="amber" unit="Disponibles por día" />
      </div>
      <SectionCard title="Hab. por tipo" subtitle="Distribución del inventario">
        <div class="flex flex-wrap gap-2">
          <span v-for="(cnt, type) in (data as OcupacionReport).byRoomType" :key="type"
            class="px-3 py-1.5 bg-navy/5 text-navy rounded-full text-xs font-bold">
            {{ type }}: <span class="tabular-nums">{{ cnt }}</span>
          </span>
        </div>
      </SectionCard>
      <BarChart :data="series((data as OcupacionReport).daily.map(d => ({ date: d.date, value: d.realOccupiedPct })), 'avg')" :format="(v: number) => `${v}%`" :label="longRange ? 'Ocupación mensual (%)' : 'Ocupación diaria (%)'" />
      <SectionCard title="Detalle diario"
        :subtitle="`${(data as OcupacionReport).daily.length} día(s) en el período`" body-class="p-0">
        <EmptyState v-if="(data as OcupacionReport).daily.length === 0"
          :icon="ICON_CALENDAR" title="Sin días en el período"
          message="No hay ocupación registrada para el rango seleccionado. Probá ampliar las fechas." />
        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[560px] text-xs tbl-head">
            <thead><tr>
              <th class="text-left px-4 py-3 text-[10px]">Fecha</th>
              <th class="text-right px-4 py-3 text-[10px]">Ocupadas</th>
              <th class="text-right px-4 py-3 text-[10px]">Bloqueadas</th>
              <th class="text-right px-4 py-3 text-[10px]">Libres</th>
              <th class="text-right px-4 py-3 text-[10px]">Ocup. %</th>
            </tr></thead>
            <tbody>
              <tr v-for="d in (data as OcupacionReport).daily" :key="d.date" class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
                <td class="px-4 py-2.5 text-navy font-bold">{{ formatDate(d.date) }}</td>
                <td class="px-4 py-2.5 text-right tabular-nums">{{ d.occupied }}</td>
                <td class="px-4 py-2.5 text-right text-text-muted tabular-nums">{{ d.blocked }}</td>
                <td class="px-4 py-2.5 text-right text-teal tabular-nums">{{ d.free }}</td>
                <td class="px-4 py-2.5 text-right font-bold tabular-nums" :class="d.realOccupiedPct > 80 ? 'text-coral' : d.realOccupiedPct > 50 ? 'text-gold' : 'text-teal'">{{ d.realOccupiedPct }}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>

    <!-- Pernoctaciones -->
    <div v-else-if="activeTab === 'pernoctaciones' && data" class="space-y-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiHeroCard label="Total paxes" :value="(data as PernotacionesReport).totalPaxes"
          icon="users" accent="blue" unit="Personas alojadas en el período" />
        <KpiHeroCard label="Adultos" :value="(data as PernotacionesReport).totalAdults"
          icon="users" accent="teal" unit="Mayores registrados" />
        <KpiHeroCard label="Niños" :value="(data as PernotacionesReport).totalChildren"
          icon="users" accent="amber" unit="Menores registrados" />
        <KpiHeroCard label="Media/noche" :value="(data as PernotacionesReport).avgPerNight"
          icon="bookings" accent="purple" unit="Paxes promedio por noche" />
      </div>
      <BarChart :data="series((data as PernotacionesReport).daily.map(d => ({ date: d.date, value: d.total })))" :format="String" :label="longRange ? 'Paxes por mes' : 'Paxes por noche'" />
    </div>

    <!-- Rendimiento -->
    <div v-else-if="activeTab === 'rendimiento' && data" class="space-y-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <KpiHeroCard label="ADR" :value="(data as RendimientoReport).adr"
          icon="money" accent="blue" prefix="$" unit="Tarifa media por noche vendida" />
        <KpiHeroCard label="RevPAR" :value="(data as RendimientoReport).revpar"
          icon="money" accent="teal" prefix="$" unit="Ingreso por habitación disponible" />
        <KpiHeroCard label="Ocupación" :value="(data as RendimientoReport).occupancyPct"
          icon="bed" accent="purple" suffix="%" :progress="(data as RendimientoReport).occupancyPct"
          unit="Del inventario disponible" />
        <KpiHeroCard label="Estancia media" :value="(data as RendimientoReport).avgStay"
          icon="bookings" accent="amber" :unit="`${(data as RendimientoReport).avgStay} noches por estancia`" />
        <KpiHeroCard label="Noches vendidas" :value="(data as RendimientoReport).nightsSold"
          icon="checkin" accent="blue" unit="Noches-habitación ocupadas" />
        <KpiHeroCard label="Hab-disponibles" :value="(data as RendimientoReport).availableRoomNights"
          icon="building" accent="rose" unit="Noches-habitación en venta" />
      </div>
      <SectionCard title="ADR por tipo de habitación" subtitle="Tarifa media por categoría" body-class="p-0">
        <EmptyState v-if="Object.keys((data as RendimientoReport).adrByType).length === 0"
          :icon="ICON_BED" title="Sin noches vendidas en el período"
          message="No hay tarifas para calcular ADR entre las fechas seleccionadas. Probá ampliar el rango." />
        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[520px] text-xs tbl-head">
            <thead><tr>
              <th class="text-left px-4 py-3 text-[10px]">Tipo</th>
              <th class="text-right px-4 py-3 text-[10px]">Noches vendidas</th>
              <th class="text-right px-4 py-3 text-[10px]">Revenue</th>
              <th class="text-right px-4 py-3 text-[10px]">ADR</th>
            </tr></thead>
            <tbody>
              <tr v-for="(v, type) in (data as RendimientoReport).adrByType" :key="type" class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
                <td class="px-4 py-2.5 text-navy font-bold">{{ type }}</td>
                <td class="px-4 py-2.5 text-right tabular-nums">{{ v.nights }}</td>
                <td class="px-4 py-2.5 text-right tabular-nums">{{ formatMoney(v.revenue) }}</td>
                <td class="px-4 py-2.5 text-right font-bold text-cyan tabular-nums">{{ formatMoney(v.adr) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>

    <!-- Procedencia -->
    <div v-else-if="activeTab === 'procedencia' && data" class="space-y-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <KpiHeroCard label="Países" :value="(data as ProcedenciaReport).byCountry.length"
          icon="users" accent="blue"
          :unit="(data as ProcedenciaReport).byCountry[0]?.country
            ? `Top: ${(data as ProcedenciaReport).byCountry[0].country}`
            : 'Procedencias distintas'" />
        <KpiHeroCard label="Canales" :value="(data as ProcedenciaReport).byChannel.length"
          icon="bookings" accent="purple" unit="Fuentes de reserva activas" />
        <KpiHeroCard label="Revenue total" :value="procTotalRevenue"
          icon="money" accent="teal" prefix="$" unit="Suma de todos los canales" />
      </div>
      <SectionCard title="Revenue por canal" subtitle="Peso relativo de cada fuente" body-class="p-0">
        <EmptyState v-if="(data as ProcedenciaReport).byChannel.length === 0"
          :icon="ICON_SHARE" title="Sin canales en el período"
          message="No hay reservas por canal entre las fechas seleccionadas. Probá ampliar el rango." />
        <div v-else class="space-y-2.5 p-4 sm:p-5">
          <div v-for="c in (data as ProcedenciaReport).byChannel" :key="c.channel" class="flex items-center gap-3 text-xs">
            <span class="w-24 shrink-0 text-navy font-bold capitalize truncate">{{ c.channel }}</span>
            <div class="flex-1 h-2 bg-surface rounded-full overflow-hidden">
              <div class="h-full bg-cyan rounded-full transition-[width] duration-500" :style="{ width: Math.round((c.revenue / procMaxChannelRevenue) * 100) + '%' }"></div>
            </div>
            <span class="w-24 shrink-0 text-right text-text-secondary tabular-nums">{{ formatMoney(c.revenue) }}</span>
          </div>
        </div>
      </SectionCard>
      <div class="grid md:grid-cols-2 gap-4">
        <SectionCard title="Por país" :subtitle="`${(data as ProcedenciaReport).byCountry.length} procedencia(s)`" body-class="p-0">
          <EmptyState v-if="(data as ProcedenciaReport).byCountry.length === 0"
            :icon="ICON_PIN" title="Sin procedencias en el período"
            message="No hay huéspedes con país registrado entre las fechas seleccionadas." />
          <div v-else class="overflow-x-auto">
            <table class="w-full min-w-[380px] text-xs tbl-head">
              <thead><tr>
                <th class="text-left px-4 py-3 text-[10px]">País</th>
                <th class="text-right px-4 py-3 text-[10px]">Huéspedes</th>
                <th class="text-right px-4 py-3 text-[10px]">Revenue</th>
              </tr></thead>
              <tbody>
                <tr v-for="c in (data as ProcedenciaReport).byCountry" :key="c.country" class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
                  <td class="px-4 py-2.5 text-navy font-bold">{{ c.country }}</td>
                  <td class="px-4 py-2.5 text-right tabular-nums">{{ c.guests }}</td>
                  <td class="px-4 py-2.5 text-right tabular-nums">{{ formatMoney(c.revenue) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </SectionCard>
        <SectionCard title="Por canal" :subtitle="`${(data as ProcedenciaReport).byChannel.length} canal(es)`" body-class="p-0">
          <EmptyState v-if="(data as ProcedenciaReport).byChannel.length === 0"
            :icon="ICON_SHARE" title="Sin canales en el período"
            message="No hay reservas por canal entre las fechas seleccionadas." />
          <div v-else class="overflow-x-auto">
            <table class="w-full min-w-[380px] text-xs tbl-head">
              <thead><tr>
                <th class="text-left px-4 py-3 text-[10px]">Canal</th>
                <th class="text-right px-4 py-3 text-[10px]">Reservas</th>
                <th class="text-right px-4 py-3 text-[10px]">Revenue</th>
              </tr></thead>
              <tbody>
                <tr v-for="c in (data as ProcedenciaReport).byChannel" :key="c.channel" class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
                  <td class="px-4 py-2.5 text-navy font-bold capitalize">{{ c.channel }}</td>
                  <td class="px-4 py-2.5 text-right tabular-nums">{{ c.count }}</td>
                  <td class="px-4 py-2.5 text-right tabular-nums">{{ formatMoney(c.revenue) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>
    </div>

    <!-- Reservas -->
    <div v-else-if="activeTab === 'reservas' && data" class="space-y-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiHeroCard label="Total" :value="(data as ReservasReport).total"
          icon="bookings" accent="blue" unit="Reservas del período" />
        <KpiHeroCard label="OTA" :value="(data as ReservasReport).otaVsDirect.ota"
          icon="users" accent="purple" :progress="(data as ReservasReport).otaVsDirect.otaPct"
          :unit="`${(data as ReservasReport).otaVsDirect.otaPct}% del total`" />
        <KpiHeroCard label="Directas" :value="(data as ReservasReport).otaVsDirect.direct"
          icon="checkin" accent="teal" :progress="(data as ReservasReport).otaVsDirect.directPct"
          :unit="`${(data as ReservasReport).otaVsDirect.directPct}% del total`" />
        <KpiHeroCard label="Canceladas" :value="(data as ReservasReport).cancelled"
          icon="checkout" accent="rose" :progress="(data as ReservasReport).cancellationRate"
          :unit="`${(data as ReservasReport).cancellationRate}% de cancelación`" />
      </div>
      <div class="grid md:grid-cols-2 gap-4">
        <SectionCard title="Por estado" subtitle="Reservas agrupadas" body-class="p-0">
          <EmptyState v-if="Object.keys((data as ReservasReport).byStatus).length === 0"
            :icon="ICON_CHECK" title="Sin reservas en el período"
            message="No hay reservas entre las fechas seleccionadas. Probá ampliar el rango." />
          <div v-else class="divide-y divide-border p-4 sm:p-5">
            <div v-for="(cnt, status) in (data as ReservasReport).byStatus" :key="status" class="flex items-center justify-between gap-3 text-xs py-2 first:pt-0 last:pb-0">
              <span class="text-navy font-bold capitalize">{{ status }}</span>
              <span class="text-text-secondary tabular-nums">{{ cnt }}</span>
            </div>
          </div>
        </SectionCard>
        <SectionCard title="Por canal" subtitle="Origen de las reservas" body-class="p-0">
          <EmptyState v-if="Object.keys((data as ReservasReport).byChannel).length === 0"
            :icon="ICON_SHARE" title="Sin canales en el período"
            message="No hay reservas con canal registrado entre las fechas seleccionadas." />
          <div v-else class="divide-y divide-border p-4 sm:p-5">
            <div v-for="(cnt, ch) in (data as ReservasReport).byChannel" :key="ch" class="flex items-center justify-between gap-3 text-xs py-2 first:pt-0 last:pb-0">
              <span class="text-navy font-bold capitalize">{{ ch }}</span>
              <span class="text-text-secondary tabular-nums">{{ cnt }}</span>
            </div>
          </div>
        </SectionCard>
      </div>
      <BarChart :data="series((data as ReservasReport).dailyCreated)" :format="String" :label="longRange ? 'Reservas creadas por mes' : 'Reservas creadas por día'" />
    </div>

    <div v-else-if="!loading && !data" class="rounded-2xl border border-border bg-white shadow-(--shadow-card) overflow-hidden">
      <EmptyState :icon="ICON_CHART" title="Sin datos en el período seleccionado"
        message="No hay información para este reporte entre las fechas elegidas. Probá con un rango más amplio.">
        <template #action>
          <button @click="setRange('thisYear')"
            class="rounded-full border border-border px-5 py-2.5 text-sm font-bold text-navy hover:bg-surface transition-colors cursor-pointer">
            Ver todo el año
          </button>
        </template>
      </EmptyState>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ReportsService, REPORT_META } from '@/services/Reports.service'
import type { ReportType, BalanceReport, FacturacionReport, OcupacionReport, PernotacionesReport, RendimientoReport, ProcedenciaReport, ReservasReport, AnyReport } from '@/services/Reports.service'

const METHOD_LABEL: Record<string, string> = {
  cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia',
  link: 'Link de pago', deposit: 'Depósito', other: 'Otro',
}

const CATEGORY_LABEL: Record<string, string> = {
  general: 'General', supplies: 'Suministros', maintenance: 'Mantenimiento',
  cleaning: 'Limpieza', staff: 'Personal', marketing: 'Marketing', utilities: 'Servicios',
}
import { useToast } from '@/composables/useToast'
import BarChart from '@/components/features/core-pms/BarChart.vue'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { CurrencyCode } from '@/types/currency'

const ICON_WALLET = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M21 12V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1.5M21 12h-4a1.5 1.5 0 0 0 0 3h4v-3Z"/></svg>'
const ICON_CHART = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M3 3v18h18M8 17V10m5 7V6m5 11v-4"/></svg>'
const ICON_BED = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6M3 18v2M21 18v2M3 12V8a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m5-2h4a1 1 0 0 1 1 1v2"/></svg>'
const ICON_TRENDING = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M3 17.25 9 11.25l4 4 8-8M16.5 7.25H21v4.5"/></svg>'
const ICON_GLOBE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0 0c2.25 0 4-4 4-9s-1.75-9-4-9-4 4-4 9 1.75 9 4 9ZM3.5 9h17M3.5 15h17"/></svg>'
const ICON_CALENDAR = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3.75 8.25h16.5M4.5 6h15a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-15a.75.75 0 0 1-.75-.75V6.75A.75.75 0 0 1 4.5 6Z"/></svg>'
const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>'
const ICON_TAG = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.169.659 1.591l9.5 9.5a2.25 2.25 0 0 0 3.182 0l4.318-4.318a2.25 2.25 0 0 0 0-3.182l-9.5-9.5A2.25 2.25 0 0 0 9.568 3Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 6.75h.008v.008H6.75V6.75Z"/></svg>'
const ICON_RECEIPT = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m1 5H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l4.414 4.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2Z"/></svg>'
const ICON_CHECK = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>'
const ICON_PIN = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z"/></svg>'
const ICON_SHARE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z"/></svg>'

const TAB_ICON_MAP: Record<string, string> = {
  wallet: ICON_WALLET,
  chart: ICON_CHART,
  bed: ICON_BED,
  trending: ICON_TRENDING,
  globe: ICON_GLOBE,
  calendar: ICON_CALENDAR,
}

const toast = useToast()

const activeTab = ref<ReportType>('facturacion')
const data = ref<AnyReport | null>(null)
const loading = ref(false)
type RangeOption = 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'thisYear' | 'custom'
const range = ref<RangeOption>('thisMonth')
const from = ref('')
const to = ref('')

const RANGE_OPTIONS: { value: RangeOption; label: string }[] = [
  { value: 'thisMonth', label: 'Este mes' },
  { value: 'lastMonth', label: 'Mes pasado' },
  { value: 'thisQuarter', label: 'Este trimestre' },
  { value: 'thisYear', label: 'Este año' },
  { value: 'custom', label: 'Personalizado' },
]

function setRange(r: RangeOption) {
  range.value = r
  onRangeChange()
}

function computeRange() {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  if (range.value === 'thisMonth') {
    from.value = new Date(y, m, 1).toISOString().slice(0, 10)
    to.value = new Date(y, m + 1, 0).toISOString().slice(0, 10)
  } else if (range.value === 'lastMonth') {
    from.value = new Date(y, m - 1, 1).toISOString().slice(0, 10)
    to.value = new Date(y, m, 0).toISOString().slice(0, 10)
  } else if (range.value === 'thisQuarter') {
    const q = Math.floor(m / 3)
    from.value = new Date(y, q * 3, 1).toISOString().slice(0, 10)
    to.value = new Date(y, q * 3 + 3, 0).toISOString().slice(0, 10)
  } else if (range.value === 'thisYear') {
    from.value = new Date(y, 0, 1).toISOString().slice(0, 10)
    to.value = new Date(y, 11, 31).toISOString().slice(0, 10)
  }
}

function onRangeChange() {
  if (range.value !== 'custom') {
    computeRange()
    load()
  }
}

async function load() {
  if (!from.value || !to.value) computeRange()
  loading.value = true
  data.value = null
  try {
    data.value = await ReportsService.get<AnyReport>(activeTab.value, { from: from.value, to: to.value })
  } catch (e: any) {
    toast.error(e.message || 'Error al cargar reporte')
  } finally {
    loading.value = false
  }
}

async function changeTab(t: ReportType) {
  activeTab.value = t
  await load()
}

async function exportCsv() {
  try {
    await ReportsService.exportCsv(activeTab.value, { from: from.value, to: to.value })
    toast.success('CSV exportado')
  } catch (e: any) {
    toast.error(e.message || 'Error al exportar')
  }
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: CurrencyCode.USD, minimumFractionDigits: 0 }).format(n || 0)
}

// PC-1.2.5 — evolución mensual cuando el rango es largo (>90 días), diario en el resto.
const longRange = computed(() => {
  if (!from.value || !to.value) return false
  return Math.round((new Date(to.value).getTime() - new Date(from.value).getTime()) / 86_400_000) > 90
})

function series(points: { date: string; value: number }[], mode: 'sum' | 'avg' = 'sum'): { date: string; value: number }[] {
  if (!longRange.value || points.length === 0) return points
  const buckets: Record<string, number[]> = {}
  for (const p of points) {
    const mk = p.date.slice(0, 7)
    ;(buckets[mk] ||= []).push(p.value)
  }
  return Object.entries(buckets)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, vals]) => ({
      date,
      value: mode === 'avg'
        ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length)
        : vals.reduce((s, v) => s + v, 0),
    }))
}

const chartGranularity = computed(() => longRange.value ? 'meses' : 'días')

// Ocupación — medias diarias para KPIs extra (PC-1.2.4)
const ocupAvgOccupied = computed(() => {
  const d = (data.value as OcupacionReport | null)?.daily
  if (!d || d.length === 0) return 0
  return Math.round(d.reduce((s, x) => s + x.occupied, 0) / d.length)
})
const ocupAvgFree = computed(() => {
  const d = (data.value as OcupacionReport | null)?.daily
  if (!d || d.length === 0) return 0
  return Math.round(d.reduce((s, x) => s + x.free, 0) / d.length)
})

// Procedencia — agregados para KPIs + chart de canales (PC-1.2.4/1.2.5)
const procTotalRevenue = computed(() =>
  (data.value as ProcedenciaReport | null)?.byChannel.reduce((s, c) => s + (c.revenue || 0), 0) ?? 0)
const procMaxChannelRevenue = computed(() =>
  Math.max(1, ...((data.value as ProcedenciaReport | null)?.byChannel.map(c => c.revenue || 0) ?? [1])))

function formatDate(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
}

onMounted(() => {
  computeRange()
  load()
})
</script>
