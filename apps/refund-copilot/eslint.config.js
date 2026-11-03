import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import projectPlugin from '@refund-copilot/eslint-plugin'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['src/**/*.{ts,tsx}', '*.ts'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: {
      '@refund-copilot': projectPlugin,
    },
    rules: {
      '@refund-copilot/no-hardcoded-colors': 'error',
      '@refund-copilot/no-silent-catch': 'error',
      '@refund-copilot/no-inert-button': 'error',
    },
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // The server, its AI cores and the eval harnesses: TypeScript on Node, no React.
    // Linted too, so no-silent-catch guards the code that talks to the model.
    files: ['server/**/*.ts', 'eval/**/*.ts', 'tests/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    plugins: {
      '@refund-copilot': projectPlugin,
    },
    rules: {
      '@refund-copilot/no-silent-catch': 'error',
    },
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // Test fixtures legitimately render a bare <Button> to check styling or a11y,
    // with no handler wired. no-inert-button guards shipped UI, not test doubles.
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    rules: {
      '@refund-copilot/no-inert-button': 'off',
    },
  },
])
