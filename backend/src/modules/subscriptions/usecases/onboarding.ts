// onboarding.ts — Qué le falta configurar al hotel para poder trabajar.
//
// Un hotel recién registrado entra a un panel con todo en cero y ninguna pista
// de por dónde empezar. Esta es la guía, y se calcula mirando los DATOS REALES:
// un checklist que se marca solo porque alguien apretó "listo" miente en cuanto
// el hotel borra lo que había cargado.
//
// El orden importa (#35, actualizado F2 wizard-refactor tarea 2.8): perfil
// primero (bienvenida→identidad→contacto→ubicacion→politicas→amenities, todos
// `kind:'profile'`, se completan inline en el Centro de configuración) — son lo
// que el huésped ve y lo que sale impreso, y no dependen de nada. Después los
// operativos (`kind:'external'`, navegan a su pantalla real): habitaciones,
// tarifas, canales. (Hubo un cuarto paso, `team`/"Sume a su equipo" — se sacó
// 2026-09-08: armar el equipo no es un requisito de onboarding, el dueño solo
// opera bien igual.)
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
  /** F2 (wizard-refactor tarea 2.1) — 'profile' se completa inline en el Centro de
   *  configuración (`useOnboardingStep.ts`); 'external' navega a su pantalla real
   *  (comportamiento de siempre para rooms/rates/channels, sin cambios). */
  kind: 'profile' | 'external'
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
  /** F2 (tarea 2.7) — `Configuration` KV, para leer `child_policy` (paso `amenities`).
   *  Opcional: sin ella, `amenities.done` solo mira las amenities cargadas. */
  configRepo?: RepositoryAdapter<any>
  /** F2 (tarea 2.7, D3) — `hotel_amenities` (tabla real, no la columna JSON vieja de
   *  `hotels.amenities` — ver fix de 1.7b en `public-hotel-info.ts`). Opcional: sin
   *  ella, `amenities.done` solo mira si se tocó la política de niños. */
  hotelAmenitiesRepo?: RepositoryAdapter<any>
}

export class OnboardingUseCase {
  constructor(private readonly deps: OnboardingDeps) {}

  async status(hotelId: string): Promise<OnboardingStatus> {
    const [rooms, users, hotel, rates, channels, childPolicyRow, hotelAmenities] = await Promise.all([
      this.deps.roomsRepo.findMany({ hotelId }).catch(() => []),
      this.deps.usersRepo.findMany({ hotelId }).catch(() => []),
      this.deps.hotelsRepo.findById(hotelId).catch(() => null),
      this.deps.ratesRepo?.findMany({ hotelId }).catch(() => []) ?? [],
      this.deps.channelsRepo?.findMany({ hotelId }).catch(() => []) ?? [],
      this.deps.configRepo?.findOne({ hotelId, key: 'child_policy' } as Record<string, unknown>).catch(() => null) ?? null,
      this.deps.hotelAmenitiesRepo?.findMany({ hotelId, isActive: 1 }).catch(() => []) ?? [],
    ])

    // El dueño/gerente que completó el alta — `users.name` (F2 tarea 2.2, doc 02
    // sección B): el "nombre del propietario" del registro se guarda ahí, NO en
    // `hotels.ownerName` (ese es un campo distinto, fiscal, de Configuración → Hotel).
    const owner = (users as any[]).find(u => u?.role === 'hotel_admin') ?? (users as any[])[0]
    const ownerNameResuelto = Boolean(owner?.name && String(owner.name).trim())

    // Conectado = tiene una propiedad asignada en el channel manager. Que exista
    // la fila de configuración no alcanza: se crea vacía al entrar a la vista.
    const connected = (channels as any[]).some(c => String(c?.channexPropertyId ?? '').trim() !== '')

    // Política de niños "tocada" = existe la fila en `configuration` (el hotel entró
    // al menos una vez a guardarla) — DISTINTO de "resolveChildPolicy() no devolvió
    // el default", que también sería true para una fila vacía. Acá interesa saber si
    // el hotel pasó por el paso, no el valor resultante.
    const childPolicyTocada = Boolean((childPolicyRow as any)?.value)

    const steps: OnboardingStep[] = [
      // ─── Perfil (F2, wizard-refactor) — se completan inline en el Centro de
      // configuración (`/panel/configuracion-inicial`), reemplazan al viejo paso
      // único `hotel` (mal calibrado: `Boolean(phone || address)` nacía "hecho" con
      // datos que ya traía el registro, sin que el usuario los hubiera revisado). ──
      {
        key: 'bienvenida',
        title: 'Cuente lo básico de su hotel',
        description: 'Nombre, país, teléfono y email: lo mínimo para identificarlo y poder contactarlo.',
        how: 'Ingrese al Centro de configuración y complete el paso Bienvenida: nombre del hotel, país, su teléfono, el email de contacto y su nombre como dueño o gerente.',
        impact: 'Sin esto no podrá recibir avisos del sistema y el huésped no sabrá a quién le está reservando.',
        route: '/panel/configuracion-inicial',
        cta: 'Completar bienvenida',
        // `phone` requerido explícito (doc 08 D1) — antes del registro ya lo trae,
        // pero un hotel dado de alta a mano por el super-admin podría no tenerlo.
        done: Boolean(hotel?.name && hotel?.country && hotel?.phone && hotel?.email && ownerNameResuelto),
        required: true,
        kind: 'profile',
      },
      {
        key: 'identidad',
        title: 'Defina el tipo de alojamiento',
        description: 'Qué tipo de propiedad es y en qué moneda cobra — la base de su página pública.',
        how: 'En el paso Identidad del Centro de configuración elija el tipo de alojamiento (hotel, aparta-hotel, hostal…) y confirme la moneda en la que va a cobrar.',
        impact: 'Sin esto su página pública muestra datos genéricos y las tarifas pueden salir en la moneda equivocada.',
        route: '/panel/configuracion-inicial',
        cta: 'Definir identidad',
        // Decisión (tarea 2.3): `accommodationType`/`currency` tienen default de
        // columna ('hotel'/'USD', `hoteles/model.ts`) — no hay forma de distinguir
        // "el usuario confirmó el default" de "nunca pasó por acá" sin una columna
        // nueva (fuera de alcance, doc 06 sección 7: "Ninguna migración"). Se cuenta
        // el default como hecho a propósito: a diferencia de los impuestos (ver
        // paso `politicas` más abajo, riesgo R1), un tipo "Hotel" en USD no es un
        // dato fiscal sesgado que pueda generarle un problema real al hotelero si
        // queda sin tocar.
        done: Boolean(hotel?.accommodationType && hotel?.currency),
        required: true,
        kind: 'profile',
      },
      {
        key: 'contacto',
        title: 'Sume datos de contacto extra',
        description: 'Un segundo teléfono, su sitio web o su identificación fiscal — todo opcional.',
        how: 'En el paso Contacto puede cargar un teléfono secundario, su sitio web y su identificación fiscal (CIF/NIF/RNC) si factura con eso.',
        impact: 'No se bloquea nada sin esto — son datos que suman pero no son obligatorios.',
        route: '/panel/configuracion-inicial',
        cta: 'Completar contacto',
        done: Boolean(hotel?.phone2 || hotel?.website || hotel?.ownerTaxId),
        required: false,
        kind: 'profile',
      },
      {
        key: 'ubicacion',
        title: 'Marque dónde está su hotel',
        description: 'Dirección y coordenadas exactas: así el huésped lo encuentra en el mapa.',
        how: 'En el paso Ubicación busque su dirección o muévase en el mapa hasta el pin correcto — provincia, municipio y código postal se completan solos.',
        impact: 'Sin coordenadas reales su hotel no aparece bien ubicado en la página pública ni en el motor de reservas.',
        route: '/panel/configuracion-inicial',
        cta: 'Marcar ubicación',
        // `latitude`/`longitude` tienen default `0` (`hoteles/model.ts`) — no es una
        // coordenada real. `Boolean(0)` ya da `false` en JS por ser falsy, que es el
        // comportamiento correcto; se deja explícito acá (y cubierto por test) para
        // que nadie lo "simplifique" sin querer más adelante.
        done: Boolean(hotel?.address && hotel?.latitude && hotel?.longitude),
        required: true,
        kind: 'profile',
      },
      {
        key: 'politicas',
        title: 'Confirme impuestos y cancelación',
        description: 'El impuesto que aplica a cada factura y su política de cancelación.',
        how: 'En el paso Políticas revise el nombre y porcentaje del impuesto (viene con un valor de referencia, confírmelo o cámbielo) y elija su política de cancelación.',
        impact: 'Sin confirmarlo, sus facturas pueden salir con un impuesto que no corresponde a su país.',
        route: '/panel/configuracion-inicial',
        cta: 'Confirmar políticas',
        // Decisión (tarea 2.6, mismo criterio que `identidad` arriba): `taxName`/
        // `taxRate` traen default 'ITBIS'/18.0 (SESGADO a RD — riesgo R1, doc 08).
        // Acá también se cuenta el default como hecho — la razón es la MISMA que
        // en `identidad`: sin una columna "confirmado" nueva (fuera de alcance) no
        // hay forma de distinguirlo de un valor real. La MITIGACIÓN de R1 no vive
        // acá: vive en `StepPoliticas.vue` (F3.9), que SIEMPRE muestra el campo de
        // impuestos y obliga a un guardado explícito del paso, con o sin cambios —
        // un hotel que jamás pasa por el wizard sigue expuesto al default en
        // silencio, deuda conocida y aceptada (doc 08, riesgo R1).
        done: Boolean(hotel?.taxName && hotel?.taxRate),
        required: true,
        kind: 'profile',
      },
      {
        key: 'amenities',
        title: 'Cuente qué ofrece su hotel',
        description: 'Piscina, wifi, desayuno… lo que tiene en su propiedad, para mostrar en la página pública.',
        how: 'En el paso Amenities marque los servicios e instalaciones que tiene, o al menos defina su política de niños.',
        impact: 'No se bloquea nada sin esto, pero su página pública se ve más completa con algunas amenities cargadas.',
        route: '/panel/configuracion-inicial',
        cta: 'Cargar amenities',
        // Fuente: `hotel_amenities` (tabla real, D3/tarea 0.4) — NO la columna JSON
        // vieja `hotels.amenities`, que ya no es la fuente de verdad desde el fix
        // de la tarea 1.7b (`getPublicHotelInfo` tenía el mismo bug).
        done: Boolean((hotelAmenities as any[]).length > 0 || childPolicyTocada),
        required: false,
        kind: 'profile',
      },
      // ─── Operativos (sin cambios de lógica, solo `kind: 'external'` nuevo) ──────
      {
        key: 'rooms',
        title: 'Cargue sus habitaciones',
        description: 'El inventario que va a vender: cada habitación con su número, tipo y capacidad.',
        how: 'Ingrese a Habitaciones y use "Nueva habitación". Cargue número (101, 102…), tipo (Doble, Suite) y cuántas personas entran. Si tiene varias iguales, cargue una y repita cambiando el número.',
        impact: 'Sin habitaciones el calendario está vacío y no podrá tomar ninguna reserva.',
        route: '/panel/config/habitaciones',
        cta: 'Cargar habitaciones',
        done: (rooms as any[]).length > 0,
        required: true,
        count: (rooms as any[]).length,
        kind: 'external',
      },
      {
        key: 'rates',
        title: 'Defina sus tarifas',
        description: 'Cuánto cuesta cada tipo de habitación por noche.',
        how: 'En Configuración → Temporadas y Tarifas arma la grilla: por cada tipo de habitación y cantidad de personas, el precio por noche. Puede tener temporadas (alta, baja) con precios distintos.',
        impact: 'Sin tarifas cada reserva hay que tarifarla a mano y el motor de reservas no puede cotizar.',
        route: '/panel/config/tarifas',
        cta: 'Definir tarifas',
        done: (rates as any[]).length > 0,
        required: false,
        count: (rates as any[]).length,
        kind: 'external',
      },
      {
        key: 'channels',
        title: 'Conecte sus canales de venta',
        description: 'Booking, Airbnb, Expedia y las demás OTAs, sincronizadas con su disponibilidad.',
        how: 'Ingrese a Canales y pida la conexión. Una vez vinculada su propiedad, mapee cada tipo de habitación y su tarifa con el canal. A partir de ahí la disponibilidad y los precios viajan solos, y las reservas de las OTAs entran a su calendario.',
        impact: 'Sin conectar los canales tiene que cargar a mano cada reserva que llega de una OTA, y arriesga vender dos veces la misma noche.',
        route: '/panel/channel-manager',
        cta: 'Conectar canales',
        done: connected,
        required: false,
        kind: 'external',
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
