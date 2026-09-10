// canales/tests/reservation-events.test.ts — Crear una reserva no puede quedar colgada del push.
//
// Bug reproducido en producción el 2026-09-09 durante la corrida de certificación (T10):
// `POST /api/reservas` devolvió 500 con "Request timed out after 30000ms" y la reserva quedó
// creada igual. La cadena era: crud.ts:233 `await safeEmit` → safe-emit.ts:23 `await handler`
// → este usecase `await pushAvailabilityByRoom` → channex-http.ts `await acquireSlot()`, que
// BLOQUEA cuando la ventana de 18 ARI/minuto está llena. Ese minuto había salido exactamente
// 18 (9 availability + 7 rate overrides + 2 rates), así que el push esperó turno adentro del
// request hasta que el timeout del framework lo cortó.
//
// La cabecera del usecase ya declaraba "todo es fire-and-forget", pero el código awaiteaba.

import { test, expect } from 'bun:test'
import { onReservationRoomChanged } from '../usecases/reservation-events'

/** Un push que no resuelve nunca: es el limiter esperando que se libere la ventana. */
function pushColgado() {
  let liberar: () => void = () => {}
  const bloqueado = new Promise<void>((resolve) => { liberar = resolve })
  let llamado = false
  return {
    liberar,
    fueLlamado: () => llamado,
    push: async () => { llamado = true; await bloqueado },
  }
}

test('el push colgado no bloquea el alta de la reserva', async () => {
  const p = pushColgado()

  // Si el usecase espera al push, esta carrera la gana el timeout y el test falla — que es
  // exactamente lo que le pasaba al request HTTP real, sólo que con 30s en vez de 200ms.
  await Promise.race([
    onReservationRoomChanged({ pushAvailabilityByRoom: p.push }, { hotelId: 'h1', roomId: 'r1' }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('onReservationRoomChanged se quedó esperando el push')), 200)),
  ])

  expect(p.fueLlamado()).toBe(true) // disparado, pero no esperado
  p.liberar()
})

test('un push que falla no rompe el alta ni se propaga', async () => {
  await onReservationRoomChanged(
    { pushAvailabilityByRoom: async () => { throw new Error('channex caído') } },
    { hotelId: 'h1', roomId: 'r1' },
  )
  // Sin assert de valor: el test es que la línea de arriba no tire. Un throw acá sería el
  // alta de una reserva cayéndose porque el channel manager está caído.
  await new Promise((r) => setTimeout(r, 10)) // deja correr el .catch del push en background
})

test('sin hotel o sin habitación no se dispara ningún push', async () => {
  let veces = 0
  const deps = { pushAvailabilityByRoom: async () => { veces++ } }
  await onReservationRoomChanged(deps, undefined)
  await onReservationRoomChanged(deps, { hotelId: 'h1' })
  await onReservationRoomChanged(deps, { roomId: 'r1' })
  await onReservationRoomChanged(deps, { hotelId: 'h1', roomId: null })
  expect(veces).toBe(0)
})
