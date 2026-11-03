/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./stories/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      borderRadius: { sm: "6px", md: "10px", lg: "14px", full: "9999px" },
      boxShadow: {
        sm: "0 1px 3px rgba(0,0,0,0.08)",
        md: "0 4px 8px rgba(0,0,0,0.10)",
      },
    },
  },
  plugins: [],
}
