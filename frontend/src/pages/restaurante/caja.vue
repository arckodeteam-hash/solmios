<script setup lang="ts">
// pages/restaurante/caja.vue — Caja del RESTAURANTE (punto de venta separado de recepción).
// Antes el efectivo del POS caía en el mismo turno único del hotel, gestionable solo por
// hotel_admin — un mesero no podía abrir/cerrar SU turno ni cargar un movimiento manual del salón.
// Ahora es un turno independiente (register='restaurant'), operable por quien tiene permiso
// `restaurant` (hotel_admin/receptionist/waiter).
// #213: el cierre de turno solo ve efectivo; el consolidado de todo lo vendido (tarjeta, transferencia,
// cargo a habitación, propinas, anulaciones) es el "Cierre del día" — enlace para quien tiene reports:view.
import { computed } from 'vue'
import { RestaurantCajaService } from '@/services/Caja.service'
import CashRegisterView from '@/components/features/CashRegisterView.vue'
import { usePermissions } from '@/composables/usePermissions'

const { can } = usePermissions()
// computed (no un boolean suelto): los permisos llegan con el usuario y pueden cambiar después de montar.
const canSeeReports = computed(() => can('reports', 'view'))
</script>

<template>
  <CashRegisterView :service="RestaurantCajaService" title="Caja del Restaurante"
    subtitle="Turno, movimientos y arqueo del punto de venta"
    empty-message="Registrá un ingreso o un egreso para empezar a mover la caja del restaurante.">
    <template v-if="canSeeReports" #header-actions>
      <router-link to="/panel/restaurante/reportes?tab=dia" data-testid="link-cierre-dia"
        class="flex items-center gap-1.5 rounded-full border border-border px-4 py-2.5 text-sm font-extrabold text-navy transition-colors hover:border-navy/30 hover:bg-navy/5">
        Cierre del día
      </router-link>
    </template>
  </CashRegisterView>
</template>
