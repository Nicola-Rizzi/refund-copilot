// Token name → CSS variable name: the one mapping both outputs of tokens.json use,
// the generated index.css (generate-tokens.js) and the Figma variables' code syntax
// (scripts/figma-publish-tokens.js).
/** @type {Record<string, string>} */
export const COLOR_MAP = {
  "color.brand.primary":           "--brand",
  "color.brand.primaryHover":      "--brand-hover",
  "color.brand.primaryForeground": "--brand-foreground",
  "color.brand.accent":            "--brand-accent",
  "color.brand.accentForeground":  "--brand-accent-fg",
  "color.text.default":            "--text",
  "color.text.muted":              "--text-muted",
  "color.surface.default":         "--surface",
  "color.surface.card":            "--surface-card",
  "color.surface.subtle":          "--surface-subtle",
  "color.border.default":          "--border",
  "color.border.focus":            "--border-focus",
  "color.border.input":            "--border-input",
  "color.feedback.error":          "--feedback-error",
  "color.feedback.success":        "--feedback-success",
};

/** @type {Record<string, string>} */
export const RADIUS_MAP = {
  "radius.sm":   "--radius-sm",
  "radius.md":   "--radius-md",
  "radius.lg":   "--radius-lg",
  "radius.full": "--radius-full",
};
