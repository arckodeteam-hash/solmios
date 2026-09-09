<template>
  <div class="space-y-6">
    <!-- WhatsApp es del HOTEL, no de la plataforma: cada uno conecta su propio número y su propia
         cuenta de Meta. Por eso vive en el panel del hotel y no en /admin. -->
    <WhatsappConnectionCard />
    <!-- El hotel paga estas conversaciones: tiene que verlas antes de que llegue la factura. -->
    <WhatsappUsageCard />
  </div>
</template>

<script setup lang="ts">
import WhatsappConnectionCard from '@/components/features/WhatsappConnectionCard.vue'
import WhatsappUsageCard from '@/components/features/WhatsappUsageCard.vue'
</script>
