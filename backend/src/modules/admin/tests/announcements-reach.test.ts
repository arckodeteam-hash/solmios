// Alcance y tasa de apertura de los anuncios de la plataforma.
// Antes estos números estaban escritos a mano en el HTML del panel (24 hoteles, 89 usuarios,
// 72% de apertura). Estos tests son lo que sostiene que ahora signifiquen algo.
import { describe, it, expect } from 'bun:test'
import { DashboardQueries } from '../usecases/dashboard-queries'

/** ORM falso con filtro por igualdad, como el real. */
function makeOrm(tables: Record<string, any[]>) {
  return {
    findMany: async (model: string, filters: Record<string, unknown> = {}) =>
      (tables[model] ?? []).filter((row) => Object.entries(filters).every(([k, v]) => row[k] === v)),
  }
}

const usuarios = [
  { id: 'u1', hotelId: 'h1', role: 'hotel_admin', active: 1 },
  { id: 'u2', hotelId: 'h1', role: 'receptionist', active: 1 },
  { id: 'u3', hotelId: 'h2', role: 'hotel_admin', active: 1 },
  { id: 'u4', hotelId: 'h2', role: 'housekeeper', active: 1 },
  { id: 'u5', hotelId: 'h2', role: 'receptionist', active: 0 }, // dado de baja
]

describe('listAnnouncements', () => {
  it('cuenta destinatarios según la audiencia, no el total de usuarios', async () => {
    const orm = makeOrm({
      Announcements: [
        { id: 'global', title: 'A todos', audience: 'all', hotelId: null },
        { id: 'de-h1', title: 'Solo h1', audience: 'hotel', hotelId: 'h1' },
        { id: 'admins', title: 'Solo dueños', audience: 'admins', hotelId: null },
      ],
      Users: usuarios,
      AnnouncementReads: [],
    })
    const { data } = await new DashboardQueries(orm).listAnnouncements()
    const byId = Object.fromEntries(data.map((a: any) => [a.id, a]))

    expect(byId.global.recipients).toBe(4)   // los 4 usuarios activos
    expect(byId['de-h1'].recipients).toBe(2) // los 2 de h1
    expect(byId.admins.recipients).toBe(2)   // un hotel_admin por hotel
  })

  it('un usuario dado de baja no cuenta como destinatario', async () => {
    const orm = makeOrm({
      Announcements: [{ id: 'a', audience: 'hotel', hotelId: 'h2' }],
      Users: usuarios,
      AnnouncementReads: [],
    })
    const { data } = await new DashboardQueries(orm).listAnnouncements()
    expect(data[0].recipients).toBe(2) // u3 y u4; u5 está inactivo
  })

  it('separa vistos de cerrados', async () => {
    const orm = makeOrm({
      Announcements: [{ id: 'a', audience: 'all', hotelId: null }],
      Users: usuarios,
      AnnouncementReads: [
        { announcementId: 'a', userId: 'u1', seenAt: '2026-06-01T00:00:00Z', dismissedAt: '2026-06-01T00:05:00Z' },
        { announcementId: 'a', userId: 'u2', seenAt: '2026-06-01T00:01:00Z' },
        { announcementId: 'otro', userId: 'u3', seenAt: '2026-06-01T00:02:00Z' },
      ],
    })
    const { data } = await new DashboardQueries(orm).listAnnouncements()
    expect(data[0].seenCount).toBe(2)
    expect(data[0].dismissedCount).toBe(1)
  })
})

describe('getAnnouncementsReach', () => {
  it('calcula la tasa de apertura del último anuncio difundido', async () => {
    const orm = makeOrm({
      Hotels: [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }],
      Users: usuarios,
      Announcements: [
        { id: 'viejo', title: 'Viejo', audience: 'all', hotelId: null, date: '2026-01-01T00:00:00Z' },
        { id: 'ultimo', title: 'Último', audience: 'all', hotelId: null, date: '2026-06-01T00:00:00Z' },
        { id: 'de-hotel', title: 'De un hotel', audience: 'hotel', hotelId: 'h1', date: '2026-07-01T00:00:00Z' },
      ],
      AnnouncementReads: [
        { announcementId: 'ultimo', userId: 'u1', seenAt: '2026-06-02T00:00:00Z' },
        { announcementId: 'ultimo', userId: 'u2', seenAt: '2026-06-02T00:00:00Z' },
      ],
    })
    const reach = await new DashboardQueries(orm).getAnnouncementsReach()

    expect(reach.hotels).toBe(3)
    expect(reach.users).toBe(4)
    // "de-hotel" es más reciente pero NO es un anuncio difundido: no representa el alcance.
    expect(reach.lastAnnouncement!.id).toBe('ultimo')
    expect(reach.lastAnnouncement!.recipients).toBe(4)
    expect(reach.lastAnnouncement!.seenCount).toBe(2)
    expect(reach.lastAnnouncement!.openRate).toBe(50)
  })

  it('anuncio nuevo con lecturas de anuncios viejos → null', async () => {
    // Las lecturas de anuncios anteriores no son "datos" del último: recién difundido y sin
    // lecturas propias tiene que dar `null` (sin datos), no `0%` (nadie lo abrió).
    const orm = makeOrm({
      Hotels: [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }],
      Users: usuarios,
      Announcements: [
        { id: 'viejo', title: 'Viejo', audience: 'all', hotelId: null, date: '2026-01-01T00:00:00Z' },
        { id: 'nuevo', title: 'Nuevo', audience: 'all', hotelId: null, date: '2026-06-01T00:00:00Z' },
      ],
      AnnouncementReads: [
        { announcementId: 'viejo', userId: 'u1', seenAt: '2026-01-02T00:00:00Z' },
        { announcementId: 'viejo', userId: 'u2', seenAt: '2026-01-02T00:00:00Z' },
      ],
    })
    const reach = await new DashboardQueries(orm).getAnnouncementsReach()

    expect(reach.lastAnnouncement!.id).toBe('nuevo')
    expect(reach.lastAnnouncement!.seenCount).toBe(0)
    expect(reach.lastAnnouncement!.openRate).toBeNull()
  })

  it('una fila sólo con dismissedAt (sin seenAt) tampoco es una lectura → null', async () => {
    // upsertRead puede dejar una fila con `dismissedAt` y sin `seenAt` si /seen falló en silencio
    // y /dismiss sí llegó. Nadie lo VIO todavía: sigue siendo "sin datos", no "0%".
    const orm = makeOrm({
      Hotels: [{ id: 'h1' }],
      Users: usuarios,
      Announcements: [{ id: 'a', title: 'A', audience: 'all', hotelId: null, date: '2026-06-01T00:00:00Z' }],
      AnnouncementReads: [{ announcementId: 'a', userId: 'u1', seenAt: null, dismissedAt: '2026-06-02T00:00:00Z' }],
    })
    const reach = await new DashboardQueries(orm).getAnnouncementsReach()

    expect(reach.lastAnnouncement!.seenCount).toBe(0)
    expect(reach.lastAnnouncement!.openRate).toBeNull()
  })

  it('10 destinatarios y 4 lecturas → recipients 10, seenCount 4, openRate 40', async () => {
    // El caso de aceptación de ANN-5: los cuatro números salen de la base, no del HTML.
    const diezActivos = Array.from({ length: 10 }, (_, i) => ({
      id: `d${i + 1}`, hotelId: i < 5 ? 'h1' : 'h2', role: i % 5 === 0 ? 'hotel_admin' : 'receptionist', active: 1,
    }))
    const orm = makeOrm({
      Hotels: [{ id: 'h1' }, { id: 'h2' }],
      Users: [...diezActivos, { id: 'baja', hotelId: 'h1', role: 'receptionist', active: 0 }],
      Announcements: [
        { id: 'difundido', title: 'Difundido a todos', audience: 'all', hotelId: null, createdAt: '2026-06-01T00:00:00Z', sentAt: '2026-06-01T00:00:00Z' },
      ],
      AnnouncementReads: [
        { announcementId: 'difundido', userId: 'd1', seenAt: '2026-06-02T00:00:00Z', dismissedAt: null },
        { announcementId: 'difundido', userId: 'd2', seenAt: '2026-06-02T00:01:00Z', dismissedAt: null },
        { announcementId: 'difundido', userId: 'd3', seenAt: '2026-06-02T00:02:00Z', dismissedAt: '2026-06-02T00:03:00Z' },
        { announcementId: 'difundido', userId: 'd4', seenAt: '2026-06-02T00:04:00Z', dismissedAt: null },
      ],
    })
    const queries = new DashboardQueries(orm)

    const { data } = await queries.listAnnouncements()
    expect(data).toHaveLength(1)
    expect(data[0].recipients).toBe(10)
    expect(data[0].seenCount).toBe(4)

    const reach = await queries.getAnnouncementsReach()
    expect(reach.hotels).toBe(2)
    expect(reach.users).toBe(10)
    expect(reach.lastAnnouncement!.id).toBe('difundido')
    expect(reach.lastAnnouncement!.recipients).toBe(10)
    expect(reach.lastAnnouncement!.seenCount).toBe(4)
    expect(reach.lastAnnouncement!.openRate).toBe(40)
  })

  it('sin lecturas todavía la tasa es null, NO cero', async () => {
    // Un 0% se lee como "lo mandé y no lo abrió nadie". Es una conclusión distinta —y falsa—
    // de "todavía no hay datos".
    const orm = makeOrm({
      Hotels: [{ id: 'h1' }],
      Users: usuarios,
      Announcements: [{ id: 'recien', title: 'Recién creado', audience: 'all', hotelId: null, date: '2026-06-01T00:00:00Z' }],
      AnnouncementReads: [],
    })
    const reach = await new DashboardQueries(orm).getAnnouncementsReach()
    expect(reach.lastAnnouncement!.openRate).toBeNull()
  })

  it('sin anuncios difundidos no inventa un último', async () => {
    const orm = makeOrm({
      Hotels: [{ id: 'h1' }],
      Users: usuarios,
      Announcements: [{ id: 'solo-hotel', audience: 'hotel', hotelId: 'h1' }],
      AnnouncementReads: [],
    })
    const reach = await new DashboardQueries(orm).getAnnouncementsReach()
    expect(reach.lastAnnouncement).toBeNull()
  })
})
