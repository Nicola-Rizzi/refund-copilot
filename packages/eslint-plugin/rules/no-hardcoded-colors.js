/**
 * Flags hardcoded hex color literals inside JSX style props and CSS-in-JS objects.
 * Use CSS variables instead: rgb(var(--token-name))
 *
 * Wrong:  style={{ color: "#B91C1C" }}
 * Right:  style={{ color: "rgb(var(--feedback-error))" }}
 */

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/;

export default {
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow hardcoded hex color literals. Use CSS variables derived from design tokens instead.",
      url: "https://github.com/your-org/refund-copilot/blob/main/packages/eslint-plugin/rules/no-hardcoded-colors.js",
    },
    messages: {
      noHardcodedColor:
        "Hardcoded color \"{{ value }}\". Use a CSS variable instead: rgb(var(--<token>)). " +
        "Run `list_tokens` in the MCP to find the right token.",
    },
    schema: [],
  },

  create(context) {
    function checkLiteral(node) {
      if (node.type === "Literal" && typeof node.value === "string" && HEX_RE.test(node.value)) {
        context.report({
          node,
          messageId: "noHardcodedColor",
          data: { value: node.value },
        });
      }
    }

    return {
      // style={{ color: "#fff" }} and className={{ color: "#fff" }}
      JSXExpressionContainer(node) {
        walkNode(node.expression, checkLiteral);
      },
      // className="bg-[#B91C1C]" — a bare string attribute, not wrapped in an
      // expression container. This is the Tailwind arbitrary-value form every
      // component in this repo actually uses (bg-[rgb(var(--brand))]), so it's
      // also the most likely way a hex literal slips in undetected. Scoped to
      // className/class specifically — checking every JSX attribute would also
      // flag unrelated hex-shaped values, like a `href="#a1b2c3"` fragment.
      JSXAttribute(node) {
        const attrName = node.name && node.name.name;
        if ((attrName === "className" || attrName === "class") && node.value && node.value.type === "Literal") {
          checkLiteral(node.value);
        }
      },
      // Template literals: `color: #fff`
      TemplateLiteral(node) {
        for (const quasi of node.quasis) {
          if (HEX_RE.test(quasi.value.raw)) {
            context.report({
              node: quasi,
              messageId: "noHardcodedColor",
              data: { value: quasi.value.raw.match(HEX_RE)?.[0] ?? "" },
            });
          }
        }
      },
    };
  },
};

function walkNode(node, visitor) {
  if (!node) return;
  visitor(node);
  if (node.type === "ObjectExpression") {
    for (const prop of node.properties) {
      walkNode(prop.value, visitor);
    }
  } else if (node.type === "ArrayExpression") {
    for (const el of node.elements) {
      walkNode(el, visitor);
    }
  } else if (node.type === "ConditionalExpression") {
    walkNode(node.consequent, visitor);
    walkNode(node.alternate, visitor);
  } else if (node.type === "LogicalExpression") {
    walkNode(node.left, visitor);
    walkNode(node.right, visitor);
  } else if (node.type === "CallExpression" || node.type === "NewExpression") {
    // className={clsx("bg-[#B91C1C]", cond && "…")} / cva("#fff", …) — the hex
    // hides in a call argument, which is exactly how the repo's Tailwind
    // arbitrary-value strings are actually written.
    for (const arg of node.arguments) {
      walkNode(arg, visitor);
    }
  }
}
