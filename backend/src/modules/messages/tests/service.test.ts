// messages/tests/service.test.ts — Tests del servicio de chat interno.
// Usa RepositoryAdapter mock — sin dependencia de SQLite ni Postgres.

import { describe, it, expect } from 'bun:test'
import type { RepositoryAdapter } from 'arckode-framework'
import { silentLogger } from 'arckode-framework/testing'
import { MessagesService } from '../service'
import type { MessageDTO, MessageUser, ContactDTO, UserDirectory } from '../types'

const log = silentLogger()

const me: MessageUser = { id: 'u1', hotelId: 'h1', role: 'receptionist' }
const boss: MessageUser = { id: 'u9', hotelId: 'h1', role: 'hotel_admin' }

function msg(over: Partial<MessageDTO>): MessageDTO {
  return {
    id: 'm1', fromUserId: 'u1', toUserId: 'u2', message: 'hola', photoUrl: null,
    isRead: false, hotelId: 'h1', createdAt: '2026-07-01T10:00:00Z', updatedAt: '',
    ...over,
  }
}

/** Un `UserDirectory` completo a partir de un staff fijo. `resolveNames` filtra
 *  de esa misma lista (en los tests no hay usuarios fuera del hotel). */
function dirOf(staff: ContactDTO[]): UserDirectory {
  return {
    listStaff: async () => staff,
    resolveNames: async (ids: string[]) =>
      new Map(staff.filter((s) => ids.includes(s.id)).map((s) => [s.id, s])),
  }
}

/** Repo que respeta los filtros exactos, como el ORM real. */
function repoWith(rows: MessageDTO[], sink: any[] = []): RepositoryAdapter<MessageDTO> {
  const applyFilter = (f: any) => rows.filter((r) => Object.entries(f ?? {}).every(([k, v]) => (r as any)[k] === v))
  return {
    findMany: async (f: any) => applyFilter(f),
    findById: async (id: string) => rows.find((r) => r.id === id) ?? null,
    create: async (d: any) => { const r = { id: 'new', ...d }; sink.push(r); return r },
    update: async (id: string, d: any) => { sink.push({ id, ...d }); return { ...msg({ id }), ...d } },
    paginate: async (f: any, opts: any) => {
      const filtered = applyFilter(f)
      const sorted = opts?.orderBy?.dir === 'DESC'
        ? [...filtered].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        : filtered
      const offset = opts?.offset ?? 0
      const limit = opts?.limit ?? filtered.length
      return { data: sorted.slice(offset, offset + limit), total: filtered.length }
    },
  } as unknown as RepositoryAdapter<MessageDTO>
}

describe('MessagesService', () => {
  it('agrupa por interlocutor y se queda con el último mensaje', async () => {
    const rows = [
      msg({ id: 'm1', fromUserId: 'u1', toUserId: 'u2', message: 'viejo', createdAt: '2026-07-01T10:00:00Z' }),
      msg({ id: 'm2', fromUserId: 'u2', toUserId: 'u1', message: 'nuevo', createdAt: '2026-07-02T10:00:00Z' }),
    ]
    const convos = await new MessagesService(repoWith(rows), log).getConversations(me)

    expect(convos).toHaveLength(1)
    expect(convos[0].userId).toBe('u2')
    expect(convos[0].lastMessage).toBe('nuevo')
    expect(convos[0].direction).toBe('received')
  })

  it('el hilo con un usuario viene en orden cronológico', async () => {
    const rows = [
      msg({ id: 'm2', fromUserId: 'u2', toUserId: 'u1', message: 'segundo', createdAt: '2026-07-02T10:00:00Z' }),
      msg({ id: 'm1', fromUserId: 'u1', toUserId: 'u2', message: 'primero', createdAt: '2026-07-01T10:00:00Z' }),
    ]
    const hilo = await new MessagesService(repoWith(rows), log).getMessagesWith('u2', me)

    expect(hilo.map((m) => m.message)).toEqual(['primero', 'segundo'])
  })

  it('un mensaje nace sin leer y con el hotel del que lo envía', async () => {
    const sink: any[] = []
    await new MessagesService(repoWith([], sink), log).sendMessage('u2', 'hola', null, me)

    expect(sink[0]).toMatchObject({ fromUserId: 'u1', toUserId: 'u2', isRead: false, hotelId: 'h1' })
  })

  it('solo el destinatario marca como leído', async () => {
    const rows = [msg({ id: 'm1', fromUserId: 'u1', toUserId: 'u2' })]
    const sink: any[] = []
    // u1 es el REMITENTE: no puede marcar leído el mensaje que él mandó
    await new MessagesService(repoWith(rows, sink), log).markAsRead('m1', me)

    expect(sink).toHaveLength(0)
  })

  it('un manager puede marcar como leído cualquier mensaje de su hotel', async () => {
    const rows = [msg({ id: 'm1', fromUserId: 'u1', toUserId: 'u2' })]
    const sink: any[] = []
    await new MessagesService(repoWith(rows, sink), log).markAsRead('m1', boss)

    expect(sink[0]).toMatchObject({ id: 'm1', isRead: true })
  })

  it('getAllConversations es solo para managers, paginado', async () => {
    const rows = [msg({})]
    const svc = new MessagesService(repoWith(rows), log)

    expect(await svc.getAllConversations(me)).toEqual({ messages: [], total: 0, hasMore: false })
    const page = await svc.getAllConversations(boss)
    expect(page.messages).toHaveLength(1)
    expect('data' in page).toBe(false) // #279: con `data` el envelope descartaría `hasMore`
    expect(page.total).toBe(1)
    expect(page.hasMore).toBe(false)
  })

  it('getAllConversations pagina: trae los más recientes primero y marca hasMore', async () => {
    const rows = [
      msg({ id: 'a', createdAt: '2026-07-01T10:00:00Z' }),
      msg({ id: 'b', createdAt: '2026-07-03T10:00:00Z' }),
      msg({ id: 'c', createdAt: '2026-07-02T10:00:00Z' }),
    ]
    const svc = new MessagesService(repoWith(rows), log)

    const first = await svc.getAllConversations(boss, { limit: 2, offset: 0 })
    expect(first.messages.map((m) => m.id)).toEqual(['b', 'c']) // los 2 más recientes
    expect(first.total).toBe(3)
    expect(first.hasMore).toBe(true)

    const second = await svc.getAllConversations(boss, { limit: 2, offset: 2 })
    expect(second.messages.map((m) => m.id)).toEqual(['a']) // el más viejo
    expect(second.hasMore).toBe(false)
  })
})

describe('MessagesService — mensajes sin leer', () => {
  it('cuenta los mensajes pendientes, no las conversaciones', async () => {
    const rows = [
      msg({ id: 'm1', fromUserId: 'u2', toUserId: 'u1', isRead: false, createdAt: '2026-07-01T10:00:00Z' }),
      msg({ id: 'm2', fromUserId: 'u2', toUserId: 'u1', isRead: false, createdAt: '2026-07-01T11:00:00Z' }),
      msg({ id: 'm3', fromUserId: 'u2', toUserId: 'u1', isRead: false, createdAt: '2026-07-01T12:00:00Z' }),
    ]
    const convos = await new MessagesService(repoWith(rows), log).getConversations(me)

    expect(convos[0].unreadCount).toBe(3)
  })

  // El bug que traía "0 sin leer": `isRead` habla solo del último mensaje.
  it('cuenta los pendientes aunque el último mensaje lo haya escrito yo', async () => {
    const rows = [
      msg({ id: 'm1', fromUserId: 'u2', toUserId: 'u1', isRead: false, createdAt: '2026-07-01T10:00:00Z' }),
      msg({ id: 'm2', fromUserId: 'u2', toUserId: 'u1', isRead: false, createdAt: '2026-07-01T11:00:00Z' }),
      msg({ id: 'm3', fromUserId: 'u1', toUserId: 'u2', isRead: true, createdAt: '2026-07-01T12:00:00Z' }),
    ]
    const convos = await new MessagesService(repoWith(rows), log).getConversations(me)

    expect(convos[0].direction).toBe('sent')
    expect(convos[0].isRead).toBe(true)
    expect(convos[0].unreadCount).toBe(2)
  })

  it('los mensajes ya leídos no suman', async () => {
    const rows = [
      msg({ id: 'm1', fromUserId: 'u2', toUserId: 'u1', isRead: true }),
      msg({ id: 'm2', fromUserId: 'u2', toUserId: 'u1', isRead: false, createdAt: '2026-07-01T11:00:00Z' }),
    ]
    const convos = await new MessagesService(repoWith(rows), log).getConversations(me)

    expect(convos[0].unreadCount).toBe(1)
  })

  it('los que yo mandé nunca cuentan como pendientes míos', async () => {
    const rows = [
      msg({ id: 'm1', fromUserId: 'u1', toUserId: 'u2', isRead: false }),
      msg({ id: 'm2', fromUserId: 'u1', toUserId: 'u2', isRead: false, createdAt: '2026-07-01T11:00:00Z' }),
    ]
    const convos = await new MessagesService(repoWith(rows), log).getConversations(me)

    expect(convos[0].unreadCount).toBe(0)
  })

  it('cada interlocutor lleva su propia cuenta', async () => {
    const rows = [
      msg({ id: 'm1', fromUserId: 'u2', toUserId: 'u1', isRead: false }),
      msg({ id: 'm2', fromUserId: 'u2', toUserId: 'u1', isRead: false, createdAt: '2026-07-01T11:00:00Z' }),
      msg({ id: 'm3', fromUserId: 'u3', toUserId: 'u1', isRead: false, createdAt: '2026-07-01T12:00:00Z' }),
    ]
    const convos = await new MessagesService(repoWith(rows), log).getConversations(me)
    const byId = Object.fromEntries(convos.map((c) => [c.userId, c.unreadCount]))

    expect(byId).toEqual({ u2: 2, u3: 1 })
  })

  it('los pendientes de otro hotel no se cuelan', async () => {
    const rows = [
      msg({ id: 'm1', fromUserId: 'u2', toUserId: 'u1', isRead: false, hotelId: 'h1' }),
      msg({ id: 'm2', fromUserId: 'u2', toUserId: 'u1', isRead: false, hotelId: 'h2', createdAt: '2026-07-01T11:00:00Z' }),
    ]
    const convos = await new MessagesService(repoWith(rows), log).getConversations(me)

    expect(convos[0].unreadCount).toBe(1)
  })

  // El canal grupal no tiene acuse de lectura: sumarlo dejaría un globo encendido
  // para siempre, porque nadie puede marcarlo como leído.
  it('el canal del equipo no aporta pendientes', async () => {
    const svc = new MessagesService(repoWith([
      msg({ id: 'm1', fromUserId: 'u2', toUserId: 'team:h1', isRead: false }),
    ]), log)
    svc.setUserDirectory(dirOf([{ id: 'u2', name: 'Rosa', role: 'housekeeper', avatar: null }]))

    const convos = await svc.getConversations(me)

    expect(convos[0].isTeam).toBe(true)
    expect(convos[0].unreadCount).toBe(0)
  })

  // El nombre del interlocutor lo resuelve el backend, no el cliente: así no
  // depende de que el remitente esté en el directorio filtrado por hotel.
  it('adjunta el nombre del interlocutor a la conversación directa', async () => {
    const svc = new MessagesService(repoWith([
      msg({ id: 'm1', fromUserId: 'u2', toUserId: 'u1', message: 'hola', isRead: false }),
    ]), log)
    svc.setUserDirectory(dirOf([
      { id: 'u2', name: 'Rosa Perez', role: 'housekeeper', avatar: '/uploads/rosa.jpg' },
    ]))

    const convos = await svc.getConversations(me)
    const chat = convos.find((c) => c.userId === 'u2')!

    expect(chat.name).toBe('Rosa Perez')
    expect(chat.avatar).toBe('/uploads/rosa.jpg')
    expect(chat.role).toBe('housekeeper')
  })
})

describe('MessagesService.getContacts', () => {
  /** El directorio real lo cablea `connectors/messages-usuarios.ts` desde UsuariosService.list(). */
  const directoryOf = (staff: ContactDTO[]): UserDirectory => ({
    listStaff: async (hotelId: string) => (hotelId === 'h1' ? staff : []),
    resolveNames: async (ids: string[]) =>
      new Map(staff.filter((s) => ids.includes(s.id)).map((s) => [s.id, s])),
  })

  const staffOfH1: ContactDTO[] = [
    { id: 'u1', name: 'Yo Mismo', role: 'receptionist', avatar: null },
    { id: 'u2', name: 'Rosa Perez', role: 'housekeeper', avatar: '/uploads/avatars/rosa.jpg' },
    { id: 'u3', name: 'Carlos Ruiz', role: 'supervisor', avatar: null },
  ]

  it('devuelve los compañeros del hotel, sin el propio usuario', async () => {
    const svc = new MessagesService(repoWith([]), log)
    svc.setUserDirectory(directoryOf(staffOfH1))

    const contacts = await svc.getContacts(me)

    expect(contacts.map((c) => c.id)).toEqual(['u2', 'u3'])
  })

  it('un contacto nunca lleva email ni teléfono', async () => {
    const svc = new MessagesService(repoWith([]), log)
    svc.setUserDirectory(directoryOf(staffOfH1))

    const [contact] = await svc.getContacts(me)

    expect(Object.keys(contact).sort()).toEqual(['avatar', 'id', 'name', 'role'])
  })

  it('solo trae staff del hotel del que pregunta', async () => {
    const svc = new MessagesService(repoWith([]), log)
    svc.setUserDirectory(directoryOf(staffOfH1))

    const otherHotel: MessageUser = { id: 'u1', hotelId: 'h2', role: 'housekeeper' }

    expect(await svc.getContacts(otherHotel)).toEqual([])
  })

  it('degrada a lista vacía si el connector no cableó el directorio', async () => {
    const svc = new MessagesService(repoWith([]), log)

    expect(await svc.getContacts(me)).toEqual([])
  })
})

describe('MessagesService — canal del equipo', () => {
  const directory: UserDirectory = dirOf([
    { id: 'u1', name: 'Yo Mismo', role: 'receptionist', avatar: null },
    { id: 'u2', name: 'Rosa Perez', role: 'housekeeper', avatar: '/uploads/a.jpg' },
  ])

  const withDirectory = (rows: MessageDTO[], sink: any[] = []) => {
    const svc = new MessagesService(repoWith(rows, sink), log)
    svc.setUserDirectory(directory)
    return svc
  }

  it('el alias "team" se persiste como team:<hotelId> del token', async () => {
    const sink: any[] = []
    await withDirectory([], sink).sendMessage('team', 'hola equipo', null, me)

    expect(sink[0].toUserId).toBe('team:h1')
    expect(sink[0].hotelId).toBe('h1')
  })

  // Sin esto, mandar toUserId:'team:h2' escribiría en el grupo de otro hotel.
  it('rechaza un id de equipo explícito venido del cliente', async () => {
    const svc = withDirectory([])

    expect(svc.sendMessage('team:h2', 'intruso', null, me)).rejects.toThrow()
  })

  it('lee el canal del equipo y adjunta el remitente de cada mensaje', async () => {
    const rows = [
      msg({ id: 'm1', fromUserId: 'u2', toUserId: 'team:h1', message: 'del equipo' }),
      msg({ id: 'm2', fromUserId: 'u1', toUserId: 'u2', message: 'privado' }),
    ]
    const thread = await withDirectory(rows).getMessagesWith('team', me)

    expect(thread).toHaveLength(1)
    expect(thread[0].message).toBe('del equipo')
    expect(thread[0].senderName).toBe('Rosa Perez')
    expect(thread[0].senderAvatar).toBe('/uploads/a.jpg')
  })

  it('el canal de otro hotel no se filtra en el propio', async () => {
    const rows = [msg({ id: 'm1', fromUserId: 'u2', toUserId: 'team:h2', hotelId: 'h2' })]

    expect(await withDirectory(rows).getMessagesWith('team', me)).toEqual([])
  })

  it('el equipo va primero en la lista y no se mezcla con los chats personales', async () => {
    const rows = [
      msg({ id: 'm1', fromUserId: 'u1', toUserId: 'u2', message: 'privado', createdAt: '2026-07-03T10:00:00Z' }),
      msg({ id: 'm2', fromUserId: 'u2', toUserId: 'team:h1', message: 'grupal', createdAt: '2026-07-02T10:00:00Z' }),
    ]
    const convos = await withDirectory(rows).getConversations(me)

    expect(convos[0].isTeam).toBe(true)
    expect(convos[0].userId).toBe('team')
    expect(convos[0].lastSenderName).toBe('Rosa Perez')
    // El chat con u2 sigue siendo uno solo, sin el mensaje grupal adentro.
    expect(convos.filter((c) => !c.isTeam).map((c) => c.userId)).toEqual(['u2'])
  })

  it('sin mensajes del equipo, la lista no inventa el canal', async () => {
    const rows = [msg({ id: 'm1', fromUserId: 'u1', toUserId: 'u2' })]
    const convos = await withDirectory(rows).getConversations(me)

    expect(convos.some((c) => c.isTeam)).toBe(false)
  })

  it('marcar leído no cruza hoteles', async () => {
    const sink: any[] = []
    const rows = [msg({ id: 'm1', toUserId: 'u9', hotelId: 'h2' })]
    await withDirectory(rows, sink).markAsRead('m1', boss)

    expect(sink).toEqual([])
  })
})

describe('MessagesService — no leídos del canal del equipo', () => {
  const directory = dirOf([
    { id: 'u1', name: 'Yo Mismo', role: 'receptionist', avatar: null },
    { id: 'u2', name: 'Rosa', role: 'housekeeper', avatar: null },
  ])

  /** Repo de marcas de lectura en memoria. Muta el array recibido para que el
   *  test pueda inspeccionar lo que se creó. */
  function readsRepoWith(marks: any[] = []) {
    const store = marks
    return {
      findMany: async (f: any) => store.filter((r) => Object.entries(f ?? {}).every(([k, v]) => r[k] === v)),
      create: async (d: any) => { store.push(d); return d },
      update: async (id: string, d: any) => {
        const r = store.find((x) => x.id === id); if (r) Object.assign(r, d); return r
      },
    } as unknown as RepositoryAdapter<any>
  }

  const teamRows = [
    msg({ id: 't1', fromUserId: 'u2', toUserId: 'team:h1', createdAt: '2026-07-01T10:00:00Z' }),
    msg({ id: 't2', fromUserId: 'u2', toUserId: 'team:h1', createdAt: '2026-07-02T10:00:00Z' }),
  ]
  const build = (reads: any[]) => {
    const svc = new MessagesService(repoWith(teamRows), log, readsRepoWith(reads))
    svc.setUserDirectory(directory)
    return svc
  }

  it('sin marca de lectura, cuenta todos los mensajes ajenos del grupo', async () => {
    const convos = await build([]).getConversations(me)
    const team = convos.find((c) => c.isTeam)!

    expect(team.unreadCount).toBe(2)
    expect(team.isRead).toBe(false)
  })

  it('con marca posterior al último mensaje, el grupo queda en 0', async () => {
    const reads = [{ id: 'r1', hotelId: 'h1', userId: 'u1', channel: 'team', lastReadAt: '2026-07-03T00:00:00Z' }]
    const convos = await build(reads).getConversations(me)
    const team = convos.find((c) => c.isTeam)!

    expect(team.unreadCount).toBe(0)
    expect(team.isRead).toBe(true)
  })

  it('cuenta solo los mensajes posteriores a la marca', async () => {
    const reads = [{ id: 'r1', hotelId: 'h1', userId: 'u1', channel: 'team', lastReadAt: '2026-07-01T12:00:00Z' }]
    const convos = await build(reads).getConversations(me)

    expect(convos.find((c) => c.isTeam)!.unreadCount).toBe(1)
  })

  it('mis propios mensajes al grupo no cuentan como no leídos', async () => {
    const mine = [msg({ id: 't3', fromUserId: 'u1', toUserId: 'team:h1', createdAt: '2026-07-05T10:00:00Z' })]
    const svc = new MessagesService(repoWith(mine), log, readsRepoWith([]))
    svc.setUserDirectory(directory)

    expect((await svc.getConversations(me)).find((c) => c.isTeam)!.unreadCount).toBe(0)
  })

  it('markTeamRead crea la marca la primera vez y la actualiza después', async () => {
    const reads: any[] = []
    const repo = readsRepoWith(reads)
    const svc = new MessagesService(repoWith(teamRows), log, repo)
    svc.setUserDirectory(directory)

    await svc.markTeamRead(me)
    expect(reads).toHaveLength(1)
    expect(reads[0].channel).toBe('team')
    const first = reads[0].lastReadAt

    await svc.markTeamRead(me)
    expect(reads).toHaveLength(1)          // no duplica
    expect(reads[0].lastReadAt >= first).toBe(true)
  })

  it('sin repo de lecturas (tests viejos), el grupo no cuenta', async () => {
    const svc = new MessagesService(repoWith(teamRows), log)  // sin readsRepo
    svc.setUserDirectory(directory)

    expect((await svc.getConversations(me)).find((c) => c.isTeam)!.unreadCount).toBe(0)
  })
})
