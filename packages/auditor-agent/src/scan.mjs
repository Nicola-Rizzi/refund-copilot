import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Same pattern @refund-copilot/no-hardcoded-colors uses — deliberately, so the agent
// and the linter agree on what counts as a violation.
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;

function findTsxFiles(dir) {
  const result = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) result.push(...findTsxFiles(full));
    else if (entry.endsWith(".tsx")) result.push(full);
  }
  return result;
}

/**
 * Scans `dir` for hardcoded hex color literals.
 * @returns {Array<{file: string, line: number, hex: string, lineText: string}>}
 */
export function scanForHexLiterals(dir) {
  const matches = [];
  for (const file of findTsxFiles(dir)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((lineText, i) => {
      for (const m of lineText.matchAll(HEX_RE)) {
        matches.push({ file, line: i + 1, hex: m[0], lineText });
      }
    });
  }
  return matches;
}
