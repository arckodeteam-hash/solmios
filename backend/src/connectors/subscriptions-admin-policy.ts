// connectors/subscriptions-admin-policy.ts — #28: la política de alta la define la PLATAFORMA.
//
// `subscription_settings` vive en el módulo `admin` (es config global del super-admin, editable
// desde /admin). `subscriptions` necesita dos lecturas de esa misma fila —`requireCardOnTrial`
// (el alta, para decidir si manda al Checkout antes de arrancar la prueba, y `access.ts`, para no
// dejar entrar a quien abandonó ese Checkout) y `founderCountdownEnabled/DurationDays` (el
// contador cíclico de /hotel-fundador)— pero los módulos no se importan entre sí: `subscriptions`
// declara UN solo puerto (`setPlatformSettingsDeps`) y este connector inyecta la lectura. Solo DELEGA.
import type { ConnectorContext } from 'arckode-framework'

interface AdminModule {
  getSubscriptionSettings: () => Promise<{
    requireCardOnTrial?: boolean
    founderCountdownEnabled?: boolean
    founderCountdownDurationDays?: number
  }>
}

export function subscriptionsAdminPolicyConnector(ctx: ConnectorContext): void {
  const subscriptions = ctx.resolveModule<{
    setPlatformSettingsDeps: (read: () => Promise<{ requireCardOnTrial: boolean; enabled: boolean; durationDays: number }>) => void
  }>('subscriptions')
  const admin = ctx.resolveModule<AdminModule>('admin')

  subscriptions.setPlatformSettingsDeps(async () => {
    const settings = await admin.getSubscriptionSettings()
    // Normalizado acá: el consumidor no puede recibir un `undefined` que se lea como "no exige
    // tarjeta"/"contador prendido" por accidente de serialización.
    return {
      requireCardOnTrial: settings?.requireCardOnTrial === true,
      enabled: settings?.founderCountdownEnabled === true,
      durationDays: Number(settings?.founderCountdownDurationDays),
    }
  })
}
