<template>
  <div>
    <!-- Header -->
    <div class="flex items-center justify-between gap-3 flex-wrap mb-6">
      <div>
        <h2 class="text-xl font-black text-navy">Asistencia y Ponche Digital</h2>
        <p class="text-sm text-text-muted mt-0.5">Fichaje de entrada/salida, horarios y reportes</p>
      </div>
    </div>

    <!-- Tabs -->
    <div class="flex gap-2 mb-6 flex-wrap">
      <button v-for="tab in tabs" :key="tab.value" @click="activeTab = tab.value"
        class="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold transition-all cursor-pointer"
        :class="activeTab === tab.value ? 'bg-navy text-white' : 'bg-white text-text-secondary border border-border hover:border-navy/30'">
        <span class="w-4 h-4 shrink-0" v-html="tab.icon"></span>
        {{ tab.label }}
      </button>
    </div>

    <!-- Loading (skeleton) -->
    <div v-if="loading" class="space-y-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div v-for="i in 4" :key="i" class="h-28 animate-pulse rounded-2xl bg-surface"></div>
      </div>
      <div class="h-64 animate-pulse rounded-2xl bg-surface"></div>
    </div>

    <!-- ─── Ponche Digital ─────────────────────────────── -->
    <div v-if="activeTab === 'clock' && !loading" class="max-w-xl mx-auto">
      <SectionCard title="Ponche Digital" :subtitle="today">
        <template #actions>
          <button @click="showSupervisorTools = true"
            class="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-[11px] font-bold text-white hover:bg-white/20 transition-colors cursor-pointer">
            <span class="h-3.5 w-3.5 shrink-0" v-html="ICON_USERS"></span>
            Fichaje manual
          </button>
        </template>

        <div class="text-center">
          <div class="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center"
            :class="todayRecord?.clockIn && !todayRecord?.clockOut ? 'bg-cyan/10 text-cyan' : todayRecord?.clockOut ? 'bg-teal/10 text-teal' : 'bg-navy/5 text-navy/40'">
            <span class="w-9 h-9 shrink-0" :class="todayRecord?.clockIn && !todayRecord?.clockOut ? 'animate-pulse' : ''" v-html="todayRecord?.clockOut ? ICON_CHECK_CIRCLE : ICON_CLOCK"></span>
          </div>
          <div class="text-3xl font-black text-navy tabular-nums mb-1">{{ now }}</div>
          <div class="text-sm text-text-secondary mb-6 capitalize">{{ today }}</div>

          <!-- Método selector -->
          <div v-if="!todayRecord?.clockIn" class="mb-6">
            <div class="text-[10px] font-bold uppercase tracking-wide text-text-muted mb-3">Método de fichaje</div>
            <div class="grid grid-cols-4 gap-2">
              <button v-for="m in methods" :key="m.value" @click="selectedMethod = m.value"
                class="p-3 rounded-xl border-2 text-center transition-all cursor-pointer"
                :class="selectedMethod === m.value ? 'border-navy bg-navy/5 shadow-md' : 'border-border hover:border-navy/30'">
                <span class="w-5 h-5 mx-auto mb-1 block" :class="selectedMethod === m.value ? 'text-navy' : 'text-text-muted'" v-html="m.icon"></span>
                <div class="text-[9px] font-bold" :class="selectedMethod === m.value ? 'text-navy' : 'text-text-muted'">{{ m.label }}</div>
              </button>
            </div>
          </div>

          <!-- Camera for facial -->
          <div v-if="!todayRecord?.clockIn && selectedMethod === 'facial' && !showCamera" class="mb-4 p-4 bg-surface rounded-xl text-center cursor-pointer hover:bg-navy/5 transition-colors" @click="showCamera = true">
            <span class="w-8 h-8 mx-auto mb-2 text-navy block" v-html="ICON_CAMERA"></span>
            <div class="text-sm font-bold text-navy">Tocar para abrir cámara</div>
            <div class="text-[10px] text-text-muted mt-1">Se verificará tu rostro contra tu foto de perfil</div>
          </div>

          <CameraCapture v-if="!todayRecord?.clockIn && selectedMethod === 'facial' && showCamera" @verify="onFacialVerify" @close="showCamera = false" />

          <!-- Fingerprint info -->
          <div v-if="!todayRecord?.clockIn && selectedMethod === 'fingerprint'" class="mb-4 p-4 bg-surface rounded-xl text-center">
            <span class="w-8 h-8 mx-auto mb-2 text-navy block" v-html="ICON_FINGERPRINT"></span>
            <div class="text-sm font-bold text-navy">Colocá tu dedo en el lector</div>
            <div class="text-[10px] text-text-muted mt-1">Esperando señal del dispositivo ZKTeco...</div>
            <div class="w-6 h-6 mt-3 mx-auto border-2 border-navy/20 border-t-navy rounded-full animate-spin"></div>
          </div>

          <!-- PIN input -->
          <div v-if="!todayRecord?.clockIn && selectedMethod === 'pin'" class="mb-4">
            <label class="block text-[10px] font-bold uppercase tracking-wide text-text-muted mb-2">Código PIN</label>
            <input v-model="pinCode" type="password" maxlength="6" placeholder="PIN" class="w-32 mx-auto block text-center px-4 py-3 rounded-xl border-2 border-navy/20 text-xl font-bold tracking-widest focus:outline-none focus:border-navy text-navy">
          </div>

          <!-- Resumen del día — solo los datos que existen (nada de "—") -->
          <div v-if="todayRecord && todayFacts.length" class="mb-6 p-4 bg-surface rounded-xl">
            <div v-if="todayMethodLabel" class="flex items-center justify-center gap-2 mb-3">
              <span class="w-4 h-4 text-navy shrink-0" v-html="todayMethodIcon"></span>
              <span class="text-[10px] font-bold uppercase tracking-wide text-text-muted">{{ todayMethodLabel }}</span>
            </div>
            <div class="grid grid-cols-2 gap-3 text-left">
              <div v-for="f in todayFacts" :key="f.label" class="flex items-center gap-2">
                <span class="w-4 h-4 shrink-0" :class="f.tone" v-html="f.icon"></span>
                <div class="min-w-0">
                  <span class="block text-[10px] font-bold uppercase tracking-wide text-text-muted">{{ f.label }}</span>
                  <span class="text-sm font-bold tabular-nums" :class="f.valueTone || 'text-navy'">{{ f.value }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="space-y-3">
            <button v-if="!todayRecord?.clockIn" @click="doClockIn"
              class="w-full flex items-center justify-center gap-2 py-4 bg-teal text-white rounded-2xl text-lg font-extrabold hover:bg-teal-light transition-all cursor-pointer shadow-lg">
              <span class="w-5 h-5 shrink-0" v-html="ICON_CLOCK"></span>Fichar Entrada
            </button>
            <button v-if="todayRecord?.clockIn && !todayRecord?.clockOut && !todayRecord?.breakStart" @click="doStartBreak"
              class="w-full flex items-center justify-center gap-2 py-3 bg-gold/20 text-gold rounded-xl text-sm font-bold hover:bg-gold/30 transition-all cursor-pointer">
              <span class="w-4 h-4 shrink-0" v-html="ICON_COFFEE"></span>Iniciar Descanso
            </button>
            <button v-if="todayRecord?.breakStart && !todayRecord?.breakEnd" @click="doEndBreak"
              class="w-full flex items-center justify-center gap-2 py-3 bg-gold/20 text-gold rounded-xl text-sm font-bold hover:bg-gold/30 transition-all cursor-pointer">
              <span class="w-4 h-4 shrink-0" v-html="ICON_COFFEE"></span>Terminar Descanso
            </button>
            <button v-if="todayRecord?.clockIn && !todayRecord?.clockOut" @click="doClockOut"
              class="w-full flex items-center justify-center gap-2 py-4 bg-coral text-white rounded-2xl text-lg font-extrabold hover:bg-coral/80 transition-all cursor-pointer shadow-lg">
              <span class="w-5 h-5 shrink-0" v-html="ICON_HOME"></span>Fichar Salida
            </button>
            <div v-if="todayRecord?.clockOut" class="flex items-center justify-center gap-2 py-4 bg-teal/10 rounded-xl">
              <span class="w-4 h-4 text-teal shrink-0" v-html="ICON_CHECK_CIRCLE"></span>
              <span class="text-teal font-bold text-sm">Jornada completada</span>
            </div>
          </div>
        </div>
      </SectionCard>
    </div>

    <!-- ─── Horarios ───────────────────────────────────── -->
    <SectionCard v-if="activeTab === 'schedules' && !loading"
      title="Horarios y Turnos" :subtitle="`${schedules.length} turno(s) configurado(s)`" body-class="p-0">
      <template #actions>
        <button @click="openNewSchedule"
          class="flex items-center gap-1.5 rounded-lg bg-cyan px-3 py-2 text-[11px] font-extrabold text-navy hover:shadow-lg transition-all cursor-pointer">
          <span class="h-3 w-3 shrink-0" v-html="ICON_PLUS"></span>Nuevo Turno
        </button>
      </template>

      <EmptyState v-if="schedules.length === 0" :icon="ICON_CALENDAR"
        title="Todavía no hay turnos"
        message="Creá el primer turno para poder armar el calendario y medir tardanzas.">
        <template #action>
          <button @click="openNewSchedule"
            class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">Nuevo turno</button>
        </template>
      </EmptyState>

      <div v-else class="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div v-for="s in schedules" :key="s.id" class="p-4 bg-surface rounded-xl">
          <div class="flex items-start justify-between gap-2 mb-2">
            <div class="font-extrabold text-navy text-sm truncate">{{ s.name }}</div>
            <button @click="deleteSchedule(s)" title="Eliminar turno"
              class="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-coral hover:bg-coral/10 transition-colors cursor-pointer">
              <span class="h-4 w-4" v-html="ICON_TRASH"></span>
            </button>
          </div>
          <div class="space-y-1">
            <div class="flex items-center gap-1.5 text-xs text-text-secondary"><span class="w-3.5 h-3.5 text-navy shrink-0" v-html="ICON_CLOCK"></span><span class="tabular-nums">{{ s.startTime }} → {{ s.endTime }}</span></div>
            <div class="flex items-center gap-1.5 text-xs text-text-secondary"><span class="w-3.5 h-3.5 text-gold shrink-0" v-html="ICON_COFFEE"></span><span class="tabular-nums">{{ s.breakMinutes }}min</span> descanso</div>
            <div class="flex items-center gap-1.5 text-xs text-text-secondary"><span class="w-3.5 h-3.5 text-cyan shrink-0" v-html="ICON_ALARM"></span><span class="tabular-nums">{{ s.graceMinutes }}min</span> tolerancia</div>
          </div>
        </div>
      </div>
    </SectionCard>

    <!-- ─── Reportes ───────────────────────────────────── -->
    <div v-if="activeTab === 'reports' && !loading" class="space-y-4">
      <div v-if="report.length" class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiHeroCard label="Días Trabajados" :value="reportTotals.days" icon="bookings" accent="blue"
          unit="Sumatoria del período" />
        <KpiHeroCard label="Horas Totales" :value="reportTotals.hours" icon="checkin" accent="teal"
          suffix="h" unit="Horas registradas" />
        <KpiHeroCard label="Horas Extra" :value="reportTotals.overtime" icon="money" accent="amber"
          suffix="h" unit="Por encima del turno" />
        <KpiHeroCard label="Faltas" :value="reportTotals.absences" icon="users" accent="rose"
          unit="Ausencias del período" />
      </div>

      <SectionCard title="Reporte de Asistencia"
        :subtitle="report.length ? `${report.length} empleado(s) en el rango` : 'Elegí un rango de fechas'"
        body-class="p-0">
        <template #actions>
          <input v-model="reportFrom" type="date"
            class="px-3 py-2 rounded-lg border border-white/15 bg-white/10 text-sm font-semibold text-white focus:outline-none focus:border-cyan cursor-pointer">
          <input v-model="reportTo" type="date"
            class="px-3 py-2 rounded-lg border border-white/15 bg-white/10 text-sm font-semibold text-white focus:outline-none focus:border-cyan cursor-pointer">
          <button @click="loadReport"
            class="flex items-center gap-1.5 rounded-lg bg-cyan px-3 py-2 text-[11px] font-extrabold text-navy hover:shadow-lg transition-all cursor-pointer">
            <span class="h-3.5 w-3.5 shrink-0" v-html="ICON_CHART"></span>Generar
          </button>
        </template>

        <EmptyState v-if="!report.length && reportLoaded" :icon="ICON_CHART"
          title="Sin movimientos en el rango"
          message="No hay fichajes entre esas fechas. Probá con un período más amplio." />
        <EmptyState v-else-if="!report.length" :icon="ICON_CHART"
          title="Todavía no generaste el reporte"
          message="Seleccioná un rango de fechas arriba y tocá Generar." />

        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[720px] tbl-head">
            <thead>
              <tr>
                <th class="text-left px-4 py-3 text-[10px]">Empleado</th>
                <th class="text-right px-4 py-3 text-[10px]">Días</th>
                <th class="text-right px-4 py-3 text-[10px]">Horas</th>
                <th class="text-right px-4 py-3 text-[10px] hidden lg:table-cell">Extra</th>
                <th class="text-right px-4 py-3 text-[10px] hidden lg:table-cell">Faltas</th>
                <th class="text-right px-4 py-3 text-[10px]">Tarde</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in report" :key="r.employeeId" class="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
                <td class="px-4 py-3">
                  <div class="text-sm font-bold text-navy">{{ getEmployeeName(r.employeeId) }}</div>
                  <div class="text-[11px] text-text-muted lg:hidden tabular-nums">
                    {{ r.overtimeHours }}h extra · {{ r.absences }} falta(s)
                  </div>
                </td>
                <td class="px-4 py-3 text-right text-sm text-text-secondary tabular-nums">{{ r.daysWorked }}</td>
                <td class="px-4 py-3 text-right text-sm font-extrabold text-navy tabular-nums">{{ r.hoursWorked }}h</td>
                <td class="px-4 py-3 text-right text-sm font-bold text-gold tabular-nums hidden lg:table-cell">{{ r.overtimeHours }}h</td>
                <td class="px-4 py-3 text-right hidden lg:table-cell">
                  <span class="rounded-full px-2.5 py-1 text-[10px] font-extrabold tabular-nums"
                    :class="r.absences > 0 ? 'bg-coral/10 text-coral' : 'bg-teal/10 text-teal'">{{ r.absences }}</span>
                </td>
                <td class="px-4 py-3 text-right">
                  <span class="rounded-full px-2.5 py-1 text-[10px] font-extrabold tabular-nums"
                    :class="r.lateArrivals > 0 ? 'bg-gold/10 text-gold' : 'bg-teal/10 text-teal'">{{ r.lateArrivals }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>

    <!-- ─── Calendario de Turnos ───────────────────────── -->
    <SectionCard v-if="activeTab === 'calendar' && !loading"
      title="Calendario de Turnos" :subtitle="`${weekDays[0]} → ${weekDays[6]}`" body-class="p-0">
      <template #actions>
        <div class="flex items-center gap-1">
          <button @click="shiftWeek(-7)" title="Semana anterior"
            class="grid h-8 w-8 place-items-center rounded-lg border border-white/15 bg-white/10 text-white hover:bg-white/20 transition-colors cursor-pointer">‹</button>
          <button @click="shiftWeek(7)" title="Semana siguiente"
            class="grid h-8 w-8 place-items-center rounded-lg border border-white/15 bg-white/10 text-white hover:bg-white/20 transition-colors cursor-pointer">›</button>
        </div>
        <select v-model="paintScheduleId"
          class="px-3 py-2 rounded-lg border border-white/15 bg-white/10 text-sm font-semibold text-white focus:outline-none focus:border-cyan cursor-pointer">
          <option class="text-navy" value="" disabled>Turno a pintar</option>
          <option class="text-navy" v-for="s in schedules" :key="s.id" :value="s.id">{{ s.name }} ({{ s.startTime }}-{{ s.endTime }})</option>
        </select>
      </template>

      <EmptyState v-if="!schedules.length" :icon="ICON_CALENDAR"
        title="Sin turnos para asignar"
        message="Creá al menos un turno en la pestaña Horarios antes de armar el calendario.">
        <template #action>
          <button @click="activeTab = 'schedules'"
            class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">Ir a Horarios</button>
        </template>
      </EmptyState>

      <EmptyState v-else-if="!profiles.length" :icon="ICON_USERS"
        title="Sin empleados con legajo"
        message="Cargá los legajos en la sección Empleados para poder asignarles turnos." />

      <div v-else>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[720px] border-collapse tbl-head">
            <thead>
              <tr>
                <th class="text-left px-3 py-3 text-[10px] sticky left-0 bg-surface">Empleado</th>
                <th v-for="(d, i) in weekDays" :key="d" class="px-2 py-3 text-[10px] text-center whitespace-nowrap">
                  {{ WEEKDAY_LABELS[i] }}<br><span class="tabular-nums opacity-60">{{ d.slice(8) }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in profiles" :key="p.id" class="border-b border-border last:border-0">
                <td class="px-3 py-2 text-sm font-bold text-navy whitespace-nowrap sticky left-0 bg-white">{{ p.userName || p.position || p.id.slice(0,6) }}</td>
                <td v-for="d in weekDays" :key="d" class="px-1.5 py-1.5 text-center">
                  <button @click="onCell(p, d)"
                    :title="cellFor(p.id, d) ? 'Quitar turno' : 'Asignar turno'"
                    class="w-full min-h-[34px] rounded-lg text-[10px] font-bold px-1 py-1 transition-colors cursor-pointer"
                    :class="cellFor(p.id, d) ? 'bg-cyan/15 text-navy hover:bg-coral/15' : 'bg-surface text-text-muted/50 hover:bg-navy/5'">
                    {{ cellFor(p.id, d) ? scheduleName(cellFor(p.id, d)!.scheduleId) : '+' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="border-t border-border px-4 py-3 text-[11px] text-text-muted">
          Elegí un turno arriba y hacé click en una celda para asignarlo. Click en una celda asignada para quitar el turno.
        </p>
      </div>
    </SectionCard>

    <!-- ─── Modal: fichaje manual (supervisor) ─────────── -->
    <AppModal v-if="showSupervisorTools" size="lg" title="Fichaje manual"
      subtitle="Herramienta de supervisor" @close="showSupervisorTools = false">
      <div class="space-y-4">
        <div>
          <label class="block text-[10px] font-bold uppercase tracking-wide text-text-muted mb-1.5">Empleado</label>
          <input v-model="manualForm.employeeId" placeholder="ID del empleado" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy">
        </div>
        <div class="grid sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-[10px] font-bold uppercase tracking-wide text-text-muted mb-1.5">Hora de entrada</label>
            <input v-model="manualForm.clockIn" type="datetime-local" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy">
          </div>
          <div>
            <label class="block text-[10px] font-bold uppercase tracking-wide text-text-muted mb-1.5">Hora de salida <span class="normal-case font-normal text-text-muted/70">(opcional)</span></label>
            <input v-model="manualForm.clockOut" type="datetime-local" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy">
          </div>
        </div>
        <div>
          <label class="block text-[10px] font-bold uppercase tracking-wide text-text-muted mb-1.5">Motivo</label>
          <input v-model="manualForm.notes" placeholder="Ej: Olvidó marcar entrada, dispositivo sin conexión..." class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy">
        </div>
      </div>
      <template #footer>
        <button @click="showSupervisorTools = false"
          class="rounded-full px-5 py-2.5 text-sm font-bold text-text-secondary hover:bg-white transition-colors cursor-pointer">Cancelar</button>
        <button @click="doManualRecord"
          class="flex items-center gap-2 rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer">
          <span class="h-4 w-4 shrink-0" v-html="ICON_CHECK_CIRCLE"></span>Registrar
        </button>
      </template>
    </AppModal>

    <!-- ─── Modal: nuevo turno ─────────────────────────── -->
    <AppModal v-if="scheduleModal" size="lg" title="Nuevo Turno"
      subtitle="Horario, descanso y tolerancia" @close="scheduleModal = false">
      <div class="space-y-4">
        <div>
          <label class="block text-[10px] font-bold uppercase tracking-wide text-text-muted mb-1.5">Nombre del turno</label>
          <input v-model="scheduleForm.name" placeholder="Mañana" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm focus:outline-none focus:border-navy">
        </div>
        <div class="grid sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-[10px] font-bold uppercase tracking-wide text-text-muted mb-1.5">Hora inicio</label>
            <input v-model="scheduleForm.startTime" placeholder="HH:MM" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm tabular-nums focus:outline-none focus:border-navy">
          </div>
          <div>
            <label class="block text-[10px] font-bold uppercase tracking-wide text-text-muted mb-1.5">Hora fin</label>
            <input v-model="scheduleForm.endTime" placeholder="HH:MM" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm tabular-nums focus:outline-none focus:border-navy">
          </div>
          <div>
            <label class="block text-[10px] font-bold uppercase tracking-wide text-text-muted mb-1.5">Descanso (min)</label>
            <input v-model.number="scheduleForm.breakMinutes" type="number" min="0" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm tabular-nums focus:outline-none focus:border-navy">
          </div>
          <div>
            <label class="block text-[10px] font-bold uppercase tracking-wide text-text-muted mb-1.5">Tolerancia (min)</label>
            <input v-model.number="scheduleForm.graceMinutes" type="number" min="0" class="w-full px-4 py-2.5 rounded-xl border border-border text-sm tabular-nums focus:outline-none focus:border-navy">
          </div>
        </div>
      </div>
      <template #footer>
        <button @click="scheduleModal = false"
          class="rounded-full px-5 py-2.5 text-sm font-bold text-text-secondary hover:bg-white transition-colors cursor-pointer">Cancelar</button>
        <button @click="submitSchedule" :disabled="savingSchedule"
          class="rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy-light transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
          {{ savingSchedule ? 'Creando...' : 'Crear Turno' }}
        </button>
      </template>
    </AppModal>

    <ConfirmModal v-if="confirmModal" :title="confirmModal.title" :message="confirmModal.message"
      :confirm-label="confirmModal.confirmLabel" :danger="confirmModal.danger" :loading="confirmBusy"
      @confirm="runConfirm" @close="confirmModal = null" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { AttendanceService, type AttendanceRecord, type AttendanceSchedule, type AttendanceReportRow, type ShiftAssignment } from '@/services/Attendance.service'
import { EmpleadosService, type EmployeeProfile } from '@/services/Empleados.service'
import { useToast } from '@/composables/useToast'
import CameraCapture from '@/components/features/CameraCapture.vue'
import ConfirmModal from '@/components/features/ConfirmModal.vue'
import AppModal from '@/components/ui/AppModal.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import KpiHeroCard from '@/components/features/dashboard/KpiHeroCard.vue'
import { useConfirm } from '@/composables/useConfirm'

const ICON_CLOCK = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>'
const ICON_CHECK_CIRCLE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="m9 12.75 1.5 1.5 3.75-3.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>'
const ICON_CAMERA = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.114-1.132.183-.966.178-1.643 1.024-1.643 1.995v9.092c0 1.286 1.042 2.25 2.25 2.25h15.198c1.208 0 2.25-.964 2.25-2.25V9.408c0-.971-.677-1.817-1.643-1.995a48.108 48.108 0 0 0-1.132-.183 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z"/></svg>'
const ICON_FINGERPRINT = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M7.864 4.243A7.5 7.5 0 0 1 19.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.464 7.464 0 0 0 4.5 10.5a7.464 7.464 0 0 1-1.15 3.993M12 3c1.313 0 2.548.317 3.638.879M12 21c1.83-1.128 3.202-2.812 4.03-4.744m-1.276-3.53a3 3 0 1 0-5.507 2.42c-.166.416-.348.826-.545 1.229M9 12a3.75 3.75 0 0 0-.723 2.212"/></svg>'
const ICON_HASH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M5.25 8.25h13.5M5.25 15.75h13.5M9.75 3.75 6.75 20.25M17.25 3.75l-3 16.5"/></svg>'
const ICON_PHONE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75A2.25 2.25 0 0 0 15.75 1.5H13.5m-3 0V3h3V1.5m-3 0h3m-3 18h3"/></svg>'
const ICON_COFFEE = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.25h13.5v6.75a4.5 4.5 0 0 1-4.5 4.5h-4.5a4.5 4.5 0 0 1-4.5-4.5V8.25Zm13.5 1.5h1.5a2.25 2.25 0 0 1 0 4.5h-1.5M9 3v2.25M12 3v2.25M15 3v2.25"/></svg>'
const ICON_HOME = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="m2.25 12 8.954-8.955a1.5 1.5 0 0 1 2.122 0L22.25 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"/></svg>'
const ICON_LOGIN = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M9 6.75V4.5A1.5 1.5 0 0 1 10.5 3h6A1.5 1.5 0 0 1 18 4.5v15a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 9 19.5v-2.25M12 12h9m0 0-3-3m3 3-3 3"/></svg>'
const ICON_LOGOUT = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M15 6.75V4.5A1.5 1.5 0 0 0 13.5 3h-6A1.5 1.5 0 0 0 6 4.5v15A1.5 1.5 0 0 0 7.5 21h6a1.5 1.5 0 0 0 1.5-1.5v-2.25M21 12h-9m0 0 3-3m-3 3 3 3"/></svg>'
const ICON_CALENDAR = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3.75 8.25h16.5M4.5 6h15a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-15a.75.75 0 0 1-.75-.75V6.75A.75.75 0 0 1 4.5 6Z"/></svg>'
const ICON_CHART = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M3 3v18h18M8 17V10m5 7V6m5 11v-4"/></svg>'
const ICON_PLUS = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>'
const ICON_TRASH = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M6 7.5h12M9.75 7.5v-1.5a1.5 1.5 0 0 1 1.5-1.5h1.5a1.5 1.5 0 0 1 1.5 1.5v1.5m-8.25 0 .75 11.25a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5L17.25 7.5"/></svg>'
const ICON_USERS = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"/></svg>'
const ICON_ALARM = '<svg viewBox="0 0 24 24" class="w-full h-full" fill="none" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-1.5a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-9v1.5m-6.364.879.879.879M20.485 4.257l-.879.879"/></svg>'

const toast = useToast()
const { confirmModal, confirmBusy, askConfirm, runConfirm } = useConfirm({ onDone: () => loadData(), onError: (e) => toast.error(e instanceof Error ? e.message : 'La acción falló') })
const activeTab = ref('clock')
const loading = ref(true)
const now = ref(''); const today = ref('')

const todayRecord = ref<AttendanceRecord | null>(null)
const schedules = ref<AttendanceSchedule[]>([])
const report = ref<AttendanceReportRow[]>([])
const reportLoaded = ref(false)
const reportFrom = ref(''); const reportTo = ref('')
const manualForm = ref({ employeeId: '', clockIn: '', clockOut: '', notes: '' })
const selectedMethod = ref('pin')
const pinCode = ref('')
const showCamera = ref(false)
const showSupervisorTools = ref(false)
const profiles = ref<EmployeeProfile[]>([])

const methods = [
  { value: 'pin', label: 'PIN', icon: ICON_HASH },
  { value: 'facial', label: 'Facial', icon: ICON_CAMERA },
  { value: 'fingerprint', label: 'Huella', icon: ICON_FINGERPRINT },
  { value: 'mobile_gps', label: 'Móvil', icon: ICON_PHONE },
]

const tabs = [
  { value: 'clock', label: 'Ponche Digital', icon: ICON_CLOCK },
  { value: 'calendar', label: 'Calendario', icon: ICON_CALENDAR },
  { value: 'schedules', label: 'Horarios', icon: ICON_CALENDAR },
  { value: 'reports', label: 'Reportes', icon: ICON_CHART },
]

const reportTotals = computed(() => ({
  days: report.value.reduce((s, r) => s + (r.daysWorked || 0), 0),
  hours: report.value.reduce((s, r) => s + (r.hoursWorked || 0), 0),
  overtime: report.value.reduce((s, r) => s + (r.overtimeHours || 0), 0),
  absences: report.value.reduce((s, r) => s + (r.absences || 0), 0),
}))

// El resumen del día se declara como datos: los campos sin valor no se pintan (nada de "—").
const todayMethodLabel = computed(() => methods.find(m => m.value === todayRecord.value?.method)?.label || todayRecord.value?.method || '')
const todayMethodIcon = computed(() => methods.find(m => m.value === todayRecord.value?.method)?.icon || ICON_CLOCK)
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
const todayFacts = computed(() => {
  const r = todayRecord.value
  if (!r) return []
  const facts: { label: string; value: string; icon: string; tone: string; valueTone?: string }[] = []
  if (r.clockIn) facts.push({ label: 'Entrada', value: hhmm(r.clockIn), icon: ICON_LOGIN, tone: 'text-teal' })
  if (r.clockOut) facts.push({ label: 'Salida', value: hhmm(r.clockOut), icon: ICON_LOGOUT, tone: 'text-coral' })
  if (r.breakStart) facts.push({ label: 'Descanso', value: r.breakEnd ? 'Completado' : 'En curso', icon: ICON_COFFEE, tone: 'text-gold' })
  if (r.totalHours !== undefined && r.totalHours !== null) facts.push({ label: 'Horas', value: `${r.totalHours.toFixed(1)}h`, icon: ICON_CLOCK, tone: 'text-teal', valueTone: 'text-teal' })
  return facts
})

function getEmployeeName(employeeId: string): string {
  if (!employeeId) return '—'
  const p = profiles.value.find(x => x.userId === employeeId || x.id === employeeId)
  return p?.userName || p?.position || employeeId.slice(0, 8)
}

function updateClock() { const d = new Date(); now.value = d.toLocaleTimeString('es'); today.value = d.toLocaleDateString('es', { weekday:'long', day:'numeric', month:'long' }) }

async function loadData() {
  loading.value = true
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}')
    const empId = user.id || 'e1'
    const [rec, sch, profRes] = await Promise.allSettled([AttendanceService.getToday(empId), AttendanceService.listSchedules(), EmpleadosService.listProfiles()])
    todayRecord.value = rec.status === 'fulfilled' ? rec.value : null
    schedules.value = sch.status === 'fulfilled' ? sch.value : []
    profiles.value = profRes.status === 'fulfilled' ? (profRes.value.data ?? []) : []
  } catch { toast.error('No se pudieron cargar los datos de asistencia') }
  finally { loading.value = false }
}

onMounted(() => { updateClock(); setInterval(updateClock, 10000); loadData() })

// Clock actions
function getEmpId() { return JSON.parse(localStorage.getItem('user') || '{}').id || 'e1' }

async function doClockIn() { try { todayRecord.value = await AttendanceService.clockIn(getEmpId(), selectedMethod.value); toast.success('Entrada registrada (' + (methods.find(m => m.value === selectedMethod.value)?.label || '') + ')') } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Error al fichar') } }

async function onFacialVerify(success: boolean) {
  showCamera.value = false
  if (success) { await doClockIn() }
  else { toast.error('Rostro no verificado. Intentá de nuevo o usá otro método.') }
}
async function doClockOut() { try { todayRecord.value = await AttendanceService.clockOut(getEmpId()); toast.success('Salida registrada') } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Error') } }
async function doStartBreak() { try { todayRecord.value = await AttendanceService.startBreak(getEmpId()); toast.info('Descanso iniciado') } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Error') } }
async function doEndBreak() { try { todayRecord.value = await AttendanceService.endBreak(getEmpId()); toast.info('Descanso finalizado') } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Error') } }
async function doManualRecord() {
  if (!manualForm.value.employeeId || !manualForm.value.clockIn) { toast.warning('ID empleado y hora entrada requeridos'); return }
  try { await AttendanceService.manualRecord(manualForm.value); toast.success('Fichaje manual registrado'); manualForm.value = { employeeId: '', clockIn: '', clockOut: '', notes: '' }; showSupervisorTools.value = false }
  catch { toast.error('Error') }
}

async function loadReport() {
  if (!reportFrom.value || !reportTo.value) { toast.warning('Seleccioná fechas'); return }
  try { report.value = await AttendanceService.getReport(reportFrom.value, reportTo.value); reportLoaded.value = true } catch { toast.error('Error') }
}

// ─── Calendario de Turnos ───────────────────────────────
const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const fmt = (d: Date) => d.toISOString().slice(0, 10)
function mondayOf(d: Date): Date {
  const x = new Date(d)
  const day = (x.getDay() + 6) % 7   // 0 = lunes
  x.setDate(x.getDate() - day)
  x.setHours(0, 0, 0, 0)
  return x
}
const weekStart = ref(mondayOf(new Date()))
const weekDays = computed(() => Array.from({ length: 7 }, (_, i) => {
  const d = new Date(weekStart.value); d.setDate(d.getDate() + i); return fmt(d)
}))
const assignments = ref<ShiftAssignment[]>([])
const paintScheduleId = ref('')

const cellFor = (employeeId: string, date: string) => assignments.value.find((a) => a.employeeId === employeeId && a.date === date)
const scheduleName = (id: string) => schedules.value.find((s) => s.id === id)?.name ?? 'Turno'

async function loadWeek() {
  try { assignments.value = await AttendanceService.listShiftAssignments(weekDays.value[0], weekDays.value[6]) }
  catch { toast.error('No se pudo cargar la planilla de turnos') }
}
function shiftWeek(delta: number) {
  const d = new Date(weekStart.value); d.setDate(d.getDate() + delta); weekStart.value = d
  loadWeek()
}
async function onCell(p: EmployeeProfile, date: string) {
  const existing = cellFor(p.id, date)
  if (existing) {
    try { await AttendanceService.removeShiftAssignment(existing.id); await loadWeek() }
    catch { toast.error('No se pudo quitar el turno') }
    return
  }
  if (!paintScheduleId.value) { toast.warning('Elegí un turno para asignar'); return }
  try { await AttendanceService.assignShift({ employeeId: p.id, scheduleId: paintScheduleId.value, date }); await loadWeek() }
  catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'No se pudo asignar el turno') }
}

// Carga las asignaciones al abrir la pestaña (y si aún no hay turno pintado, toma el primero).
watch(activeTab, (t) => {
  if (t === 'calendar') {
    if (!paintScheduleId.value && schedules.value.length) paintScheduleId.value = schedules.value[0].id
    loadWeek()
  }
})

const scheduleModal = ref(false)
const savingSchedule = ref(false)
const EMPTY_SCHEDULE = { name: '', startTime: '06:00', endTime: '14:00', breakMinutes: 30, graceMinutes: 10 }
const scheduleForm = ref({ ...EMPTY_SCHEDULE })

function openNewSchedule() { scheduleForm.value = { ...EMPTY_SCHEDULE }; scheduleModal.value = true }

function submitSchedule() {
  const v = scheduleForm.value
  if (!v.name || !v.startTime || !v.endTime) { toast.warning('Nombre, hora inicio y hora fin son requeridos'); return }
  createSchedule({ ...v })
}

async function createSchedule(values: Record<string, string | number>) {
  savingSchedule.value = true
  try {
    await AttendanceService.createSchedule(values as unknown as Partial<AttendanceSchedule>)
    toast.success('Turno creado')
    scheduleModal.value = false
    loadData()
  } catch (e: unknown) {
    toast.error(e instanceof Error ? e.message : 'Error al crear el turno')
  } finally {
    savingSchedule.value = false
  }
}

function deleteSchedule(s: AttendanceSchedule) {
  askConfirm({
    title: 'Eliminar turno', message: `¿Eliminar el turno "${s.name}"?`, confirmLabel: 'Eliminar', danger: true,
    run: async () => { await AttendanceService.deleteSchedule(s.id); toast.success('Turno eliminado') },
  })
}
</script>
