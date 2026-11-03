// Code → Figma: publish packages/ui/src/tokens.json as Figma variables, so designers
// pick the same colours and sizes the code ships, and Dev Mode shows developers the
// CSS to write. tokens.json stays the source of truth: this only writes to Figma,
// never reads values back into the code. The collection it writes is code-owned;
// an edit made in Figma is overwritten by the next publish.
//
// Pure functions (no network) so the plan can be tested; the CLI is
// scripts/figma-publish-tokens.js. API: developers.figma.com/docs/rest-api/variables-endpoints
// (POST /v1/files/:key/variables is atomic: one invalid change and nothing is saved).

import { COLOR_MAP, RADIUS_MAP } from "../../packages/ui/scripts/css-variables.js";

// Typed against Figma's official REST API spec (@figma/rest-api-spec); `npm run test:scripts`
// type-checks this file (scripts/tsconfig.json), so a payload Figma wouldn't accept fails CI.
/** @typedef {import("@figma/rest-api-spec").PostVariablesRequestBody} PostBody */
/** @typedef {import("@figma/rest-api-spec").GetLocalVariablesResponse["meta"]} LocalMeta */
/** @typedef {import("@figma/rest-api-spec").VariableCodeSyntax} CodeSyntax */
/** @typedef {{ name: string, value: string, category: string, description?: string }} Token */
/** @typedef {{ name: string, description: string, codeSyntax?: CodeSyntax } & ({ resolvedType: "COLOR", value: import("@figma/rest-api-spec").RGBA } | { resolvedType: "FLOAT", value: number })} Wanted */

export const COLLECTION_NAME = "Refund copilot tokens";
const DESCRIPTION_NOTE = "Published from tokens.json. Edit the code, not this variable.";

/** Figma names can't contain "."; "/" makes Figma groups: color/brand/primary. */
export const figmaName = (/** @type {string} */ tokenName) => tokenName.replace(/\./g, "/");

/** #RRGGBB → Figma's { r, g, b, a } in 0..1. @param {string} hex */
export function hexToFigma(hex) {
  const n = (/** @type {number} */ i) => Math.round((parseInt(hex.slice(i, i + 2), 16) / 255) * 10000) / 10000;
  return { r: n(1), g: n(3), b: n(5), a: 1 };
}

/** Figma colour → #RRGGBB, to compare with tokens.json. @param {{ r: number, g: number, b: number }} c */
export function figmaToHex({ r, g, b }) {
  return "#" + [r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/**
 * What a token becomes in Figma, or why it's skipped. Colours → COLOR; "12px" or a
 * plain number → FLOAT. Shadows have no variable type (Figma uses effect styles).
 * @param {Token} token
 * @returns {Wanted | { skip: string }}
 */
export function toFigmaVariable(token) {
  const css = COLOR_MAP[token.name] ? `rgb(var(${COLOR_MAP[token.name]}))` : RADIUS_MAP[token.name] ? `var(${RADIUS_MAP[token.name]})` : null;
  const base = { name: figmaName(token.name), description: [token.description, DESCRIPTION_NOTE].filter(Boolean).join(" "), ...(css ? { codeSyntax: { WEB: css } } : {}) };
  if (token.category === "color" && /^#[0-9A-Fa-f]{6}$/.test(token.value)) return { ...base, resolvedType: "COLOR", value: hexToFigma(token.value) };
  const num = /^(-?\d+(?:\.\d+)?)(px)?$/.exec(String(token.value));
  if (num) return { ...base, resolvedType: "FLOAT", value: Number(num[1]) };
  return { skip: `${token.name}: "${token.value}" has no Figma variable type` };
}

/** @param {string} type @param {unknown} a @param {unknown} b */
const sameValue = (type, a, b) =>
  type === "COLOR"
    ? typeof b === "object" && b !== null && !("type" in b) && "r" in b && figmaToHex(/** @type {any} */ (a)) === figmaToHex(/** @type {any} */ (b))
    : a === b;

/**
 * Compare tokens.json with the file's local variables (GET .../variables/local `meta`)
 * and build the POST body: only what differs. `prune` deletes variables in the
 * collection that no longer exist in the code.
 * @param {Token[]} tokens
 * @param {LocalMeta | undefined} meta
 * @param {{ prune?: boolean }} [options]
 * @returns {{ body: Required<PostBody>, summary: Record<"created" | "updated" | "unchanged" | "deleted" | "orphans" | "skipped", string[]>, changes: number }}
 */
export function planPublish(tokens, meta, { prune = false } = {}) {
  const collections = Object.values(meta?.variableCollections ?? {});
  const collection = collections.find((c) => c.name === COLLECTION_NAME && !c.remote);
  /** @type {Required<PostBody>} */
  const body = { variableCollections: [], variableModes: [], variables: [], variableModeValues: [] };
  /** @type {Record<"created" | "updated" | "unchanged" | "deleted" | "orphans" | "skipped", string[]>} */
  const summary = { created: [], updated: [], unchanged: [], deleted: [], orphans: [], skipped: [] };

  let collectionId, modeId;
  if (collection) {
    collectionId = collection.id;
    modeId = collection.defaultModeId;
  } else {
    collectionId = "tmp_collection";
    modeId = "tmp_mode";
    body.variableCollections.push({ action: "CREATE", id: collectionId, name: COLLECTION_NAME, initialModeId: modeId });
  }

  const existing = new Map(
    Object.values(meta?.variables ?? {}).filter((v) => v.variableCollectionId === collectionId).map((v) => [v.name, v]),
  );
  const published = new Set();

  for (const token of tokens) {
    const want = toFigmaVariable(token);
    if ("skip" in want) { summary.skipped.push(want.skip); continue; }
    published.add(want.name);
    const have = existing.get(want.name);

    if (!have) {
      const id = `tmp_${want.name.replace(/\W/g, "_")}`;
      body.variables.push({ action: "CREATE", id, name: want.name, variableCollectionId: collectionId, resolvedType: want.resolvedType,
        description: want.description, ...(want.codeSyntax ? { codeSyntax: want.codeSyntax } : {}) });
      body.variableModeValues.push({ variableId: id, modeId, value: want.value });
      summary.created.push(want.name);
      continue;
    }
    if (have.resolvedType !== want.resolvedType) {
      // The type can't change on UPDATE: replace the variable.
      body.variables.push({ action: "DELETE", id: have.id });
      const id = `tmp_${want.name.replace(/\W/g, "_")}`;
      body.variables.push({ action: "CREATE", id, name: want.name, variableCollectionId: collectionId, resolvedType: want.resolvedType,
        description: want.description, ...(want.codeSyntax ? { codeSyntax: want.codeSyntax } : {}) });
      body.variableModeValues.push({ variableId: id, modeId, value: want.value });
      summary.updated.push(`${want.name} (type ${have.resolvedType} → ${want.resolvedType})`);
      continue;
    }
    const valueChanged = !sameValue(want.resolvedType, want.value, have.valuesByMode?.[modeId]);
    const metaChanged = have.description !== want.description || (have.codeSyntax?.WEB ?? null) !== (want.codeSyntax?.WEB ?? null);
    if (metaChanged) body.variables.push({ action: "UPDATE", id: have.id, description: want.description, codeSyntax: want.codeSyntax ?? {} });
    if (valueChanged) body.variableModeValues.push({ variableId: have.id, modeId, value: want.value });
    (valueChanged || metaChanged ? summary.updated : summary.unchanged).push(want.name);
  }

  for (const [name, v] of existing) {
    if (published.has(name)) continue;
    if (prune) { body.variables.push({ action: "DELETE", id: v.id }); summary.deleted.push(name); }
    else summary.orphans.push(name);
  }

  const changes = body.variableCollections.length + body.variables.length + body.variableModeValues.length;
  return { body, summary, changes };
}
