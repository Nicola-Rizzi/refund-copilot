# @refund-copilot/auditor-agent

A LangGraph agent that scans for hardcoded hex colors, resolves each one to
the real design token via the MCP server's `find_token_for_value`
tool, and applies the fix only after a human explicitly approves it.

It's the multi-step, tool-using, human-in-the-loop counterpart to the rest of
this repo's MCP-consuming scripts (`generate-docs.js`, `generate-stories.js`),
which are all single-shot. This one runs a real graph: scan → look up →
propose → **pause and ask** → apply or skip → loop → report.

## Why it needs human-in-the-loop, and the read-only MCP server doesn't

`packages/mcp-server` is deliberately read-only — it only ever answers
questions, never writes a file, so there is nothing there for a human to
approve. This agent is different: it edits source files. That's a real,
consequential action, so pausing for explicit approval before every single
edit isn't decoration — it's the correct amount of caution for something that
changes code on disk.

## Run it

```bash
# against the shipped demo fixture — one file, two hardcoded hex colors
npm run demo

# against any real directory
node src/cli.mjs --dir ../ui/src
```

You'll see, for each hex literal found:

```
demo-fixture/LegacyAlert.tsx:7
  className={kind === "error" ? "bg-[#B91C1C] text-white" : "bg-[#166534] text-white"}
  MCP find_token_for_value("#B91C1C") → Exact match: color.feedback.error (#B91C1C) — ΔE ≈ 0.000
  Proposed: #B91C1C  →  rgb(var(--feedback-error))
  Apply this fix? [y/N]
```

Answer `y` to apply, anything else to leave that one alone. A summary prints
once every match in every file has been through the loop.

## How the graph is wired (`src/graph.mjs`)

```
START → scan → lookupToken → approve (interrupt) → applyOrSkip → report → END
                    ▲                                    │
                    └────────────────────────────────────┘
                         (loops while matches remain)
```

- **scan** — walks `--dir` for `.tsx` files, regex-matches hex literals (the
  same pattern `@refund-copilot/no-hardcoded-colors` uses).
- **lookupToken** — calls the real MCP server's `find_token_for_value` for
  the current match, over the same spawn-a-subprocess-over-stdio transport
  `generate-docs.js`/`generate-stories.js` already use.
- **approve** — calls `interrupt()`, which pauses the graph (persisted via a
  `MemorySaver` checkpointer) and surfaces the proposed fix. The CLI resumes
  with `new Command({ resume: { approved: boolean } })`.
- **applyOrSkip** — writes the file if approved; otherwise just logs the skip.

### A real gotcha, found by actually running it

Resuming with `new Command({ resume: false })` throws `EmptyInputError` —
LangGraph checks whether a resume value was *provided* by testing truthiness,
so a literal `false` looks indistinguishable from "no value given at all".
The fix: always resume with an object, `{ approved: false }`, never a bare
boolean. `test/cli.test.mjs` exercises exactly this path (rejecting a fix)
so it can't silently regress.

### The other gotcha: how *not* to test a CLI that pauses for input

`printf 'y\ny\n' | node src/cli.mjs` sends both answers and then closes the
pipe (EOF) immediately. `readline/promises`'s second `question()` call never
resolves once the underlying stream has already ended — even though the
LangGraph interrupt/resume mechanics underneath are completely correct. A
real terminal never sends EOF between keystrokes, so this only breaks a
piped test harness, not real interactive use. `test/cli.test.mjs` drives the
CLI as a subprocess with a stdin pipe that's kept open and fed on a delay,
matching how a human actually uses it.
