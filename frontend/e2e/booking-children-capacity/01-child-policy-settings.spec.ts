import { test, expect } from '../fixtures'
import type { Page } from '@playwright/test'
import { ADMIN_STORAGE_STATE } from '../global-setup'
import { roomCard, gotoWizardWithDates, logConsoleAndHttpErrors } from './helpers'

// La página de Configuración tiene un botón "Guardar" por sección (varias visibles a la vez) —
// XPath directo hermano del heading evita el "strict mode violation" de tener más de un
// "Guardar" en la página, sin depender de qué <div> intermedio matchee un filtro `:has()`.
function childPolicySaveButton(page: Page) {
  return page.locator('xpath=//h3[normalize-space(text())="Política de niños"]/parent::div/following-sibling::button[normalize-space(text())="Guardar"]')
}

// Escenario 1 (configuración de política de niños) + escenario 6 (acceptChildren=false):
// edita la política REAL desde Administración (/panel/config?tab=children) y confirma que el
// motor público la refleja de inmediato. Termina restaurando el valor original — el resto de la
// suite (y el resto del hotel) depende de acceptChildren:true/maxChildAge:12/maxFreeAge:3.
test.use({ storageState: ADMIN_STORAGE_STATE })

test.describe('Política de niños — configuración y efecto en el motor público', () => {
  let errors: string[]
  test.beforeEach(({ page }) => {
    errors = []
    logConsoleAndHttpErrors(page, errors)
  })
  test.afterEach(() => {
    if (errors.length) console.log('Errores capturados en este test:', errors)
  })

  test('la configuración actual del hotel se refleja en el form de Administración', async ({ page }) => {
    await page.goto('/panel/config?tab=children')
    await expect(page.getByRole('heading', { name: 'Política de niños' })).toBeVisible({ timeout: 15000 })

    const acceptCheckbox = page.locator('input[type="checkbox"]').first()
    await expect(acceptCheckbox).toBeChecked()
    // El <label> y el <input> son hermanos (no `for`/`id` ni anidado) — getByLabel no aplica acá.
    await expect(page.locator('label:has-text("Edad máxima considerada niño") + input')).toHaveValue('12')
    await expect(page.locator('label:has-text("Edad máxima sin consumir plaza") + input')).toHaveValue('3')
  })

  test('acceptChildren=false: el motor público oculta el stepper de niños; al reactivarlo, vuelve', async ({ page }) => {
    // ── Apagar "Aceptar niños" desde Administración ──
    await page.goto('/panel/config?tab=children')
    await expect(page.getByRole('heading', { name: 'Política de niños' })).toBeVisible({ timeout: 15000 })
    const acceptCheckbox = page.locator('input[type="checkbox"]').first()
    await expect(acceptCheckbox).toBeChecked()
    await acceptCheckbox.uncheck({ force: true })
    await childPolicySaveButton(page).click()
    await expect(childPolicySaveButton(page)).toBeEnabled({ timeout: 10000 })

    try {
      // ── Verificar en el motor público (sesión distinta, sin auth) ──
      const publicPage = await page.context().browser()!.newPage({ storageState: { cookies: [], origins: [] } })
      try {
        await gotoWizardWithDates(publicPage)
        const card = roomCard(publicPage, 'Double')
        await expect(card).toBeVisible({ timeout: 15000 })
        await expect(card.getByText('Niños', { exact: true })).not.toBeVisible()
        await expect(card.getByRole('button', { name: /Double · Niños/ })).toHaveCount(0)
      } finally {
        await publicPage.close()
      }
    } finally {
      // ── Restaurar (SIEMPRE, incluso si la verificación de arriba falló) ──
      await page.goto('/panel/config?tab=children')
      await expect(page.getByRole('heading', { name: 'Política de niños' })).toBeVisible({ timeout: 15000 })
      const checkboxAgain = page.locator('input[type="checkbox"]').first()
      if (!(await checkboxAgain.isChecked())) {
        await checkboxAgain.check({ force: true })
        await childPolicySaveButton(page).click()
        await expect(childPolicySaveButton(page)).toBeEnabled({ timeout: 10000 })
      }
    }

    // Confirma la restauración: el composer vuelve a mostrar "Niños" en el motor público.
    const publicPage2 = await page.context().browser()!.newPage({ storageState: { cookies: [], origins: [] } })
    try {
      await gotoWizardWithDates(publicPage2)
      const card2 = roomCard(publicPage2, 'Double')
      await expect(card2).toBeVisible({ timeout: 15000 })
      await expect(card2.getByText('Niños', { exact: true })).toBeVisible()
    } finally {
      await publicPage2.close()
    }
  })
})
