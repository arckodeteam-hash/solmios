// useOnboardingStep.ts — guardado aislado de un paso de perfil del Centro de configuración
// (wizard-refactor F3, tarea 3.1). Cada paso (`StepBienvenida.vue`, `StepIdentidad.vue`, etc.)
// persiste en su/s propio/s endpoint/s — `saveFn` lo define el step, no este composable (algunos
// pasos guardan en un solo PUT, `bienvenida` guarda en DOS: `/settings/hotel` + `/auth/me`).
//
// Después de guardar OK, refresca `GET /api/onboarding/status` y se lo pasa a `onSaved` — así el
// acordeón (`configuracion-inicial/index.vue`) actualiza el check del paso sin recargar la
// pantalla entera ni que cada step tenga que saber cómo pedir ese estado.
import { ref } from 'vue'
import { OnboardingService, type OnboardingStatus } from '@/services/Onboarding.service'

export function useOnboardingStep(
  saveFn: () => Promise<void>,
  onSaved?: (status: OnboardingStatus) => void,
) {
  const saving = ref(false)
  const error = ref('')

  async function save(): Promise<void> {
    // Protección contra doble submit: un segundo click mientras el primer request sigue en
    // vuelo no dispara un segundo request (doble POST/PUT, o dos toasts de éxito).
    if (saving.value) return
    saving.value = true
    error.value = ''
    try {
      await saveFn()
      const status = await OnboardingService.status()
      onSaved?.(status)
    } catch (e) {
      // Mensaje real del ApiError (`http.ts`), no un genérico — mismo criterio que el resto
      // de los `save()` de la app (ver `pagina-publica/general.vue`).
      error.value = (e as Error)?.message || 'No se pudo guardar'
    } finally {
      saving.value = false
    }
  }

  return { saving, error, save }
}
