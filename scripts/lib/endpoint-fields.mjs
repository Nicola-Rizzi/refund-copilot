// Pure logic for scripts/verify-endpoint-fields.js — the deterministic backstop
// for CLAUDE.md Rule 2 ("call get_endpoint before writing an API call").
//
// Two checks, both a straight string comparison against the live MCP contract
// (apps/refund-copilot/api.json, served by get_endpoint):
//   A. the `Refund` type in apps/refund-copilot/src/types.ts matches GET /api/refunds
//   B. every api(...) / apiStream(...) call's literal request body only sends keys
//      that endpoint+method's contract lists
//
// Heuristic by design — it understands this app's client (the api() and
// apiStream() helpers in src/api.ts, string or template paths, object-literal
// bodies), not arbitrary HTTP code. The escape hatch: it only ever flags a key it
// can positively resolve to a contract that doesn't list it.

/** `export interface Name { id: string; note?: string; ... }` → Map(field → {optional}). */
export function parseInterface(src, name) {
  const m = src.match(new RegExp(`interface\\s+${name}\\s*(?:extends[^{]*)?\\{([\\s\\S]*?)\\n\\}`));
  const fields = new Map();
  if (!m) return fields;
  let depth = 0;
  for (const rawLine of m[1].split("\n")) {
    const line = rawLine.replace(/\/\/.*$/, "").trim();
    // Only top-level fields: skip anything inside a nested { ... } type literal.
    for (const part of line.split(";")) {
      const p = part.trim();
      const f = depth === 0 && p.match(/^([A-Za-z_$][\w$]*)(\?)?\s*:/);
      if (f) fields.set(f[1], { optional: Boolean(f[2]) });
      depth += (p.match(/\{/g) ?? []).length - (p.match(/\}/g) ?? []).length;
    }
  }
  return fields;
}

/** Grab the first balanced {...} after `label` in the get_endpoint tool text, JSON.parse it. */
function jsonBlockAfter(text, label) {
  const at = text.indexOf(label);
  if (at === -1) return null;
  const open = text.indexOf("{", at);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) {
      try { return JSON.parse(text.slice(open, i + 1)); } catch { return null; }
    }
  }
  return null;
}

const isArrayShape = (v) => v && typeof v === "object" && v.type === "array" && v.items && typeof v.items === "object";

/**
 * From get_endpoint(...) text → { responseFields, bodyFields }.
 * A list response contributes its *item* fields: a bare array
 * (`{ type: "array", items }`) or one wrapped in a single key (`{ refunds: { type: "array", items } }`).
 */
export function contractFieldsFromText(text) {
  const response = jsonBlockAfter(text, "Response:");
  const body = jsonBlockAfter(text, "Request body:");
  let responseFields = [];
  if (response) {
    const keys = Object.keys(response);
    const shape = isArrayShape(response) ? response.items
      : keys.length === 1 && isArrayShape(response[keys[0]]) ? response[keys[0]].items
      : response;
    responseFields = Object.entries(shape).map(([k, v]) => (typeof v === "string" && /\(optional/.test(v) ? `${k} (optional)` : k));
  }
  return { responseFields, bodyFields: body ? Object.keys(body) : [] };
}

const IDENT = "[A-Za-z_$][\\w$]*";

/** Split on commas that aren't nested inside (), [], {}, <> or strings. */
function splitTopLevel(s) {
  const out = [];
  let depth = 0, start = 0, str = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (str) { if (c === str && s[i - 1] !== "\\") str = null; continue; }
    if (c === '"' || c === "'" || c === "`") str = c;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  out.push(s.slice(start));
  return out;
}

/** Keys of a `{ a, b: 1, ...spread }` literal body — spread entries dropped. */
function objectKeys(literalInner) {
  const keys = [];
  for (const part of splitTopLevel(literalInner)) {
    const t = part.trim();
    if (!t || t.startsWith("...")) continue;
    const kv = t.match(new RegExp(`^(${IDENT})\\s*:`));
    if (kv) { keys.push(kv[1]); continue; }
    const shorthand = t.match(new RegExp(`^(${IDENT})$`));
    if (shorthand) keys.push(shorthand[1]);
  }
  return keys;
}

/** A path argument → template: "/api/refunds" stays, `/api/refunds/${id}/${a}` → "/api/refunds/:*\/:*". */
export function resolvePath(arg) {
  const t = arg.trim();
  const m = t.match(/^(["'`])(.*)\1$/s);
  if (!m) return null;
  return m[1] === "`" ? m[2].replace(/\$\{[^}]+\}/g, ":*") : m[2];
}

/** Does a call path (":*" = any one segment) match a contract path (":id" = any one segment)? */
export function pathMatches(callPath, contractPath) {
  const a = callPath.split("/"), b = contractPath.split("/");
  return a.length === b.length && a.every((seg, i) => seg === ":*" || b[i].startsWith(":") || seg === b[i]);
}

/** From the index right after "(", the arguments up to the matching ")" (string-aware). */
function callArgs(src, from) {
  let depth = 0, str = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (str) { if (c === str && src[i - 1] !== "\\") str = null; continue; }
    if (c === '"' || c === "'" || c === "`") str = c;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) { if (depth === 0) return splitTopLevel(src.slice(from, i)); depth--; }
  }
  return null;
}

/**
 * Every `api<T>(user, "METHOD", path, body?)` and `apiStream(user, path, body, opts)`
 * in `src` → { method, path, keys, line }. `keys` is null when the body isn't an
 * object literal (a variable: can't be checked statically, left alone).
 */
export function parseApiCalls(src) {
  const calls = [];
  const re = /\b(api|apiStream)(?:<[^>()]*(?:<[^>]*>[^>()]*)*>)?\(/g;
  let m;
  while ((m = re.exec(src))) {
    const args = callArgs(src, m.index + m[0].length);
    if (!args) continue;
    const isStream = m[1] === "apiStream";
    // api(method, path, body?) · apiStream(path, body, options): the user is in the session cookie, not an argument.
    const method = isStream ? "POST" : (args[0]?.trim().match(/^["'`](\w+)["'`]$/)?.[1] ?? "").toUpperCase();
    const path = resolvePath((isStream ? args[0] : args[1]) ?? "");
    if (!method || !path) continue;
    const bodyArg = (isStream ? args[1] : args[2])?.trim();
    const keys = bodyArg === undefined ? [] : bodyArg.startsWith("{") ? objectKeys(bodyArg.slice(1, -1)) : null;
    calls.push({ method, path, keys, line: src.slice(0, m.index).split("\n").length });
  }
  return calls;
}

/** Contract field name may carry a note: "reason (optional)" → "reason". */
const bareField = (f) => f.replace(/\s*\(.*\)\s*$/, "").trim();

/**
 * Compare a type's fields with a response contract. Every required contract field
 * must be on the type; every type field must be in the contract (or client-only).
 */
export function checkType(typeFields, responseFields, clientOnly = []) {
  const required = responseFields.filter((f) => !/\(optional/.test(f)).map(bareField);
  const allowed = new Set([...responseFields.map(bareField), ...clientOnly]);
  const missingFromType = required.filter((f) => !typeFields.has(f));
  const notInContract = [...typeFields.keys()].filter((f) => !allowed.has(f));
  return { missingFromType, notInContract };
}
