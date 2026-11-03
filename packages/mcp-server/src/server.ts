import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadTokens, loadComponents, loadApiContracts, loadPromptTemplate } from "./loaders.js";
import { findTokenForValue, describeMatches } from "./reverse-lookup.js";

/**
 * Builds a fully-configured MCP server with all tools and resources registered.
 *
 * Both transports (stdio in index.ts, HTTP in http.ts) call this factory, so the
 * tool set is defined in exactly one place and can never drift between the two.
 */
/**
 * Every tool result lands verbatim in the client model's context window, so the
 * server — not the model — must own the upper bound on list sizes. `limit`
 * defaults high enough to be invisible at this repo's scale, but the contract
 * (and the truncation notice steering the model toward offset or get_*) is what
 * keeps the design honest at 400-component / 2000-token scale.
 */
const DEFAULT_LIMIT = 100;

const pageParams = {
  limit: z.number().int().min(1).max(500).optional()
    .describe(`Max items to return (default ${DEFAULT_LIMIT}).`),
  offset: z.number().int().min(0).optional()
    .describe("Number of items to skip, for paging through long lists."),
};

function paginate<T>(items: T[], limit = DEFAULT_LIMIT, offset = 0) {
  if (items.length > 0 && offset >= items.length) {
    return { page: [], notice: `\n\n[offset=${offset} is past the end — only ${items.length} item(s) exist.]` };
  }
  const page = items.slice(offset, offset + limit);
  const notice =
    items.length > offset + page.length
      ? `\n\n[Showing ${offset + 1}–${offset + page.length} of ${items.length}. ` +
        `Pass offset=${offset + page.length} for more, or use the matching get_* tool for one item.]`
      : "";
  return { page, notice };
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "refund-copilot-mcp",
    version: "2.0.0",
  });

  // ─── Token tools ───────────────────────────────────────────────────────────

  server.tool(
    "list_tokens",
    "List design tokens, optionally filtered by category. Reads live from shared-ui/src/tokens.json.",
    {
      category: z
        .enum(["color", "spacing", "typography", "radius", "shadow"])
        .optional()
        .describe("Filter to a single category. Omit for all."),
      ...pageParams,
    },
    async ({ category, limit, offset }) => {
      const tokens = loadTokens();
      const filtered = category ? tokens.filter(t => t.category === category) : tokens;
      if (!filtered.length) {
        return { content: [{ type: "text", text: `No tokens found for category "${category}".` }] };
      }
      const { page, notice } = paginate(filtered, limit, offset);
      const lines = page.map(t => `${t.name} = ${t.value}  (${t.category}) — ${t.description}`);
      return { content: [{ type: "text", text: lines.join("\n") + notice }] };
    }
  );

  server.tool(
    "get_token",
    "Resolve a single design token by exact name to its current value.",
    { name: z.string().describe("Token name, e.g. 'color.brand.primary'.") },
    async ({ name }) => {
      const tokens = loadTokens();
      const token = tokens.find(t => t.name === name);
      if (!token) {
        // Rank by how many dot-separated segments the query shares with each
        // candidate — a typo anywhere but the first segment (e.g.
        // "color.brnad.primary") still surfaces the right token, unlike
        // matching only name.split(".")[0].
        const querySegments = new Set(name.split("."));
        const suggestions = tokens
          .map(t => ({
            name: t.name,
            shared: t.name.split(".").filter(seg => querySegments.has(seg)).length,
          }))
          .filter(t => t.shared > 0)
          .sort((a, b) => b.shared - a.shared)
          .slice(0, 5)
          .map(t => t.name);
        return {
          content: [{
            type: "text",
            text: `Token "${name}" not found.` +
              (suggestions.length ? ` Did you mean: ${suggestions.join(", ")}?` : ""),
          }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: `${token.name} = ${token.value}\n${token.description}` }] };
    }
  );

  server.tool(
    "find_token_for_value",
    "Reverse lookup: given a raw value seen in legacy or third-party code (a hex color like '#4f46e5', " +
      "a spacing value like '16px'), find which design token it corresponds to. Use this when refactoring " +
      "hardcoded styles onto the design system, or auditing code for drift from the token set. Colors are " +
      "matched perceptually (OKLCH), not by byte comparison, so near-identical shades still resolve to the " +
      "right token even without an exact string match.",
    { value: z.string().describe("The raw value to look up, e.g. '#4f46e5', '16px', '1rem'.") },
    async ({ value }) => {
      const matches = findTokenForValue(value, loadTokens());
      return { content: [{ type: "text", text: describeMatches(value, matches) }] };
    }
  );

  // ─── Component tools ────────────────────────────────────────────────────────

  server.tool(
    "list_components",
    "List all components in shared-ui, parsed live from the .tsx source files.",
    { ...pageParams },
    async ({ limit, offset }) => {
      const { page, notice } = paginate(loadComponents(), limit, offset);
      const lines = page.map(c => `${c.name} (${c.importPath})`);
      return { content: [{ type: "text", text: lines.join("\n") + notice }] };
    }
  );

  server.tool(
    "get_component_api",
    "Get the full prop API for a component, parsed live from its .tsx source file.",
    { name: z.string().describe("Component name, e.g. 'Button'.") },
    async ({ name }) => {
      const components = loadComponents();
      const component = components.find(
        c => c.name.toLowerCase() === name.toLowerCase()
      );
      if (!component) {
        const names = components.map(c => c.name).join(", ");
        return {
          content: [{ type: "text", text: `Component "${name}" not found. Available: ${names}.` }],
          isError: true,
        };
      }

      const propLines = component.props.map(p => {
        const req = p.required ? "required" : "optional";
        const def = p.default ? `, default ${p.default}` : "";
        return `  - ${p.name}: ${p.type} (${req}${def})`;
      });

      const text = [
        `${component.name}`,
        `import { ${component.name} } from "${component.importPath}";`,
        "",
        "Props:",
        ...propLines,
        "",
        "Example:",
        component.example,
      ].join("\n");

      return { content: [{ type: "text", text }] };
    }
  );

  // ─── API contract tools ──────────────────────────────────────────────────────

  server.tool(
    "list_endpoints",
    "List all API endpoints with method, path, and description. Call this before writing any fetch() call to see what's available.",
    { ...pageParams },
    async ({ limit, offset }) => {
      const endpoints = loadApiContracts();
      if (!endpoints.length) {
        return { content: [{ type: "text", text: "No endpoints found." }] };
      }
      const { page, notice } = paginate(endpoints, limit, offset);
      const lines = page.map(e => `${e.method} ${e.path} — ${e.description}`);
      return { content: [{ type: "text", text: lines.join("\n") + notice }] };
    }
  );

  server.tool(
    "get_endpoint",
    "Get the full request/response contract for one endpoint. Use the exact path from list_endpoints. " +
      "Pass `method` when a path is served by more than one (e.g. /api/refunds is GET and POST) — " +
      "otherwise the first one wins and a POST/PATCH body contract is easy to miss.",
    {
      path: z.string().describe("Endpoint path, e.g. '/api/refunds' or '/api/refunds/:id/approve'."),
      method: z
        .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
        .optional()
        .describe("HTTP method — pass it to disambiguate a path served by more than one."),
    },
    async ({ path, method }) => {
      const endpoints = loadApiContracts();
      const forPath = endpoints.filter(e => e.path === path);
      if (forPath.length === 0) {
        const available = [...new Set(endpoints.map(e => `${e.method} ${e.path}`))].join(", ");
        return {
          content: [{ type: "text", text: `Endpoint "${path}" not found. Available: ${available}.` }],
          isError: true,
        };
      }

      let endpoint;
      let note = "";
      if (method) {
        endpoint = forPath.find(e => e.method.toUpperCase() === method.toUpperCase());
        if (!endpoint) {
          const methods = forPath.map(e => e.method).join(", ");
          return {
            content: [{ type: "text", text: `No ${method} ${path}. Methods for this path: ${methods}.` }],
            isError: true,
          };
        }
      } else if (forPath.length === 1) {
        endpoint = forPath[0];
      } else {
        endpoint = forPath[0];
        note =
          `[${path} is served by ${forPath.map(e => e.method).join(", ")}; ` +
          `showing ${endpoint.method}. Pass method= to pick another.]\n\n`;
      }

      const parts = [
        note + `${endpoint.method} ${endpoint.path}`,
        endpoint.description,
      ];
      if (endpoint.body) {
        parts.push("", "Request body:", JSON.stringify(endpoint.body, null, 2));
      }
      parts.push("", "Response:", JSON.stringify(endpoint.response, null, 2));
      return { content: [{ type: "text", text: parts.join("\n") }] };
    }
  );

  // ─── Resource ────────────────────────────────────────────────────────────────

  server.resource(
    "refund-copilot-overview",
    "devcontext://overview",
    async (uri) => {
      const tokens = loadTokens();
      const components = loadComponents();

      const text = [
        "# refund-copilot-mcp",
        "",
        `Tokens: ${tokens.length} across ${new Set(tokens.map(t => t.category)).size} categories.`,
        `Components: ${components.map(c => c.name).join(", ")}.`,
        "",
        "Rules for agents:",
        "- Never hardcode colors or spacing — resolve with get_token / list_tokens.",
        "- Call get_component_api before using any component.",
      ].join("\n");

      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
    }
  );

  // ─── Prompts ─────────────────────────────────────────────────────────────────
  // Every parameterized template in prompts/ is served as a real MCP prompt, not
  // just a file a human has to find and paste. A client can list_prompts() /
  // getPrompt() and get the exact same grounding instructions the repo's own
  // scripts use. The body is re-read live on each getPrompt call
  // (loadPromptTemplate), so editing a .md file takes effect with no rebuild.
  //
  // prompts/pr-review.md is deliberately NOT here — it's the CI review rubric,
  // loaded directly by scripts/review-pr.js, not an interactive scaffold.

  const PROMPT_DEFS = [
    {
      id: "component-from-spec",
      name: "component_from_spec",
      title: "New component from a spec",
      description:
        "Scaffold a new @refund-copilot/ui component that matches the library's existing structure and token discipline, " +
        "anchored to a reference component's real API rather than reinvented from scratch.",
      args: {
        component_name: "PascalCase name of the new component, e.g. 'Tooltip'.",
        spec: "One-line description of what the component should do.",
        reference_component: "Name of an existing component to mirror the structure of, e.g. 'Button'.",
      },
    },
    {
      id: "api-consumer",
      name: "api_consumer",
      title: "Typed data hook from an endpoint contract",
      description:
        "Write a typed data-fetching hook whose request/response types match the live get_endpoint contract " +
        "field-for-field — no invented fields, no omitted ones, correct status-code handling.",
      args: {
        endpoint_path: "Endpoint path from list_endpoints, e.g. '/api/refunds' or '/api/refunds/:id/approve'.",
        hook_name: "Name for the hook, e.g. 'useRefunds'.",
      },
    },
    {
      id: "test-generation",
      name: "test_generation",
      title: "Variant-complete tests for a component",
      description:
        "Generate tests covering exactly the variant/size set get_component_api reports for a component — " +
        "no more (don't test a variant that doesn't exist), no fewer (don't skip one).",
      args: {
        component_name: "Component to test, e.g. 'Badge'.",
      },
    },
    {
      id: "migration",
      name: "migration",
      title: "On-rails multi-file migration",
      description:
        "Drive a mechanical change across many files with a plan-first gate and an explicit out-of-scope " +
        "boundary, so an agent can't scope-creep the migration.",
      args: {
        migration_goal: "What the migration should achieve.",
        scope: "The in-scope boundary — the files, dirs, or patterns the change is allowed to touch.",
      },
    },
  ] as const;

  for (const def of PROMPT_DEFS) {
    const argsSchema: Record<string, z.ZodString> = Object.fromEntries(
      Object.entries(def.args).map(([key, desc]) => [key, z.string().describe(desc)])
    );
    server.registerPrompt(
      def.name,
      { title: def.title, description: def.description, argsSchema },
      async (args: Record<string, string>) => {
        const template = loadPromptTemplate(def.id);
        let text = template.body;
        for (const [key, value] of Object.entries(args)) {
          text = text.replaceAll(`{{${key}}}`, value);
        }
        return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
      }
    );
  }

  return server;
}
