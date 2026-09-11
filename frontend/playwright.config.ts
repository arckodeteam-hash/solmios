import { defineConfig, devices } from '@playwright/test'

// Infra E2E (Playwright). Los specs viven en e2e/.
// Requiere descargar el browser una vez: `bunx playwright install chromium`.
// El webServer levanta Vite automáticamente si no hay uno corriendo en :5173.
const PORT = Number(process.env.E2E_PORT || 5173)
const BASE_URL = process.env.E2E_BASE_URL || `http://localhost:${PORT}`

// Entornos donde el chromium que pide esta versión de Playwright no está descargado pero hay
// otro build disponible: E2E_CHROME_PATH apunta al binario (ej. chrome-headless-shell). Sin la
// env var no cambia nada: Playwright usa el browser que instaló él.
const executablePath = process.env.E2E_CHROME_PATH || undefined

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // Con --headed las acciones son casi instantáneas y no da tiempo a ver nada — E2E_SLOWMO
    // (ms) pausa entre cada acción. Sin la env var, 0 = sin cambios (headless/CI de siempre).
    launchOptions: { slowMo: Number(process.env.E2E_SLOWMO || 0), executablePath },
  },
  projects: [
    // Suite funcional de siempre. Ignora e2e/responsive/: esa auditoría corre solo en mobile-375.
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /responsive\// },
    // UI-07: auditoría responsive a 375x667 (iPhone SE). Recorre todas las rutas sin params,
    // guarda un screenshot por ruta en e2e/.artifacts/mobile-375/ y falla si alguna desborda.
    // Correr con: npx playwright test --project=mobile-375
    {
      name: 'mobile-375',
      testMatch: /responsive\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 667 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: `bun run dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
