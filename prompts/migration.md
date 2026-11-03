---
id: migration
version: 1.0.0
stage: migration
inputs: [migration_goal, scope]
---

You are driving a multi-file migration in this repo. Migrations are where agents do the most damage when under-constrained — they "helpfully" change things outside the task. Stay strictly on-rails.

## Context to load first

1. Read `CLAUDE.md` for repo conventions and the MCP rules.
2. If the migration touches components or API calls, query the MCP (`get_component_api`, `get_endpoint`) for the real shapes before changing anything.

## Goal

{{migration_goal}}

## Scope — the on-rails boundary

In scope: {{scope}}

**Out of scope, do not touch:** anything not named in the scope above. Specifically: do not rename props, do not change variant names, do not "improve" unrelated code, do not reformat files you aren't otherwise editing, do not upgrade dependencies.

## How to proceed

1. First, produce a **plan**: the list of files you'll change and the one-line reason for each. Stop and wait for confirmation before editing.
2. After approval, make the changes file by file.
3. Run the build and the relevant tests after each logical group of changes; report failures rather than papering over them.
4. At the end, summarize what changed and explicitly list anything you noticed but deliberately left alone (so a human can decide on it separately).

## What to escalate, not decide

If the migration surfaces a design question — a missing variant, an ambiguous state-ownership choice, an accessibility tradeoff — flag it and stop. Those are not migration mechanics.

---
### Changelog
- 1.0.0 — initial. The "plan first, wait for confirmation" gate and the explicit out-of-scope list are the two constraints that keep an agent from scope-creeping a migration.
