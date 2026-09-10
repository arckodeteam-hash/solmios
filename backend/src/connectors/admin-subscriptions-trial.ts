// connectors/admin-subscriptions-trial.ts — REQ-PIPE-05 (#146): el super-admin extiende un trial.
//
// `admin` expone el botón (`POST /api/admin/subscriptions/:hotelId/extend-trial`) y audita;
// `subscriptions` es dueño de la fila y del correo `trial_extended`
// (`subscriptions/usecases/extend-trial.ts`). Los módulos no se importan entre sí: `admin`
// declara el puerto (`setTrialDeps`) y este connector inyecta la implementación. Solo DELEGA.
import type { ConnectorContext } from 'arckode-framework'

interface ExtendTrialOutcome {
  subscription: any
  daysLeft: number
  previousTrialEndsAt: string | null
  emailSent: boolean
}

interface SubscriptionsModule {
  extendTrial: (hotelId: string, days: number) => Promise<ExtendTrialOutcome>
}

export function adminSubscriptionsTrialConnector(ctx: ConnectorContext): void {
  const admin = ctx.resolveModule<{ setTrialDeps: (p: { extendTrial: SubscriptionsModule['extendTrial'] }) => void }>('admin')
  const subscriptions = ctx.resolveModule<SubscriptionsModule>('subscriptions')

  admin.setTrialDeps({
    extendTrial: (hotelId: string, days: number) => subscriptions.extendTrial(hotelId, days),
  })
}
