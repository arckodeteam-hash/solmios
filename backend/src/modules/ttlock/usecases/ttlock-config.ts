import { reservationAccessWindow } from '../../../shared/utils/hotel-schedule'

function safeParse(v: any) { if (typeof v !== 'string') return v; try { return JSON.parse(v) } catch { return v } }

export async function generateCodeForReservation(
  reservationId: string,
  hotelId: string,
  lockDevicesRepo: any,
  lockCodesRepo: any,
  getAccessTokenFn: Function,
  addKeyboardPasswordFn: Function,
  randomPinFn: Function,
  getConfigFn: (hotelId: string) => Promise<any>,
  findReservationFn: (id: string) => Promise<any>,
  findHotelFn: (hotelId: string) => Promise<any>,
  auth?: any,
  customCode?: string,
): Promise<any> {
  const res = await findReservationFn(reservationId) as any
  if (!res) throw new Error('Reserva no encontrada')
  if (res.hotelId !== hotelId) throw new Error('Sin acceso a esta reserva')
  if (auth) auth.assertOwnership(res.hotelId, hotelId, undefined, 'super_admin')
  const lock = (await lockDevicesRepo.findMany({ roomId: res.roomId }))[0] as any
  if (!lock?.ttlockLockId) throw new Error('La habitación no tiene cerradura TTLock')
  // PIN manual: el mismo código activo en ESTA cerradura (aunque sea de otra reserva) duplicaría
  // el teclado — dos meanings para un mismo PIN en el mismo hardware. Se rechaza acá (backend
  // autoritativo); el modal de reserva también lo avisa antes de mandar (UX).
  if (customCode) {
    const lockCodes = await lockCodesRepo.findMany({ lockId: lock.id }) as any[]
    const dup = lockCodes.find((c: any) => c.code === customCode && (c.status === 'active' || c.status === 'pending'))
    if (dup) throw new Error('Ese PIN ya está activo en esta cerradura')
  }
  // Creación manual desde la reserva: si el staff elige un PIN propio se usa tal cual (el
  // controller ya validó 4-9 dígitos); sin customCode se genera aleatorio como siempre.
  const password = customCode ?? randomPinFn()
  // Cerradura OFFLINE: el gateway no puede alcanzarla, así que NO intentamos empujar el PIN
  // al hardware (fallaría). Registramos el código como 'pending' — la fila queda con el PIN
  // pre-asignado, lista para reintentar/regenerar cuando la cerradura vuelva, sin romper el
  // flujo automático (webhook de la seña). Sin `ttlockKeyboardPwdId` no hay PIN físico que
  // borrar después, así que revoke/expire lo tratan como no-op de hardware.
  if (lock.status === 'offline') {
    return await lockCodesRepo.create({ lockId: lock.id, hotelId, reservationId, code: password, codeType: 'time', startDate: String(res.checkIn).slice(0, 10), endDate: String(res.checkOut).slice(0, 10), status: 'pending', ttlockKeyboardPwdId: '', sentVia: '' })
  }
  const parsed = await getConfigFn(hotelId)
  if (!parsed?.accessToken) throw new Error('TTLock no conectado')
  const creds = { clientId: parsed.clientId, accessToken: parsed.accessToken, region: parsed.region, addType: parsed.addType }
  // Ventana del PIN en la ZONA DEL HOTEL (fix 2026-08-29, reporte de cliente). Antes era
  // `new Date(res.checkIn).getTime()` sobre una fecha sin hora = medianoche UTC: en UTC-4 el
  // código abría el día anterior a las 20:00 y moría a las 20:00 de la víspera de la salida,
  // dejando al huésped sin acceso su última noche. Ahora respeta el horario del hotel y el
  // override de la reserva (early check-in / late checkout).
  const hotel = await findHotelFn(hotelId)
  const accessWindow = reservationAccessWindow(res, hotel)
  const { startMs, endMs } = accessWindow
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
    throw new Error('Fechas de la reserva inválidas para generar el código')
  }
  let pwdId = ''
  try { const r = await addKeyboardPasswordFn(creds, Number(lock.ttlockLockId), password, startMs, endMs); pwdId = r.keyboardPwdId || '' } catch (e: any) { throw new Error(e.message || 'No se pudo crear el PIN') }
  return await lockCodesRepo.create({ lockId: lock.id, hotelId, reservationId, code: password, codeType: 'time', startDate: String(res.checkIn).slice(0, 10), endDate: String(res.checkOut).slice(0, 10), status: 'active', ttlockKeyboardPwdId: pwdId, sentVia: '' })
}
