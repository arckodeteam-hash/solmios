// hoteles/tests/update-hotel-country-clears-location.test.ts — PUT /api/settings/hotel: cambiar
// el país invalida la dirección/pin/provincia vieja.
//
// Reportado por el usuario: cambiaba el país en el paso 1 del wizard y el mapa del paso Ubicación
// seguía mostrando la dirección/pin guardados en el registro original. `useHotelLocationMap.ts`
// ya limpia esto en el frontend, pero SOLO cuando país y mapa viven en la misma pantalla montada
// (settings/index.vue) — el país se edita en Bienvenida/Configuración→Hotel y la dirección en
// Ubicación/Página pública, pantallas separadas, así que ese watch nunca ve el cambio. Este test
// cubre el fix centralizado en `HotelesQueries.updateHotel`.

import { describe, it, expect } from 'bun:test'
import { HotelesQueries } from '../usecases/hoteles-queries'

const HOTEL_WITH_ADDRESS = {
  id: 'h1',
  country: 'República Dominicana',
  address: 'Oficinas Centrales',
  latitude: 18.4861,
  longitude: -69.9312,
  province: 'Distrito Nacional',
  municipality: 'Santo Domingo de Guzman',
  locality: 'Santo Domingo',
  postalCode: '15700',
}

function makeOrm(hotel: Record<string, any>) {
  const updates: Record<string, any>[] = []
  return {
    orm: {
      findById: async (_model: string, _id: string) => hotel,
      update: async (_model: string, _id: string, patch: Record<string, any>) => { updates.push(patch); Object.assign(hotel, patch) },
    } as any,
    updates,
  }
}

describe('HotelesQueries.updateHotel — país vs. dirección', () => {
  it('limpia address/lat/lng/provincia/municipio/localidad/CP cuando el país cambia', async () => {
    const hotel = { ...HOTEL_WITH_ADDRESS }
    const { orm, updates } = makeOrm(hotel)
    const queries = new HotelesQueries(orm)

    await queries.updateHotel('h1', { country: 'España' })

    const patch = updates[0]!
    expect(patch.country).toBe('España')
    expect(patch.address).toBe('')
    expect(patch.latitude).toBe(0)
    expect(patch.longitude).toBe(0)
    expect(patch.province).toBe('')
    expect(patch.municipality).toBe('')
    expect(patch.locality).toBe('')
    expect(patch.postalCode).toBe('')
  })

  it('NO toca la dirección si el país no cambia (mismo valor)', async () => {
    const hotel = { ...HOTEL_WITH_ADDRESS }
    const { orm, updates } = makeOrm(hotel)
    const queries = new HotelesQueries(orm)

    await queries.updateHotel('h1', { country: 'República Dominicana', name: 'Nuevo nombre' })

    const patch = updates[0]!
    expect(patch.address).toBeUndefined()
    expect(patch.latitude).toBeUndefined()
    expect(patch.province).toBeUndefined()
  })

  it('NO toca la dirección si el patch no incluye país', async () => {
    const hotel = { ...HOTEL_WITH_ADDRESS }
    const { orm, updates } = makeOrm(hotel)
    const queries = new HotelesQueries(orm)

    await queries.updateHotel('h1', { address: 'Nueva dirección manual' })

    const patch = updates[0]!
    expect(patch.address).toBe('Nueva dirección manual')
    expect(patch.latitude).toBeUndefined()
    expect(patch.province).toBeUndefined()
  })

  it('respeta una dirección nueva si el mismo patch la trae junto con el país', async () => {
    const hotel = { ...HOTEL_WITH_ADDRESS }
    const { orm, updates } = makeOrm(hotel)
    const queries = new HotelesQueries(orm)

    await queries.updateHotel('h1', { country: 'España', address: 'Calle Falsa 123' })

    const patch = updates[0]!
    expect(patch.address).toBe('Calle Falsa 123')
    // Los campos que ese mismo patch NO trajo sí se limpian.
    expect(patch.province).toBe('')
  })
})
