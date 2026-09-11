// useConfirm.ts — Estado de un modal de confirmación estilado (reemplaza confirm() nativo).
// Uso:
//   const { confirmModal, confirmBusy, askConfirm, runConfirm } = useConfirm({ onDone: load, onError: (e) => toast.error(...) })
//   askConfirm({ title, message, confirmLabel, danger, run: async () => { await api() } })
// En el template: <ConfirmModal v-if="confirmModal" ... :loading="confirmBusy" @confirm="runConfirm" @close="confirmModal = null" />

import { ref } from 'vue'

export interface ConfirmConfig {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  run: () => Promise<unknown>
}

export function useConfirm(opts: { onDone?: () => void; onError?: (e: unknown) => void } = {}) {
  const confirmModal = ref<ConfirmConfig | null>(null)
  const confirmBusy = ref(false)

  function askConfirm(cfg: ConfirmConfig) { confirmModal.value = cfg }

  async function runConfirm() {
    if (!confirmModal.value) return
    confirmBusy.value = true
    try {
      await confirmModal.value.run()
      confirmModal.value = null
      opts.onDone?.()
    } catch (e) {
      // #282 (L): la acción falló (p. ej. 409 "forma parte de un combo"): el modal se cierra y el mensaje
      // queda en el toast. Antes quedaba abierto ofreciendo "Eliminar" de nuevo, con el mismo resultado.
      confirmModal.value = null
      opts.onError?.(e)
    } finally {
      confirmBusy.value = false
    }
  }

  return { confirmModal, confirmBusy, askConfirm, runConfirm }
}
