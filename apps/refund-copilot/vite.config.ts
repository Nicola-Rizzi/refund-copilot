import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@refund-copilot/ui": resolve(__dirname, "../../packages/ui/src/components/ui"),
    },
  },
  // The API key stays server-side: /api is proxied to the API server
  // (server/index.ts, port 8788; API_PORT moves both, as the e2e tests do).
  server: {
    proxy: { "/api": `http://localhost:${process.env.API_PORT ?? 8788}` },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    exclude: [...configDefaults.exclude, 'tests/**'],
  },
})
