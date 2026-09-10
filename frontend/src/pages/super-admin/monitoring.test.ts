// monitoring.test.ts — /admin/monitoring (#96) muestra lo que el backend midió y nada más:
// (a) con el backend caído NO dice "operativo" y muestra el fallo con su motivo;
// (b) con datos, la cola de email muestra sus pendientes y una entrega de webhook fallida sale
//     con su código de estado.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { HttpMetricsSnapshot, QueuesSnapshot, SystemSnapshot } from '@/types/monitoring'

// vi.hoisted: el factory de vi.mock se iza arriba del todo y no puede ver variables del módulo.
const svc = vi.hoisted(() => ({
  monitoringApi: vi.fn(),
  monitoringErrors: vi.fn(),
  monitoringErrorRemove: vi.fn(),
  monitoringSystem: vi.fn(),
  monitoringQueues: vi.fn(),
  backupsList: vi.fn(),
  backupCreate: vi.fn(),
  backupDownload: vi.fn(),
  backupDelete: vi.fn(),
}))
vi.mock('@/services/Platform.service', () => ({ PlatformService: svc }))
// Singleton: el componente y el test tienen que ver LOS MISMOS vi.fn() (patrón audit.test.ts).
vi.mock('@/composables/useToast', () => {
  const fns = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), toasts: [] }
  return { useToast: () => fns }
})

import Monitoring from './monitoring.vue'

const API: HttpMetricsSnapshot = {
  ventanaDesde: '2026-09-10T08:00:00.000Z',
  rutas: [
    { ruta: '/api/reservas/:id', metodo: 'GET', count: 12, avgMs: 31.4, p95Ms: 80, maxMs: 120, errors: 0 },
    { ruta: '/api/auth/login', metodo: 'POST', count: 3, avgMs: 210, p95Ms: 300, maxMs: 310, errors: 0 },
  ],
  totales: { peticiones: 15, erroresPct: 0, avgMs: 67.1 },
}

const SYSTEM: SystemSnapshot = {
  proceso: { uptimeS: 5400, memoriaRssMb: 150.2, memoriaHeapMb: 60.5, cpuPct: null },
  so: { uptimeS: 900000, cargas: [0.5, 0.4, 0.3], memoriaTotalMb: 16000, memoriaLibreMb: 8000 },
  db: { motor: 'sqlite', tamanoBytes: 5_000_000, tablas: 40 },
}

const QUEUES: QueuesSnapshot = {
  email: { pending: 7, processing: 1, sent: 120, failed: 2, total: 130, ultimoProcesadoEn: '2026-09-10T09:30:00.000Z' },
  ariOutbox: { pending: 2, processing: 0, sent: 50, failed: 0, retrying: 1, total: 53 },
  webhooks: {
    ultimasEntregas: [
      { id: 'w1', webhookId: 'hook-a', event: 'reservation.created', statusCode: 200, success: true, attemptedAt: '2026-09-10T09:40:00.000Z' },
      { id: 'w2', webhookId: 'hook-b', event: 'reservation.cancelled', statusCode: 502, success: false, attemptedAt: '2026-09-10T09:41:00.000Z' },
    ],
  },
}

let wrapper: ReturnType<typeof mount> | null = null
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

async function render() {
  wrapper = mount(Monitoring)
  await flushPromises()
  await flushPromises()
  return wrapper
}

describe('super-admin/monitoring — backend caído', () => {
  beforeEach(() => {
    const caido = () => Promise.reject(new Error('El servidor respondió HTML en vez de JSON (HTTP 502).'))
    svc.monitoringApi.mockImplementation(caido)
    svc.monitoringErrors.mockImplementation(caido)
    svc.monitoringSystem.mockImplementation(caido)
    svc.monitoringQueues.mockImplementation(caido)
    svc.backupsList.mockImplementation(caido)
  })

  it('no declara "operativo" y muestra el fallo con su motivo', async () => {
    const w = await render()
    const texto = w.text()
    expect(texto.toLowerCase()).not.toContain('operativo')
    expect(w.find('[data-testid="estado-global"]').text()).toContain('Backend sin respuesta')
    const fallo = w.find('[data-testid="fallo-global"]')
    expect(fallo.exists()).toBe(true)
    expect(fallo.text()).toContain('El backend no respondió a ninguna lectura.')
    expect(fallo.text()).toContain('HTTP 502')
    // Cada tarjeta dice que no pudo leer, no un cero disfrazado de medición.
    expect(texto).toContain('No se pudieron leer las métricas HTTP')
    expect(texto).toContain('No se pudo leer el estado de las colas')
  })

  it('Refrescar vuelve a pedir las cinco lecturas', async () => {
    const w = await render()
    const antes = svc.monitoringQueues.mock.calls.length
    const btn = w.findAll('button').find((b) => b.text() === 'Refrescar')!
    await btn.trigger('click')
    await flushPromises()
    expect(svc.monitoringQueues.mock.calls.length).toBe(antes + 1)
    expect(svc.monitoringApi).toHaveBeenCalled()
    expect(svc.monitoringSystem).toHaveBeenCalled()
    expect(svc.monitoringErrors).toHaveBeenCalled()
    expect(svc.backupsList).toHaveBeenCalled()
  })
})

describe('super-admin/monitoring — con datos', () => {
  beforeEach(() => {
    svc.monitoringApi.mockResolvedValue(API)
    svc.monitoringErrors.mockResolvedValue({ items: [] })
    svc.monitoringSystem.mockResolvedValue(SYSTEM)
    svc.monitoringQueues.mockResolvedValue(QUEUES)
    svc.backupsList.mockResolvedValue({ items: [{ id: 'backup-2026-09-10.sqlite', bytes: 2048, creadoEn: '2026-09-10T09:00:00.000Z' }] })
  })

  it('muestra los pendientes de email y la entrega de webhook fallida con su código', async () => {
    const w = await render()
    const texto = w.text()
    expect(w.find('[data-testid="fallo-global"]').exists()).toBe(false)
    // Email: la tarjeta "Pendientes" trae el número real de la cola.
    const pendientes = w.findAll('div').find((d) => d.text() === 'Pendientes' && d.classes().includes('uppercase'))!
    expect(pendientes.exists()).toBe(true)
    expect(pendientes.element.parentElement?.textContent).toContain('7')
    // Webhook fallido: fila con el evento, el código y el resultado.
    const fila = w.findAll('tr').find((tr) => tr.text().includes('reservation.cancelled'))!
    expect(fila.exists()).toBe(true)
    expect(fila.text()).toContain('502')
    expect(fila.text()).toContain('Falló')
    // Con emails fallidos y un webhook fallido no se dice "operativo": se dice qué pasa.
    expect(texto.toLowerCase()).not.toContain('todo operativo')
    expect(w.find('[data-testid="estado-global"]').text()).toContain('webhooks fallidos')
    // Métricas HTTP y backups reales en pantalla.
    expect(texto).toContain('/api/reservas/:id')
    expect(texto).toContain('backup-2026-09-10.sqlite')
  })

  it('con todo sano y sin incidencias, sí declara "Todo operativo"', async () => {
    svc.monitoringQueues.mockResolvedValue({
      ...QUEUES,
      email: { ...QUEUES.email, failed: 0 },
      webhooks: { ultimasEntregas: [QUEUES.webhooks.ultimasEntregas[0]] },
    })
    const w = await render()
    expect(w.find('[data-testid="estado-global"]').text()).toBe('Todo operativo')
  })

  it('crear backup muestra progreso, refresca la lista y descargar usa el blob con <a download>', async () => {
    let resolver: (v: unknown) => void = () => {}
    svc.backupCreate.mockImplementation(() => new Promise((r) => { resolver = r }))
    const w = await render()
    const listasAntes = svc.backupsList.mock.calls.length

    const crear = w.findAll('button').find((b) => b.text() === 'Crear backup')!
    await crear.trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Creando backup…')
    expect(w.text()).toContain('Generando el volcado')

    resolver({ archivo: { id: 'backup-nuevo.sqlite', bytes: 10, creadoEn: '2026-09-10T10:00:00.000Z' }, eliminados: [] })
    await flushPromises()
    expect(w.text()).not.toContain('Creando backup…')
    expect(svc.backupsList.mock.calls.length).toBe(listasAntes + 1)

    // Descarga: getBlob → objectURL → <a download="id">.
    const blob = new Blob(['x'], { type: 'application/octet-stream' })
    svc.backupDownload.mockResolvedValue(blob)
    const anchors: HTMLAnchorElement[] = []
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { anchors.push(this) })
    const urlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const descargar = w.findAll('button').find((b) => b.text() === 'Descargar')!
    await descargar.trigger('click')
    await flushPromises()
    expect(svc.backupDownload).toHaveBeenCalledWith('backup-2026-09-10.sqlite')
    expect(urlSpy).toHaveBeenCalledWith(blob)
    expect(anchors.length).toBe(1)
    expect(anchors[0].getAttribute('download')).toBe('backup-2026-09-10.sqlite')
    expect(anchors[0].getAttribute('href')).toBe('blob:mock')
    expect(revokeSpy).toHaveBeenCalledWith('blob:mock')
    clickSpy.mockRestore()
    urlSpy.mockRestore()
    revokeSpy.mockRestore()
  })

  it('borrar backup pide confirmación y sólo borra al confirmar', async () => {
    svc.backupDelete.mockResolvedValue(undefined)
    const w = await render()
    const borrar = w.findAll('button').find((b) => b.text() === 'Borrar')!
    await borrar.trigger('click')
    await flushPromises()
    expect(svc.backupDelete).not.toHaveBeenCalled()
    // El modal se monta en el body (teleport): se busca ahí.
    const confirmar = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Borrar' && !w.element.contains(b))
    expect(confirmar).toBeTruthy()
    confirmar!.click()
    await flushPromises()
    expect(svc.backupDelete).toHaveBeenCalledWith('backup-2026-09-10.sqlite')
  })
})
