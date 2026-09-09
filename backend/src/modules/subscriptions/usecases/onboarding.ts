// onboarding.ts — Qué le falta configurar al hotel para poder trabajar.
//
// Un hotel recién registrado entra a un panel con todo en cero y ninguna pista
// de por dónde empezar. Esta es la guía, y se calcula mirando los DATOS REALES:
// un checklist que se marca solo porque alguien apretó "listo" miente en cuanto
// el hotel borra lo que había cargado.
//
// El orden importa (#35, actualizado F2 wizard-refactor tarea 2.8): perfil
// primero (bienvenida→identidad→contacto→ubicacion→politicas, todos
// `kind:'profile'`, se completan inline en el Centro de configuración) — son lo
// que el huésped ve y lo que sale impreso, y no dependen de nada. Después el
// único operativo que queda (`kind:'external'`, navega a su pantalla real):
// habitaciones — sin inventario no hay nada que vender.
//
// Hubo varios pasos más que se sacaron (2026-09-08), todos opcionales, ninguno
// bloqueaba `completed` ni el %:
//  - `team`/"Sume a su equipo": armar el equipo no es un requisito de
//    onboarding, el dueño solo opera bien igual.
//  - `amenities`/"Cuente qué ofrece su hotel": esa configuración es propia de
//    Página pública (`pagina-publica/general.vue`, sección "Amenities del
//    hotel") — el wizard de alta no es el lugar, evita una segunda superficie
//    editando lo mismo.
//  - `rates`/"Defina sus tarifas" y `channels`/"Conecte sus canales de venta":
//    pedido explícito — se sacan del wizard de alta, quedan solo accesibles
//    desde Configuración → Tarifas y Canales respectivamente.
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
  /**
   * `true` cuando `done` es `true` únicamente porque el campo trae el default de columna
   * (`hotel`/`USD` en `identidad`, `ITBIS`/18 en `politicas`) — nadie confirmó que ese valor
   * sea correcto para ESTE hotel. No hay columna que distinga "confirmado" de "nunca tocado"
   * (doc 06 sección 7, riesgo R1 aceptado), así que esto es un heurístico: compara contra el
   * default conocido, no contra "el usuario lo guardó a propósito". Un hotel que genuinamente
   * opera en USD/Hotel o paga ITBIS 18% también da `true` acá — el costo de un falso positivo
   * (nota de más) es mucho más barato que el de un falso negativo (factura con el impuesto de
   * otro país, en silencio). El frontend lo usa para pintar el paso en amarillo con una nota,
   * NUNCA para bloquear el guardado ni excluirlo de `completed`/el % — sigue siendo `done`.
   */
  usingDefaults?: boolean
  /** Cuántos ítems ya tiene cargados (para mostrar "3 habitaciones"). */
  count?: number
  /** F2 (wizard-refactor tarea 2.1) — 'profile' se completa inline en el Centro de
   *  configuración (`useOnboardingStep.ts`); 'external' navega a su pantalla real. */
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
  hotelsRepo: RepositoryAdapter<any>
  /** KV `configuration` — guarda que el usuario guardó el paso de perfil explícitamente
   *  (ver `ONBOARDING_CONFIRM_KEYS`), aunque haya dejado el valor en su default. Opcional:
   *  sin cablear, `usingDefaults` se calcula solo con el heurístico de valores (como antes). */
  configRepo?: RepositoryAdapter<any>
}

/** Claves KV (`configuration`, por hotel) que marca cada Step*.vue al guardar — ver
 *  `StepIdentidad.vue`/`StepPoliticas.vue`. Guardar "apaga" `usingDefaults` para siempre en
 *  ese paso, sin importar si el valor sigue siendo el default: el usuario ya lo confirmó a
 *  propósito, dejar de avisarle es lo correcto (pedido explícito del usuario). */
export const ONBOARDING_CONFIRM_KEYS: Record<'identidad' | 'politicas', string> = {
  identidad: 'onboarding_identidad_confirmed',
  politicas: 'onboarding_politicas_confirmed',
}

export class OnboardingUseCase {
  constructor(private readonly deps: OnboardingDeps) {}

  async status(hotelId: string): Promise<OnboardingStatus> {
    const [rooms, users, hotel, confirmedRows] = await Promise.all([
      this.deps.roomsRepo.findMany({ hotelId }).catch(() => []),
      this.deps.usersRepo.findMany({ hotelId }).catch(() => []),
      this.deps.hotelsRepo.findById(hotelId).catch(() => null),
      this.deps.configRepo?.findMany({ hotelId }).catch(() => []) ?? Promise.resolve([]),
    ])
    const confirmedKeys = new Set((confirmedRows as any[]).map((r) => r?.key))
    const identidadConfirmed = confirmedKeys.has(ONBOARDING_CONFIRM_KEYS.identidad)
    const politicasConfirmed = confirmedKeys.has(ONBOARDING_CONFIRM_KEYS.politicas)

    // El dueño/gerente que completó el alta — `users.name` (F2 tarea 2.2, doc 02
    // sección B): el "nombre del propietario" del registro se guarda ahí, NO en
    // `hotels.ownerName` (ese es un campo distinto, fiscal, de Configuración → Hotel).
    const owner = (users as any[]).find(u => u?.role === 'hotel_admin') ?? (users as any[])[0]
    const ownerNameResuelto = Boolean(owner?.name && String(owner.name).trim())

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
        // queda sin tocar. Igual se avisa (`usingDefaults`, pedido explícito del
        // usuario tras ver un alta nueva "completa" sin haber tocado nada): amarillo
        // + nota en vez de verde silencioso, sin bloquear ni descontar del %.
        done: Boolean(hotel?.accommodationType && hotel?.currency),
        usingDefaults: !identidadConfirmed && hotel?.accommodationType === 'hotel' && hotel?.currency === 'USD',
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
        // silencio, deuda conocida y aceptada (doc 08, riesgo R1). `usingDefaults`
        // (pedido explícito del usuario) refuerza esa mitigación en el wizard mismo:
        // amarillo + nota en vez de verde, sin bloquear ni descontar del %.
        done: Boolean(hotel?.taxName && hotel?.taxRate),
        usingDefaults: !politicasConfirmed && hotel?.taxName === 'ITBIS' && Number(hotel?.taxRate) === 18,
        required: true,
        kind: 'profile',
      },
      // ─── Operativo (sin cambios de lógica, solo `kind: 'external'` nuevo) ──────
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
