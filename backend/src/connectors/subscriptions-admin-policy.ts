// connectors/subscriptions-admin-policy.ts — #28: la política de alta la define la PLATAFORMA.
//
// `subscription_settings.requireCardOnTrial` vive en el módulo `admin` (es config global del
// super-admin, editable desde /admin). `subscriptions` la necesita en dos lugares —el alta, para
// decidir si manda al Checkout antes de arrancar la prueba, y `access.ts`, para no dejar entrar a
// quien abandonó ese Checkout— pero los módulos no se importan entre sí: `subscriptions` declara
// el puerto (`setSignupPolicyDeps`) y este connector inyecta la lectura. Solo DELEGA.
import type { ConnectorContext } from 'arckode-framework'

interface AdminModule {
  getSubscriptionSettings: () => Promise<{ requireCardOnTrial?: boolean }>
}

export function subscriptionsAdminPolicyConnector(ctx: ConnectorContext): void {
  const subscriptions = ctx.resolveModule<{
    setSignupPolicyDeps: (read: () => Promise<{ requireCardOnTrial: boolean }>) => void
  }>('subscriptions')
  const admin = ctx.resolveModule<AdminModule>('admin')

  subscriptions.setSignupPolicyDeps(async () => {
    const settings = await admin.getSubscriptionSettings()
    // Normalizado a boolean acá: el consumidor decide un corte de acceso con esto y no puede
    // recibir un `undefined` que se lea como "no exige tarjeta" por accidente de serialización.
    return { requireCardOnTrial: settings?.requireCardOnTrial === true }
  })
}
