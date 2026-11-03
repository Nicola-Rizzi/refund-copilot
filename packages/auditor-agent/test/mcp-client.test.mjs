// resolveHexToToken parses find_token_for_value's text response. It must:
//   - resolve an exact token value,
//   - resolve a *near* miss (the "Closest:" line lives on line 2, so this needs
//     the /m flag — without it that branch was dead and near misses were
//     silently skipped),
//   - decline a far-off "closest" match (snapping an unrelated colour onto a
//     token is a bug, not a fix).
//
// Needs packages/mcp-server/dist built (ci.yml builds it before `npm test`;
// the MCP server's own test script builds it too).
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveHexToToken } from "../src/mcp-client.mjs";

test("resolveHexToToken: exact token value resolves", () => {
  const { tokenName } = resolveHexToToken("#B91C1C"); // == color.feedback.error
  assert.equal(tokenName, "color.feedback.error");
});

test("resolveHexToToken: a perceptual near-miss still resolves", () => {
  const { tokenName } = resolveHexToToken("#B81C1B"); // ΔE ~0.002 from #B91C1C
  assert.equal(tokenName, "color.feedback.error");
});

test("resolveHexToToken: a far-off colour declines (left for a human)", () => {
  const { tokenName, raw } = resolveHexToToken("#123456");
  assert.equal(tokenName, null);
  assert.match(raw, /No exact match/); // the full text is still handed back
});
