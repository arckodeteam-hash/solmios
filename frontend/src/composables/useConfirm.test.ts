// useConfirm.test.ts — #282 (L): el modal de confirmación se cierra también cuando la acción falla.
import { describe, it, expect, vi } from 'vitest'
import { useConfirm } from './useConfirm'

describe('useConfirm', () => {
  it('éxito: corre la acción, cierra el modal y avisa onDone', async () => {
    const onDone = vi.fn(), onError = vi.fn()
    const c = useConfirm({ onDone, onError })
    const run = vi.fn(async () => {})
    c.askConfirm({ title: 'Eliminar ítem', message: '¿Seguro?', run })
    expect(c.confirmModal.value).not.toBeNull()
    await c.runConfirm()
    expect(run).toHaveBeenCalledTimes(1)
    expect(c.confirmModal.value).toBeNull()
    expect(c.confirmBusy.value).toBe(false)
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('fallo (409 "forma parte de un combo"): el modal se CIERRA y el error llega a onError con su mensaje', async () => {
    const onDone = vi.fn(), onError = vi.fn()
    const c = useConfirm({ onDone, onError })
    const err = new Error('El ítem "Pizza" forma parte del combo "Menú del día"; quitalo del combo antes de borrarlo')
    c.askConfirm({ title: 'Eliminar ítem', message: '¿Seguro?', run: async () => { throw err } })
    await c.runConfirm()
    expect(c.confirmModal.value).toBeNull()
    expect(c.confirmBusy.value).toBe(false)
    expect(onError).toHaveBeenCalledWith(err)
    expect(onDone).not.toHaveBeenCalled()
  })
})
