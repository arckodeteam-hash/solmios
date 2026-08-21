// onboarding.ts — Qué le falta configurar al hotel para poder trabajar.
//
// Un hotel recién registrado entra a un panel con todo en cero y ninguna pista
// de por dónde empezar. Esta es la guía, y se calcula mirando los DATOS REALES:
// un checklist que se marca solo porque alguien apretó "listo" miente en cuanto
// el hotel borra lo que había cargado.
//
// El orden importa: los datos del hotel van primeros (#35 — el dueño los pide
// así: son lo que el huésped ve y lo que sale impreso, y no dependen de nada).
// Después las habitaciones: sin ellas no se puede cargar una reserva.
import type { RepositoryAdapter } from 'arckode-framework'

export interface OnboardingStep {
  key: string
  title: string
  /** Para qué sirve el paso, en una línea. */
  description: string
  /**
   * Cómo se hace, concreto. Una guía que solo dice "cargá tus habitaciones" y
   * tira al usuario a una pantalla vacía no explica nada: hay que decir qué
   * botón apretar y qué se pide.
   */
  how: string
  /** Qué NO va a poder hacer si se saltea este paso. */
  impact: string
  /** A dónde va el botón. */
  route: string
  /** Texto del botón: "Cargar habitaciones" dice más que "Empezar". */
  cta: string
  done: boolean
  /** Sin esto el hotel no puede operar; lo demás mejora la operación. */
  required: boolean
  /** Cuántos ítems ya tiene cargados (para mostrar "3 habitaciones"). */
  count?: number
}

export interface OnboardingStatus {
  /** `true` cuando ya no hay nada obligatorio pendiente: la guía se esconde. */
  completed: boolean
  /** Pasos hechos sobre el total, para la barra de progreso. */
  doneCount: number
  totalCount: number
  steps: OnboardingStep[]
}

export interface OnboardingDeps {
  roomsRepo: RepositoryAdapter<any>
  usersRepo: RepositoryAdapter<any>
  ratesRepo?: RepositoryAdapter<any>
  hotelsRepo: RepositoryAdapter<any>
  /** `channel_config` del hotel: si tiene propiedad asignada, está conectado. */
  channelsRepo?: RepositoryAdapter<any>
}

export class OnboardingUseCase {
  constructor(private readonly deps: OnboardingDeps) {}

  async status(hotelId: string): Promise<OnboardingStatus> {
    const [rooms, users, hotel, rates, channels] = await Promise.all([
      this.deps.roomsRepo.findMany({ hotelId }).catch(() => []),
      this.deps.usersRepo.findMany({ hotelId }).catch(() => []),
      this.deps.hotelsRepo.findById(hotelId).catch(() => null),
      this.deps.ratesRepo?.findMany({ hotelId }).catch(() => []) ?? [],
      this.deps.channelsRepo?.findMany({ hotelId }).catch(() => []) ?? [],
    ])

    // El dueño se creó solo en el alta: el paso se cumple cuando sumó a ALGUIEN
    // más, que es lo que de verdad significa "armé mi equipo".
    const team = (users as any[]).length
    const hotelReady = Boolean(hotel?.phone || hotel?.address)

    // Conectado = tiene una propiedad asignada en el channel manager. Que exista
    // la fila de configuración no alcanza: se crea vacía al entrar a la vista.
    const connected = (channels as any[]).some(c => String(c?.channexPropertyId ?? '').trim() !== '')

    const steps: OnboardingStep[] = [
      {
        key: 'hotel',
        title: 'Completá los datos del hotel',
        description: 'Dirección, teléfono y moneda: es lo que ve tu huésped y lo que sale impreso.',
        how: 'Andá a Configuración → Datos del hotel. Completá dirección, teléfono, moneda e impuestos. Los impuestos se aplican solos en cada factura, así que conviene cargarlos antes de cobrar.',
        impact: 'Sin esto las facturas salen sin tus datos y los mensajes al huésped quedan incompletos.',
        route: '/panel/config',
        cta: 'Completar datos',
        done: hotelReady,
        required: true,
      },
      {
        key: 'rooms',
        title: 'Cargá tus habitaciones',
        description: 'El inventario que vas a vender: cada habitación con su número, tipo y capacidad.',
        how: 'Entrá a Habitaciones y usá "Nueva habitación". Cargá número (101, 102…), tipo (Doble, Suite) y cuántas personas entran. Si tenés varias iguales, cargá una y repetí cambiando el número.',
        impact: 'Sin habitaciones el calendario está vacío y no podés tomar ninguna reserva.',
        route: '/panel/config/habitaciones',
        cta: 'Cargar habitaciones',
        done: (rooms as any[]).length > 0,
        required: true,
        count: (rooms as any[]).length,
      },
      {
        key: 'rates',
        title: 'Definí tus tarifas',
        description: 'Cuánto cuesta cada tipo de habitación por noche.',
        how: 'En Configuración → Temporadas y Tarifas armás la grilla: por cada tipo de habitación y cantidad de personas, el precio por noche. Podés tener temporadas (alta, baja) con precios distintos.',
        impact: 'Sin tarifas cada reserva hay que tarifarla a mano y el motor de reservas no puede cotizar.',
        route: '/panel/config/tarifas',
        cta: 'Definir tarifas',
        done: (rates as any[]).length > 0,
        required: false,
        count: (rates as any[]).length,
      },
      {
        key: 'channels',
        title: 'Conectá tus canales de venta',
        description: 'Booking, Airbnb, Expedia y las demás OTAs, sincronizadas con tu disponibilidad.',
        how: 'Entrá a Canales y pedí la conexión. Una vez vinculada tu propiedad, mapeás cada tipo de habitación y su tarifa con el canal. A partir de ahí la disponibilidad y los precios viajan solos, y las reservas de las OTAs entran a tu calendario.',
        impact: 'Sin conectar los canales tenés que cargar a mano cada reserva que llega de una OTA, y arriesgás vender dos veces la misma noche.',
        route: '/panel/channel-manager',
        cta: 'Conectar canales',
        done: connected,
        required: false,
      },
      {
        key: 'team',
        title: 'Sumá a tu equipo',
        description: 'Recepción, camareras y mantenimiento, cada uno viendo solo lo suyo.',
        how: 'En Equipo invitás por email y elegís el rol: recepción toma reservas y cobra, limpieza ve sus tareas del día, mantenimiento sus tickets. Cada rol trae sus permisos ya armados.',
        impact: 'Sin equipo cargado hacés todo desde tu usuario y nadie más puede operar el hotel.',
        route: '/panel/rrhh/team',
        cta: 'Invitar al equipo',
        done: team > 1,
        required: false,
        count: Math.max(0, team - 1),
      },
    ]

    const doneCount = steps.filter(s => s.done).length
    return {
      // La guía se esconde cuando lo obligatorio está hecho: dejarla para
      // siempre por un paso opcional la convierte en ruido.
      completed: steps.filter(s => s.required).every(s => s.done),
      doneCount,
      totalCount: steps.length,
      steps,
    }
  }
}
