// Root ESLint config — enforces the project's design-system rules across the
// workspaces that don't have their own ESLint setup: the design system
// (packages/ui) and its Storybook (apps/ui-docs). `apps/refund-copilot` has its own richer config
// (`apps/refund-copilot/eslint.config.js`) with the React and TypeScript plugins;
// run that with `npm run lint --workspace apps/refund-copilot`.
//
// Invoked by `npm run lint` at the repo root, and in CI (ci.yml).
import tsParser from "@typescript-eslint/parser";
import { defineConfig, globalIgnores } from "eslint/config";
import projectPlugin from "@refund-copilot/eslint-plugin";

export default defineConfig([
  globalIgnores([
    "**/dist/**",
    "**/node_modules/**",
    "**/storybook-static/**",
    "**/*.d.ts",
  ]),
  {
    files: [
      "packages/ui/src/**/*.{ts,tsx}",
      "apps/ui-docs/**/*.{ts,tsx}",
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "@refund-copilot": projectPlugin,
    },
    rules: {
      "@refund-copilot/no-hardcoded-colors": "error",
      "@refund-copilot/no-silent-catch": "error",
      "@refund-copilot/no-inert-button": "error",
    },
  },
]);
