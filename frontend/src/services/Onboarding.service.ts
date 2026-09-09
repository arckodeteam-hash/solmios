import { http } from './http'

/** Un paso de la guía de configuración inicial. */
export interface OnboardingStep {
  key: string
  title: string
  /** Para qué sirve el paso, en una línea. */
  description: string
  /** Cómo se hace: qué botón apretar y qué datos se piden. */
  how: string
  /** Qué no va a poder hacer el hotel si saltea el paso. */
  impact: string
  route: string
  /** Texto del botón. Opcional: cae a "Empezar" si el backend no lo manda. */
  cta?: string
  done: boolean
  required: boolean
  /** `true` cuando `done` es `true` solo porque el valor quedó en su default de columna
   *  (`hotel`/`USD` en identidad, `ITBIS`/18 en políticas) — nadie lo confirmó todavía.
   *  El wizard lo pinta en amarillo con una nota, en vez de verde silencioso. */
  usingDefaults?: boolean
  count?: number
  /** F2 (wizard-refactor) — 'profile' se completa inline en el Centro de configuración
   *  (`useOnboardingStep.ts`); 'external' navega a su pantalla real. */
  kind: 'profile' | 'external'
}

export interface OnboardingStatus {
  /** `true` cuando lo obligatorio está hecho: la guía se esconde. */
  completed: boolean
  doneCount: number
  totalCount: number
  steps: OnboardingStep[]
}

export const OnboardingService = {
  async status(): Promise<OnboardingStatus> {
    const res = await http.get<any>('/onboarding/status')
    return (res?.data ?? res) as OnboardingStatus
  },
}
