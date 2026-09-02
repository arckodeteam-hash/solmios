// auto-provision-race.test.ts — El alta automática no puede correr dos veces a la vez para el
// mismo hotel. Reproduce el bug de producción del 2026-09-01: cargar 4 habitaciones EN LOTE
// disparó 4 altas concurrentes y Channex terminó con DOS properties (y dos grupos) para
// "Hotel don Luis"; la config se quedó con la última y la otra quedó huérfana en la cuenta.
import { describe, it, expect } from 'bun:test'
import { ProvisioningUseCase } from '../usecases/provisioning'
import { silentLogger } from 'arckode-framework/testing'

const log = silentLogger()

/** Deps con una config que recién se completa cuando el sync termina (como en la vida real). */
function makeDeps(syncMs = 20) {
  let propertyId: string | null = null
  let syncs = 0
  return {
    syncs: () => syncs,
    deps: {
      getConfig: async () => ({ channexPropertyId: propertyId } as any),
      findMany: async (model: string) => (model === 'Hotels' ? [{ id: 'h1', name: 'Hotel don Luis' }] : [{ id: 'r1', type: 'double' }]),
      syncProperty: async () => {
        syncs++
        await new Promise((r) => setTimeout(r, syncMs))
        propertyId = `prop-${syncs}`
        return { success: true } as any
      },
      readMappings: async () => [{ kind: 'room_type', localId: 'double' }],
      hasPlatformKey: async () => true,
      logger: log,
    },
  }
}

describe('autoProvision — sin carreras', () => {
  it('4 altas simultáneas (alta en lote) crean UNA sola property', async () => {
    const { deps, syncs } = makeDeps()
    const uc = new ProvisioningUseCase(deps as any)
    const outcomes = await Promise.all([1, 2, 3, 4].map(() => uc.autoProvision('h1')))
    expect(syncs()).toBe(1)
    expect(outcomes.every((o) => o === 'provisioned')).toBe(true)
  })

  it('después de aprovisionar, un alta nueva no vuelve a sincronizar', async () => {
    const { deps, syncs } = makeDeps(1)
    const uc = new ProvisioningUseCase(deps as any)
    await uc.autoProvision('h1')
    expect(await uc.autoProvision('h1')).toBe('already-synced')
    expect(syncs()).toBe(1)
  })

  it('hoteles distintos no se bloquean entre sí', async () => {
    const { deps, syncs } = makeDeps()
    const uc = new ProvisioningUseCase(deps as any)
    await Promise.all([uc.autoProvision('h1'), uc.autoProvision('h2')])
    expect(syncs()).toBe(2)
  })
})
