// useOnboardingStep.test.ts — tarea 3.1 (wizard-refactor F3). El guardado de cada paso del
// Centro de configuración es aislado: este composable solo envuelve `saveFn` con saving/error/
// protección de doble submit, y refresca el estado de onboarding al terminar.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useOnboardingStep } from './useOnboardingStep'
import type { OnboardingStatus } from '@/services/Onboarding.service'

let statusImpl: () => Promise<OnboardingStatus>
vi.mock('@/services/Onboarding.service', () => ({
  OnboardingService: { status: () => statusImpl() },
}))

const FAKE_STATUS: OnboardingStatus = { completed: false, doneCount: 1, totalCount: 10, steps: [] }

beforeEach(() => {
  statusImpl = async () => FAKE_STATUS
})

describe('useOnboardingStep', () => {
  it('guarda correctamente: llama saveFn y refresca el status al terminar', async () => {
    const saveFn = vi.fn(async () => {})
    const onSaved = vi.fn()
    const { save, saving, error } = useOnboardingStep(saveFn, onSaved)

    await save()

    expect(saveFn).toHaveBeenCalledTimes(1)
    expect(onSaved).toHaveBeenCalledWith(FAKE_STATUS)
    expect(saving.value).toBe(false)
    expect(error.value).toBe('')
  })

  it('refleja `saving` mientras el request está en curso', async () => {
    let resolveSave: (() => void) | null = null
    const saveFn = vi.fn(() => new Promise<void>((resolve) => { resolveSave = resolve }))
    const { save, saving } = useOnboardingStep(saveFn)

    const promise = save()
    expect(saving.value).toBe(true)
    resolveSave!()
    await promise
    expect(saving.value).toBe(false)
  })

  it('expone el mensaje real del error ante un fallo, no uno genérico', async () => {
    const saveFn = vi.fn(async () => { throw new Error('El teléfono es requerido') })
    const { save, error, saving } = useOnboardingStep(saveFn)

    await save()

    expect(error.value).toBe('El teléfono es requerido')
    expect(saving.value).toBe(false)
  })

  it('no dispara doble request en doble click', async () => {
    let resolveSave: (() => void) | null = null
    const saveFn = vi.fn(() => new Promise<void>((resolve) => { resolveSave = resolve }))
    const { save } = useOnboardingStep(saveFn)

    const first = save()
    const second = save() // "doble click": saving ya está en true, esto no debe llamar saveFn de nuevo
    resolveSave!()
    await Promise.all([first, second])

    expect(saveFn).toHaveBeenCalledTimes(1)
  })

  it('un save posterior exitoso limpia el error de un intento anterior', async () => {
    let shouldFail = true
    const saveFn = vi.fn(async () => { if (shouldFail) throw new Error('falló') })
    const { save, error } = useOnboardingStep(saveFn)

    await save()
    expect(error.value).toBe('falló')

    shouldFail = false
    await save()
    expect(error.value).toBe('')
  })
})
