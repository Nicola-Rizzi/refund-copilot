import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planPublish, toFigmaVariable, hexToFigma, figmaToHex, figmaName, COLLECTION_NAME } from "../lib/figma-tokens.mjs";

const tokens = JSON.parse(readFileSync(new URL("../../packages/ui/src/tokens.json", import.meta.url), "utf8"));
const saved = JSON.parse(readFileSync(new URL("./fixtures/figma-variables-local.json", import.meta.url), "utf8")).meta;

test("colours round-trip between #RRGGBB and Figma's 0..1 channels", () => {
  for (const hex of ["#6D28D9", "#FFFFFF", "#000000", "#A14507"]) assert.equal(figmaToHex(hexToFigma(hex)), hex);
  assert.equal(figmaName("color.brand.primary"), "color/brand/primary");
});

test("token types: colours → COLOR with the CSS to write, px and numbers → FLOAT, shadows skipped", () => {
  const color = toFigmaVariable(tokens.find((t) => t.name === "color.brand.primary"));
  assert.equal(color.resolvedType, "COLOR");
  assert.deepEqual(color.codeSyntax, { WEB: "rgb(var(--brand))" });
  assert.deepEqual(toFigmaVariable({ name: "radius.md", value: "10px", category: "radius" }), {
    name: "radius/md", description: "Published from tokens.json. Edit the code, not this variable.", codeSyntax: { WEB: "var(--radius-md)" }, resolvedType: "FLOAT", value: 10 });
  assert.equal(toFigmaVariable({ name: "font.weight.medium", value: "500", category: "typography" }).value, 500);
  assert.match(toFigmaVariable({ name: "shadow.sm", value: "0 1px 3px rgba(0,0,0,0.08)", category: "shadow" }).skip, /no Figma variable type/);
});

test("first publish to an empty file: one collection, every publishable token, values in its first mode", () => {
  const { body, summary } = planPublish(tokens, { variables: {}, variableCollections: {} });
  assert.deepEqual(body.variableCollections, [{ action: "CREATE", id: "tmp_collection", name: COLLECTION_NAME, initialModeId: "tmp_mode" }]);
  const publishable = tokens.filter((t) => !toFigmaVariable(t).skip).length;
  assert.equal(summary.created.length, publishable);
  assert.equal(body.variableModeValues.length, publishable);
  assert.ok(body.variableModeValues.every((v) => v.modeId === "tmp_mode"));
  assert.equal(summary.skipped.length, tokens.length - publishable);   // the shadows
  assert.ok(body.variables.every((v) => !v.name.includes(".")));      // Figma forbids "." in names
});

test("against a real file: code wins over Figma edits and aliases, other collections are untouched", () => {
  const { body, summary } = planPublish(tokens, saved);
  assert.ok(summary.unchanged.includes("color/brand/primary"));
  // A designer changed text.muted in Figma: the code's value goes back.
  assert.ok(summary.updated.includes("color/text/muted"));
  assert.deepEqual(body.variableModeValues.find((v) => v.variableId === "VariableID:1:3").value, hexToFigma("#716A65"));
  // An alias isn't the code's value either: replaced by the literal colour.
  assert.ok(body.variableModeValues.some((v) => v.variableId === "VariableID:1:4"));
  assert.deepEqual(summary.orphans, ["color/legacy/teal"]);
  assert.ok(!JSON.stringify(body).includes("VariableID:9:1"));      // the designers' own collection
  assert.equal(body.variableCollections.length, 0);
});

test("--prune deletes what the code no longer has; a second run after publishing changes nothing", () => {
  assert.deepEqual(planPublish(tokens, saved, { prune: true }).summary.deleted, ["color/legacy/teal"]);
  // Apply the first publish to an empty file, then plan again: no changes.
  const first = planPublish(tokens, { variables: {}, variableCollections: {} }).body;
  const variables = Object.fromEntries(first.variables.map((v) => [v.id, { ...v, variableCollectionId: "c", valuesByMode: { m: first.variableModeValues.find((x) => x.variableId === v.id).value } }]));
  const meta = { variableCollections: { c: { id: "c", name: COLLECTION_NAME, defaultModeId: "m", remote: false } }, variables };
  assert.equal(planPublish(tokens, meta).changes, 0);
});
