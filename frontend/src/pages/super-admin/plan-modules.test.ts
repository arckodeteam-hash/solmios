// plan-modules.test.ts — Builder del array `plans.modules` del editor de planes.
//
// La semántica la fija el gate (backend admin/usecases/modules.ts): padre = módulo COMPLETO
// (expansión padre→hijos), sub-clave sin padre = SOLO esa parte. El editor tiene que producir
// EXACTAMENTE esa forma: nunca padre+hijos redundantes (congela la matriz y un submódulo
// nuevo del catálogo dejaría de entrar solo).
import { describe, it, expect } from 'vitest'
import type { CatalogModuleDTO } from '@/services/Platform.service'
import {
  isFullModule, looseChildren, toggleModule, toggleChild,
  selectAllModules, selectNoModules, totalCatalogKeys, effectiveCount,
} from './plan-modules'

const CATALOG: CatalogModuleDTO[] = [
  { key: 'planning', label: 'Planning', description: 'Calendario de reservas, tarifas y temporadas', children: [] },
  {
    key: 'reservations', label: 'Reservas', description: 'Reservas y check-in / check-out',
    children: [
      { key: 'reservations.list', label: 'Reservas', description: 'Listado y alta de reservas' },
      { key: 'reservations.checkin', label: 'Check-in / Check-out', description: 'Proceso de entrada y salida' },
    ],
  },
  { key: 'finance', label: 'Finanzas', description: 'Facturación, folios, caja y reportes', children: [{ key: 'finance.billing', label: 'Facturación', description: 'Facturas y notas de crédito' }] },
]

const reservations = CATALOG[1]!
const finance = CATALOG[2]!

describe('toggleModule — padre = módulo completo', () => {
  it('tildar el padre desde vacío deja SOLO la clave padre (los hijos entran por expansión del gate)', () => {
    const matrix = toggleModule([], reservations)
    expect(matrix).toEqual(['reservations'])
    expect(matrix).not.toContain('reservations.list') // JAMÁS padre+hijos redundantes
  })

  it('destildar el padre completo deja TODOS los hijos sueltos (parcial sin perder estado efectivo)', () => {
    const matrix = toggleModule(['planning', 'reservations'], reservations)
    expect(matrix).toEqual(['planning', 'reservations.list', 'reservations.checkin'])
    expect(isFullModule(matrix, reservations)).toBe(false)
  })

  it('re-tildar el padre tras una selección parcial descarta los hijos sueltos', () => {
    const partial = ['planning', 'reservations.checkin']
    const matrix = toggleModule(partial, reservations)
    expect(matrix).toEqual(['planning', 'reservations'])
  })

  it('un padre sin submódulos se tilda/destilda igual (children: [])', () => {
    const planning = CATALOG[0]!
    expect(toggleModule([], planning)).toEqual(['planning'])
    expect(toggleModule(['planning'], planning)).toEqual([])
  })
})

describe('toggleChild — sub-claves sueltas = activación parcial', () => {
  it('agrega y quita sub-claves sin el padre', () => {
    expect(toggleChild([], reservations, 'reservations.checkin')).toEqual(['reservations.checkin'])
    expect(toggleChild(['reservations.checkin'], reservations, 'reservations.checkin')).toEqual([])
  })

  it('con el padre completo es no-op: los hijos van por el padre (primero destilar el padre)', () => {
    const matrix = ['reservations']
    expect(toggleChild(matrix, reservations, 'reservations.list')).toEqual(['reservations'])
  })
})

describe('estado derivado de una matriz cargada', () => {
  it('matriz legacy con padre+hijos se lee como módulo completo (hijos no "sueltos")', () => {
    const legacy = ['reservations', 'reservations.list', 'reservations.checkin']
    expect(isFullModule(legacy, reservations)).toBe(true)
    expect(looseChildren(legacy, reservations).size).toBe(0)
  })

  it('looseChildren devuelve solo las sub-claves listadas sin el padre', () => {
    const matrix = ['planning', 'reservations.checkin']
    expect(looseChildren(matrix, reservations)).toEqual(new Set(['reservations.checkin']))
    expect(looseChildren(matrix, finance).size).toBe(0)
  })
})

describe('Todo / Ninguno / total efectivo', () => {
  it('selectAllModules deja solo las claves padre', () => {
    expect(selectAllModules(CATALOG)).toEqual(['planning', 'reservations', 'finance'])
  })

  it('selectNoModules devuelve matriz vacía (retrocompat: sin matriz = todos)', () => {
    expect(selectNoModules()).toEqual([])
  })

  it('effectiveCount expande el padre (él + sus submódulos) como el gate', () => {
    expect(effectiveCount(['reservations'], CATALOG)).toBe(3) // padre + 2 submódulos
  })

  it('effectiveCount con sub-clave suelta cuenta solo esa parte', () => {
    expect(effectiveCount(['planning', 'reservations.checkin'], CATALOG)).toBe(2)
  })

  it('con TODO marcado: effectiveCount == totalCatalogKeys (el "44 de 44")', () => {
    const all = selectAllModules(CATALOG)
    expect(effectiveCount(all, CATALOG)).toBe(totalCatalogKeys(CATALOG))
    expect(totalCatalogKeys(CATALOG)).toBe(6) // 3 padres + 3 submódulos
  })
})
