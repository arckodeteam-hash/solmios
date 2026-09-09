// connectors/ai-recepcionista-consumo.ts — Consumo de WhatsApp: datos de Meta y cupo del plan.
//
// Junta tres cosas que viven separadas: el repo del consumo (ORM), el cliente de Meta (services/) y
// el cupo del hotel, que sale de su plan y es del módulo `subscriptions`. Sin este connector el
// panel no puede mostrar consumo y el corte por tope no existe.

import type { ConnectorContext } from 'arckode-framework'
import { OrmRepository } from 'arckode-framework'
import { getConversationUsage } from '../services/whatsapp-cloud-client'
import { cupoDesdeLimits, CUPO_POR_DEFECTO } from '../modules/ai-recepcionista/usecases/whatsapp-usage'

interface AiModuleWithUsage {
  getWhatsappCredentials(hotelId: string): Promise<{ wabaId: string; accessToken: string; phoneNumberId: string } | null>
  setUsageDeps(p: any): void
}

/** Lo que hace falta del módulo de suscripciones para saber qué plan tiene el hotel. */
interface SubscriptionsModule {
  planDeHotel?(hotelId: string): Promise<{ limits?: unknown } | null>
}

export function aiRecepcionistaConsumoConnector(ctx: ConnectorContext, orm: any): void {
  const ai = ctx.resolveModule<AiModuleWithUsage>('ai-recepcionista')

  // El módulo de suscripciones puede no exponer el plan todavía: en ese caso todos los hoteles
  // quedan con el cupo por defecto, que es conservador. Mejor un tope bajo que ninguno: el que
  // paga las conversaciones es la plataforma.
  let subs: SubscriptionsModule | null = null
  try { subs = ctx.resolveModule<SubscriptionsModule>('subscriptions') } catch { subs = null }

  ai.setUsageDeps({
    usageRepo: new OrmRepository<any>(orm, 'WhatsappUsageDaily'),
    meta: {
      credentialsFor: async (hotelId: string) => {
        const c = await ai.getWhatsappCredentials(hotelId)
        return c?.wabaId ? { wabaId: c.wabaId, accessToken: c.accessToken, phoneNumberId: c.phoneNumberId } : null
      },
      getUsage: getConversationUsage,
    },
    cupoPort: {
      cupoMensual: async (hotelId: string): Promise<number | null> => {
        if (!subs?.planDeHotel) return CUPO_POR_DEFECTO
        try {
          const plan = await subs.planDeHotel(hotelId)
          return cupoDesdeLimits(plan?.limits)
        } catch {
          // Si no se puede leer el plan, NO se deja pasar sin tope: se aplica el default.
          return CUPO_POR_DEFECTO
        }
      },
    },
  })
}
