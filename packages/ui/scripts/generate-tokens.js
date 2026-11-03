#!/usr/bin/env node
// Reads tokens.json → writes src/index.css
// Run: node scripts/generate-tokens.js

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { COLOR_MAP, RADIUS_MAP } from "./css-variables.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tokens = JSON.parse(readFileSync(join(root, "src/tokens.json"), "utf8"));

// A colour or radius token without a CSS variable would silently never reach the CSS
// (or Figma's code syntax); a map entry without a token is a leftover. Fail on both.
const names = new Set(tokens.map(t => t.name));
const problems = [
  ...tokens.filter(t => t.category === "color" && !COLOR_MAP[t.name]).map(t => `${t.name}: no CSS variable; add it to COLOR_MAP in scripts/css-variables.js`),
  ...tokens.filter(t => t.category === "radius" && !RADIUS_MAP[t.name]).map(t => `${t.name}: no CSS variable; add it to RADIUS_MAP in scripts/css-variables.js`),
  ...tokens.filter(t => t.category === "color" && !/^#[0-9A-Fa-f]{6}$/.test(t.value)).map(t => `${t.name}: "${t.value}" is not #RRGGBB`),
  ...Object.keys({ ...COLOR_MAP, ...RADIUS_MAP }).filter(n => !names.has(n)).map(n => `${n}: in scripts/css-variables.js but not in tokens.json`),
];
if (problems.length) {
  console.error(`tokens.json and scripts/css-variables.js disagree:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

function hexToRgbSpaced(hex) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}`;
}

const colorLines = tokens
  .filter(t => COLOR_MAP[t.name])
  .map(t => `    ${COLOR_MAP[t.name]}:${" ".repeat(Math.max(1, 28 - COLOR_MAP[t.name].length))}${hexToRgbSpaced(t.value)};`);

const radiusLines = tokens
  .filter(t => RADIUS_MAP[t.name])
  .map(t => `    ${RADIUS_MAP[t.name]}:${" ".repeat(Math.max(1, 28 - RADIUS_MAP[t.name].length))}${t.value};`);

const css = `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
${colorLines.join("\n")}

${radiusLines.join("\n")}
  }
}
`;

writeFileSync(join(root, "src/index.css"), css);
console.log("src/index.css regenerated from tokens.json");
