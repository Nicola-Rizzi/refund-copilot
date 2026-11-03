/**
 * One Zod schema per model tool: the same object produces the JSON Schema the
 * model is given (`zodTool`) and checks what the model sends back (`.safeParse`).
 * Two hand-written copies, one for the prompt and one for the validator, could
 * drift apart without any test noticing; one schema can't.
 */
import { z } from "zod/v4";
import type { ToolParam } from "@refund-copilot/ai-runtime/types";

// z.number().int() adds ±2^53 bounds: noise in the prompt, and true of every JSON integer anyway.
function stripSafeIntBounds(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripSafeIntBounds);
  if (typeof node !== "object" || node === null) return node;
  return Object.fromEntries(Object.entries(node)
    .filter(([k, v]) => !((k === "maximum" || k === "minimum") && Math.abs(Number(v)) === Number.MAX_SAFE_INTEGER))
    .map(([k, v]) => [k, stripSafeIntBounds(v)]));
}

/** The tool definition the model sees, generated from the schema its answer is checked against. */
export function zodTool(name: string, description: string, schema: z.ZodObject): ToolParam {
  const { $schema: _drop, ...json } = z.toJSONSchema(schema, { io: "input" });
  void _drop;
  return { name, description, input_schema: stripSafeIntBounds(json) as ToolParam["input_schema"] };
}

/** The first problem, readable: "items.0.quantity: Too small: expected number to be >=1". */
export function firstIssue(error: z.ZodError): string {
  const i = error.issues[0];
  return i ? `${i.path.join(".") || "input"}: ${i.message}` : "invalid input";
}
