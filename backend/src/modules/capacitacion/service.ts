// capacitacion/service.ts — Cursos/certificaciones + inscripciones de empleados.
// Multi-tenant: todo scopea por hotelId; el ownership se garantiza consultando por { id, hotelId }
// juntos (sin lookup por id suelto → sin IDOR).

import type { RepositoryAdapter, Logger, CacheAdapter } from 'arckode-framework'
import { NotFoundError, ValidationError } from 'arckode-framework'
import type {
  CourseDTO, CreateCourseDTO, EnrollmentDTO, CreateEnrollmentDTO,
} from './types'
import { buildEnrollmentEmail } from './usecases/emails'
import { StatsUseCase } from './usecases/stats'
import { auditSafely, type AuditPort } from '../../shared/usecases/audit'
import { composeSockets } from '../../shared/usecases/compose-sockets'
import type { CapacitacionSockets } from './sockets'
import { addMonths } from '../../shared/utils/add-months'
export type { TrainingStaffStat } from './usecases/stats'

/** Puerto de email (lo cablea email-bootstrap con setEmailDeps). */
export interface EmailPort {
  enqueue(input: { to: string; subject: string; html: string; hotelId: string; relatedType?: string; relatedId?: string }): Promise<string>
}

export class CapacitacionService {
  private emailSender?: EmailPort
  private userRepo?: RepositoryAdapter<{ id: string; name?: string; email?: string }>
  private publicUrl?: string
  private auditPort: AuditPort | null = null
  private sockets: CapacitacionSockets = {}
  private statsUc: StatsUseCase

  /** Conecta el audit log. Lo inyecta el connector `capacitacion-auditlog`. */
  setAuditDeps(port: AuditPort): void { this.auditPort = port }

  /** onEnrollmentCompleted → expediente del empleado (connector `capacitacion-empleados`). */
  setSockets(s: Partial<CapacitacionSockets>): void { composeSockets(this.sockets as any, s as any) }

  constructor(
    private readonly courseRepo: RepositoryAdapter<CourseDTO>,
    private readonly enrollRepo: RepositoryAdapter<EnrollmentDTO>,
    private readonly logger: Logger,
    private readonly cache: CacheAdapter,
    private readonly profileRepo?: RepositoryAdapter<{ id: string; hotelId: string; userId?: string }>,
  ) {
    this.statsUc = new StatsUseCase(enrollRepo)
  }

  /** Cursos completados por empleado en el período — motor de evaluación #321 (connector empleados-capacitacion). */
  async getStaffStats(hotelId: string, from: string, to: string) {
    return this.statsUc.getStaffStats(hotelId, from, to)
  }

  /** email-bootstrap cablea el envío de correo + cómo resolver el email del empleado. */
  setEmailDeps(emailSender: EmailPort, userRepo: RepositoryAdapter<any>, publicUrl?: string): void {
    this.emailSender = emailSender
    this.userRepo = userRepo
    this.publicUrl = publicUrl
  }

  /** Vencimiento de una certificación: hoy + validityMonths. null si el curso no vence. */
  private expiresFor(course: CourseDTO | null): string | null {
    const validity = Number(course?.validityMonths ?? 0)
    if (validity <= 0) return null
    // `setMonth` desborda cuando el día no existe en el mes destino: una certificación emitida
    // un 31 con validez de 1 mes vencía el 1 del subsiguiente. `addMonths` recorta al último día.
    return addMonths(new Date(), validity).toISOString()
  }

  // ─── Cursos ───────────────────────────────────────────
  async listCourses(hotelId: string): Promise<CourseDTO[]> { return this.courseRepo.findMany({ hotelId }) }

  async getCourse(id: string, hotelId: string): Promise<CourseDTO> {
    const c = await this.courseRepo.findOne({ id, hotelId })
    if (!c) throw new NotFoundError('Curso no encontrado')
    return c
  }

  async createCourse(dto: CreateCourseDTO): Promise<CourseDTO> {
    return this.courseRepo.create({ ...dto, active: 1 } as any)
  }

  async updateCourse(id: string, hotelId: string, dto: Partial<CreateCourseDTO> & { active?: number }): Promise<CourseDTO> {
    await this.getCourse(id, hotelId)
    return this.courseRepo.update(id, dto as any) as Promise<CourseDTO>
  }

  async deleteCourse(id: string, hotelId: string, actor?: { id?: string; role?: string }): Promise<void> {
    const course = await this.getCourse(id, hotelId)
    const enrolled = await this.enrollRepo.findMany({ courseId: id, hotelId })
    await Promise.all(enrolled.map((r) => this.enrollRepo.delete(r.id)))
    await this.courseRepo.delete(id)
    await auditSafely(this.auditPort, this.logger, {
      hotelId, userId: actor?.id, action: 'course.delete',
      entity: 'course', entityId: id,
      detail: `Curso "${course.name}" eliminado (${enrolled.length} inscripción/es dadas de baja)`,
    })
  }

  // ─── Inscripciones ────────────────────────────────────
  async listEnrollments(hotelId: string, employeeId?: string, courseId?: string): Promise<EnrollmentDTO[]> {
    const filters: Record<string, unknown> = { hotelId }
    if (employeeId) filters.employeeId = employeeId
    if (courseId) filters.courseId = courseId
    return this.enrollRepo.findMany(filters)
  }

  /** Inscribe a un empleado en un curso. Valida curso y empleado del hotel; no duplica inscripción activa. */
  async enroll(dto: CreateEnrollmentDTO): Promise<EnrollmentDTO> {
    const course = await this.getCourse(dto.courseId, dto.hotelId)   // curso del hotel
    let profile: { userId?: string } | null = null
    if (this.profileRepo) {
      profile = await this.profileRepo.findOne({ id: dto.employeeId, hotelId: dto.hotelId })
      if (!profile) throw new ValidationError('El empleado no pertenece a este hotel')
    }
    const dup = await this.enrollRepo.findOne({ hotelId: dto.hotelId, courseId: dto.courseId, employeeId: dto.employeeId, status: 'enrolled' })
    if (dup) throw new ValidationError('El empleado ya está inscripto en este curso')
    const confirmToken = crypto.randomUUID()
    const enrollment = await this.enrollRepo.create({ ...dto, status: 'enrolled', confirmToken, enrolledAt: new Date().toISOString() } as any)
    // Correo best-effort: si el email falla o no está configurado, la inscripción NO se rompe.
    this.notifyEnrolled(enrollment, course, profile?.userId).catch((e) => this.logger.warn('capacitacion: email de inscripción falló', { error: String(e) }))
    return enrollment
  }

  /** Manda el correo de inscripción con el material y el link para autoconfirmar. */
  private async notifyEnrolled(enrollment: EnrollmentDTO, course: CourseDTO, userId?: string): Promise<void> {
    if (!this.emailSender || !this.userRepo || !userId) return
    const user = await this.userRepo.findById(userId)
    if (!user?.email) return
    const confirmUrl = this.publicUrl && enrollment.confirmToken
      ? `${this.publicUrl.replace(/\/$/, '')}/api/training/confirm/${enrollment.confirmToken}` : null
    const { subject, html } = buildEnrollmentEmail({
      employeeName: user.name ?? '', courseName: course.name, materialUrl: course.materialUrl, confirmUrl,
    })
    await this.emailSender.enqueue({ to: user.email, subject, html, hotelId: enrollment.hotelId, relatedType: 'training', relatedId: enrollment.id })
  }

  /** Marca la inscripción como completada; si el curso vence, calcula expiresAt. */
  async complete(id: string, hotelId: string, score?: number): Promise<EnrollmentDTO> {
    const enrollment = await this.enrollRepo.findOne({ id, hotelId })
    if (!enrollment) throw new NotFoundError('Inscripción no encontrada')
    const course = await this.courseRepo.findOne({ id: enrollment.courseId, hotelId })
    const updated = await this.enrollRepo.update(id, {
      status: 'completed', completedAt: new Date().toISOString(), expiresAt: this.expiresFor(course), score: score ?? null,
    } as any) as EnrollmentDTO
    // Curso completado → registrarlo en el expediente del empleado (connector capacitacion-empleados).
    await this.sockets.onEnrollmentCompleted?.(updated, course?.name)
    return updated
  }

  /** Solo lectura: nombre del curso de un token (para la PÁGINA de confirmación; no marca nada). */
  async peekByToken(token: string): Promise<string | null> {
    if (!token) return null
    const enrollment = await this.enrollRepo.findOne({ confirmToken: token })
    if (!enrollment) return null
    const course = await this.courseRepo.findOne({ id: enrollment.courseId, hotelId: enrollment.hotelId })
    return course?.name ?? '—'
  }

  /** Confirmación del empleado desde el link del correo (público, sin login: el token es la llave). */
  async confirmByToken(token: string): Promise<{ courseName: string | null; alreadyDone: boolean } | null> {
    if (!token) return null
    const enrollment = await this.enrollRepo.findOne({ confirmToken: token })
    if (!enrollment) return null
    const course = await this.courseRepo.findOne({ id: enrollment.courseId, hotelId: enrollment.hotelId })
    const alreadyDone = enrollment.status === 'completed'
    if (!alreadyDone) {
      await this.enrollRepo.update(enrollment.id, { status: 'completed', completedAt: new Date().toISOString(), expiresAt: this.expiresFor(course) } as any)
    }
    return { courseName: course?.name ?? null, alreadyDone }
  }

  async deleteEnrollment(id: string, hotelId: string, actor?: { id?: string; role?: string }): Promise<void> {
    const e = await this.enrollRepo.findOne({ id, hotelId })
    if (!e) throw new NotFoundError('Inscripción no encontrada')
    await this.enrollRepo.delete(id)
    await auditSafely(this.auditPort, this.logger, {
      hotelId, userId: actor?.id, action: 'enrollment.delete',
      entity: 'enrollment', entityId: id,
      detail: `Inscripción del empleado ${e.employeeId} al curso ${e.courseId} eliminada`,
    })
  }
}
