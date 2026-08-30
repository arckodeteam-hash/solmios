// usecases/sync-locks.ts — Sincroniza el catálogo de cerraduras del hotel contra TTLock.
// Extraído de `service.ts` (2026-08-29) para mantener el service bajo el límite de God Object.
// Comportamiento idéntico: upsert por `ttlockLockId`, sin borrar las cerraduras que ya no
// vengan del remoto (una cerradura desasociada no debe llevarse puestos sus códigos).

export interface SyncLocksDeps {
  lockDevicesRepo: { findMany(f: any): Promise<any[]>; update(id: string, d: any): Promise<any>; create(d: any): Promise<any> }
  getTtlockConfig(hotelId: string): Promise<any>
  listLocksFn(creds: { clientId: string; accessToken: string; region: string }): Promise<any[]>
}

export async function syncLocksForHotel(deps: SyncLocksDeps, hotelId: string): Promise<number> {
  const parsed = await deps.getTtlockConfig(hotelId)
  if (!parsed?.clientId) throw new Error('TTLock no configurado')
  if (!parsed?.accessToken) throw new Error('TTLock no conectado')
  const remoteLocks = await deps.listLocksFn({ clientId: parsed.clientId, accessToken: parsed.accessToken, region: parsed.region })
  const existing = await deps.lockDevicesRepo.findMany({ hotelId })
  const byTtlock = new Map(existing.filter((l: any) => l.ttlockLockId).map((l: any) => [String(l.ttlockLockId), l]))
  let synced = 0
  for (const l of remoteLocks) {
    const ttlockId = String(l.lockId)
    const name = l.lockAlias || l.lockName || `Cerradura ${ttlockId}`
    const mac = l.lockMac || ''
    const batteryLevel = Number(l.electricQuantity ?? 0)
    const status = 'online' as const
    const ex = byTtlock.get(ttlockId)
    if (ex) await deps.lockDevicesRepo.update(ex.id, { name, mac, batteryLevel, status })
    else await deps.lockDevicesRepo.create({ hotelId, ttlockLockId: ttlockId, roomId: '', name, mac, batteryLevel, status })
    synced++
  }
  return synced
}
