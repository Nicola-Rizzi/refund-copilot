/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      // No `colors`/`borderRadius` extend blocks here on purpose — see the
      // matching comment in packages/ui/tailwind.config.js. Every real
      // component (including here) uses arbitrary-value syntax against the
      // CSS variables generated from tokens.json, never a bare `bg-brand`
      // class, so a second hardcoded copy of the same values would be an
      // unchecked duplicate with nothing consuming it.
      boxShadow: {
        sm: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)",
        md: "0 4px 8px rgba(0,0,0,0.10), 0 2px 4px rgba(0,0,0,0.06)",
        lg: "0 10px 24px rgba(0,0,0,0.12)",
      },
    },
  },
  plugins: [],
}

