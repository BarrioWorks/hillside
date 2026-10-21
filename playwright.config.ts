import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'web/tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.BARRIO_URL ?? 'http://localhost:5173',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      executablePath: process.env.BARRIO_BROWSER_PATH ?? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
      args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: process.env.BARRIO_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: true,
        timeout: 30000,
      },
});
