// approve.ts — Usecase: Supervisor aprueba limpieza
import type { RepositoryAdapter } from 'arckode-framework'
import { NotFoundError, AuthError, ValidationError } from 'arckode-framework'
import type { HousekeepingDTO } from '../types'
import type { IssueReport } from '../sockets'
import { assertTransition } from './timings'
import { RATING_MIN, RATING_MAX } from '../validators/schema'

interface HkUser { id: string; role?: string; hotelId?: string }

export class ApproveUseCase {
  constructor(
    private readonly repo: RepositoryAdapter<HousekeepingDTO>,
  ) {}

  /** Carga la tarea imponiendo ownership: un hotel no aprueba/rechaza limpiezas de otro (IDOR). */
  private async ownedTask(taskId: string, user: HkUser): Promise<HousekeepingDTO> {
    const task = await this.repo.findById(taskId)
    if (!task) throw new NotFoundError('Tarea no encontrada')
    if (user.role !== 'super_admin' && (task as any).hotelId !== user.hotelId) {
      throw new AuthError('La tarea no pertenece a tu hotel')
    }
    return task
  }

  /**
   * Segregación de funciones: quien HIZO la limpieza no la aprueba, no la devuelve ni se
   * marca la presencia del supervisor. Sin esto, un usuario con `housekeeping:edit` que
   * además está asignado como staffId (el rol `housekeeper` lo tiene por default) podía
   * auto-sellar su propia tarea: presence → approve, y quedaba "inspected" con su propio
   * rating. La revisión exige una segunda persona por diseño (presencia física + calificación).
   */
  private assertNotPerformedBy(task: HousekeepingDTO, user: HkUser): void {
    if ((task as any).staffId && (task as any).staffId === user.id) {
      throw new AuthError('No podés aprobar ni marcar presencia en una limpieza que realizaste vos mismo')
    }
  }

  async approve(taskId: string, user: HkUser, note: string | undefined, rating: number): Promise<HousekeepingDTO> {
    const task = await this.ownedTask(taskId, user)

    // Idempotencia: dos supervisores (o un doble-toque con mala señal) que aprueban a la
    // vez no pisan el rating del primero ni duplican efectos — el segundo ve la tarea ya
    // inspeccionada tal cual.
    if (task.status === 'inspected') return task

    this.assertNotPerformedBy(task, user)

    // No se aprueba una limpieza sin calificarla. Se refuerza acá el rango entero,
    // porque el validador del framework no garantiza min/max para números.
    if (!Number.isInteger(rating) || rating < RATING_MIN || rating > RATING_MAX) {
      throw new ValidationError(`La calificación debe ser un entero entre ${RATING_MIN} y ${RATING_MAX}`)
    }

    // Verificar que esté completada
    if (task.status !== 'completed') {
      throw new AuthError('Solo se pueden aprobar tareas completadas')
    }

    // Verificar que tenga presencia marcada
    if (!(task as any).supOnSiteTime) {
      throw new AuthError('Debes marcar presencia física antes de aprobar')
    }

    // Transición: completed → inspected
    assertTransition(task.status, 'inspected')

    const updated = await this.repo.update(taskId, {
      status: 'inspected',
      supervisorId: user.id,
      supervisorNote: note || null,
      rating,
      completedDate: new Date().toISOString(),
    } as any)

    if (!updated) throw new NotFoundError('Error al actualizar tarea')
    return updated
  }

  /**
   * El supervisor devuelve la limpieza a la camarera para que la repita.
   * Transición completed → pending (permitida) con la nota del motivo. La camarera
   * la vuelve a arrancar; la nota le dice qué corregir.
   */
  async reject(taskId: string, user: HkUser, note?: string): Promise<HousekeepingDTO> {
    const task = await this.ownedTask(taskId, user)

    this.assertNotPerformedBy(task, user)

    if (task.status !== 'completed') {
      throw new AuthError('Solo se pueden devolver tareas completadas')
    }

    assertTransition(task.status, 'pending')

    const updated = await this.repo.update(taskId, {
      status: 'pending',
      supervisorId: user.id,
      supervisorNote: note || null,
    } as any)

    if (!updated) throw new NotFoundError('Error al actualizar tarea')
    return updated
  }

  async markPresence(taskId: string, user: HkUser): Promise<void> {
    const task = await this.ownedTask(taskId, user)

    // La presencia del supervisor NO la marca quien limpió (ver assertNotPerformedBy).
    this.assertNotPerformedBy(task, user)

    // Solo supervisor puede marcar presencia
    if (task.status !== 'completed') {
      throw new AuthError('La tarea debe estar completada para marcar presencia')
    }

    await this.repo.update(taskId, {
      supOnSiteTime: new Date().toISOString(),
      supervisorId: user.id,
    } as any)
  }

  /**
   * La camarera reporta algo. `type: 'maintenance'` abre además un ticket real.
   *
   * Antes esto solo apendaba una línea a `notes` de la tarea de limpieza: el reporte moría ahí y
   * mantenimiento nunca veía ni la descripción ni las fotos de lo que había que arreglar.
   *
   * Orden: ticket → nota. Al revés, un fallo al abrir el ticket dejaba la nota escrita, y el
   * reintento la duplicaba. Ambos pasos son idempotentes: la app se usa con mala señal.
   */
  async reportIssue(
    taskId: string,
    description: string,
    type: string,
    reporter: { id: string; hotelId?: string; role: string },
    onIssueReported?: (issue: IssueReport) => Promise<void>,
  ): Promise<void> {
    // Este usecase no recibe `auth`, así que el ownership se comprueba explícito
    // contra `reporter.hotelId` apenas se carga la tarea.
    // @ignore IDOR_RISK — ownership verificado abajo contra reporter.hotelId
    const task = await this.repo.findById(taskId)
    if (!task) throw new NotFoundError('Tarea no encontrada')

    // Sin esto se podía reportar sobre la tarea de otro hotel, y el ticket
    // resultante nacía en ese hotel ajeno.
    const taskHotelId = (task as any).hotelId
    if (reporter.role !== 'super_admin' && taskHotelId !== reporter.hotelId) {
      throw new AuthError('La tarea no pertenece a tu hotel')
    }

    // El ticket PRIMERO. Si falla, el request muere y la camarera lo ve, sin dejar una nota
    // huérfana: reintentar desde la app arranca limpio. El ticket se deduplica por tarea.
    if (type === 'maintenance' && onIssueReported) {
      await onIssueReported({
        hotelId: taskHotelId,
        taskId,
        roomId: (task as any).roomId,
        description,
        photos: Array.isArray((task as any).photos) ? (task as any).photos : [],
        reportedBy: reporter.id,
      })
    }

    // La nota es idempotente: la app se usa con mala señal y el doble-toque es la regla, no la
    // excepción. Sin esto, reintentar dejaba la misma incidencia escrita tres veces.
    const existingNotes = (task as any).notes || ''
    if (existingNotes.includes(description)) return

    const reportEntry = `[${type.toUpperCase()}] ${new Date().toISOString()}: ${description}`
    const updatedNotes = existingNotes ? `${existingNotes}\n${reportEntry}` : reportEntry

    await this.repo.update(taskId, { notes: updatedNotes } as any)
  }
}
