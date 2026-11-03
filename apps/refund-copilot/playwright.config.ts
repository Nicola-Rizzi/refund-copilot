import { defineConfig, devices } from "@playwright/test"

// End-to-end: the real browser, the real Vite build of the UI and the real API
// server, with AI_STUB=1 standing in for the model (no key, deterministic).
// Ports differ from `npm run dev` (8788 / 5174) so both can run at once.
const API_PORT = 8790
const WEB_PORT = 5175

export default defineConfig({
  testDir: "tests",
  // One in-memory store per run: tests share it, so they run in order.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: [
    {
      command: `AI_STUB=1 API_PORT=${API_PORT} npx tsx server/index.ts`,
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: false,
      stderr: "ignore",
    },
    {
      command: `API_PORT=${API_PORT} npx vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
    },
  ],
})
