/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // No `colors`/`borderRadius` extend blocks here on purpose: every real
      // component uses Tailwind's arbitrary-value syntax against the CSS
      // variables generated from tokens.json (bg-[rgb(var(--brand))],
      // rounded-[var(--radius-sm)]), never a bare `bg-brand`/`rounded-sm`
      // class. A second copy of the same hex/px values here would duplicate
      // tokens.json with no consumer and no drift check (token-drift.yml only
      // diffs index.css) to catch it silently diverging — exactly the failure
      // mode this project exists to prevent, so it doesn't get to happen here.
      boxShadow: {
        sm: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)",
        md: "0 4px 8px rgba(0,0,0,0.10), 0 2px 4px rgba(0,0,0,0.06)",
        lg: "0 10px 24px rgba(0,0,0,0.12)",
      },
    },
  },
  plugins: [],
}
