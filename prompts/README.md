# Prompts

Versioned, parameterized prompts the team shares — not chat one-offs.

Ad-hoc prompting means every developer reinvents the same instructions, gets slightly different results, and none of it is reviewable. These files fix that: they live in the repo, go through PR review like any other code, and they reference the project's MCP server (`refundCopilot` in `.mcp.json`) so the agent always works from the project's real source of truth.

Each file carries frontmatter (`id`, `version`, `stage`, `inputs`) and a changelog. Fill the `{{placeholders}}`, then paste into Claude Code / Cursor with the `refundCopilot` MCP connected, or feed it to the API.

| Prompt | Stage | Use it when |
|---|---|---|
| [`component-from-spec.md`](component-from-spec.md) | code-generation | Building a new `@refund-copilot/ui` component from a description |
| [`api-consumer.md`](api-consumer.md) | code-generation | Writing a typed data-fetching hook against an endpoint |
| [`test-generation.md`](test-generation.md) | testing | Generating variant-complete tests for a component |
| [`migration.md`](migration.md) | migration | Running a mechanical change across many files, on-rails |
| [`pr-review.md`](pr-review.md) | review | The review rubric — loaded directly by `scripts/review-pr.js` (this file is the single source) + CI |

## Why these reference the MCP

Each prompt opens by telling the agent to query the MCP **before** writing code. That separation is the whole point: the prompt supplies the *task and the rules*, the MCP supplies the *current facts* — real variant names, real response shapes, real token values. When a component's variants change, the prompt doesn't need editing, because it reads them live. The prompt is the part that's stable; the facts are the part that moves.

## Versioning

Treat these like code: change one, open a PR, the diff is reviewable. `pr-review.md` is the rubric the CI review runs — `scripts/review-pr.js` reads this file at run time (frontmatter stripped; text before `## Input` is the system prompt, the fenced `{{diff}}` block is the user-message template), so there's no second copy to keep in sync. `component-from-spec.md`, `api-consumer.md`, `test-generation.md`, and `migration.md` are additionally registered as MCP prompts by the server (`list_prompts` / `get_prompt`), rendered live from these files.

## Stages, mapped to the SDLC

The `stage` field places each prompt in the development lifecycle — code-generation, testing, migration, review. That's deliberate: AI isn't bolted onto one step here, it runs across the workflow, with the MCP as the shared source of truth and a human owning the design decisions at each stage.
