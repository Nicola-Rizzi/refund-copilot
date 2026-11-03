#!/usr/bin/env node
// Usage: git diff main | ANTHROPIC_API_KEY=... node scripts/review-pr.js
// Reads a git diff from stdin, calls Claude, prints structured review comments.
//
// The review rubric lives in prompts/pr-review.md — the single source, so the
// CI check and the versioned prompt artifact can't drift. This script strips the
// frontmatter, takes everything before the "## Input" heading as the system
// prompt, and uses the fenced {{diff}} block after it as the user-message
// template.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const PROMPT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "prompts",
  "pr-review.md",
);

const FALLBACK_USER_TEMPLATE = "Review this diff:\n\n```diff\n{{diff}}\n```";

function loadReviewPrompt() {
  const raw = readFileSync(PROMPT_PATH, "utf8");
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, ""); // strip YAML frontmatter
  const beforeChangelog = body.split(/\n---\n/)[0]; // drop the trailing changelog / notes
  const [system, input = ""] = beforeChangelog.split(/\n## Input\n/);
  return {
    system: system.trim(),
    userTemplate: input.trim() || FALLBACK_USER_TEMPLATE,
  };
}

async function main() {
  const diff = await new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => { data += chunk; });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });

  if (!diff.trim()) {
    console.log("No diff provided — pipe a git diff to stdin.");
    process.exit(0);
  }

  const { system, userTemplate } = loadReviewPrompt();
  const client = new Anthropic();

  let response;
  try {
    response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: system,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: userTemplate.replace("{{diff}}", diff),
        },
      ],
    });
  } catch (err) {
    // Auth/permission errors (missing or invalid ANTHROPIC_API_KEY) are a real
    // misconfiguration — worth a hard CI failure so someone notices and fixes
    // the secret. Everything else (rate limit, overload, network blip, an
    // Anthropic-side 5xx) is transient: failing this step shouldn't fail the
    // whole PR-review job, it should just post that the review didn't run.
    if (err.status === 401 || err.status === 403) throw err;
    console.log(`Automated review unavailable (${err.status ?? "network error"}): ${err.message}`);
    return;
  }

  const text = response.content.find(b => b.type === "text")?.text ?? "";
  console.log(text);
}

main().catch(err => {
  console.error("review-pr error:", err.message);
  process.exit(1);
});
