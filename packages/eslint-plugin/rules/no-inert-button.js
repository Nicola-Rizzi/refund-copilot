/**
 * Flags a `<button>` / `<Button>` that renders as an interactive control but has
 * nothing wired to it: no event handler, no `type="submit"`/`"reset"`, and no
 * ancestor `<form>` to submit. A control that does nothing is a bug that only
 * ever shows up as "I clicked it and nothing happened" — the same expensive,
 * invisible-to-the-type-checker class as a silently swallowed error.
 *
 * OK:    <button onClick={save}>Save</button>
 * OK:    <Button onPointerUp={next} />                 // any on* handler counts
 * OK:    <button type="submit">Save</button>           // submits its form
 * OK:    <form>…<Button>Save</Button>…</form>           // inside a form → implicit submit
 * OK:    <Button {...props}>Edit</Button>              // handler may come through the spread
 * OK:    <Button asChild><a href="/x">Go</a></Button>  // shadcn Slot — renders as the child
 * Wrong: <Button variant="outline">Edit</Button>       // no handler, not a submit, no form
 * Wrong: <button type="button">Edit</button>           // type=button is not submit/reset
 *
 * Heuristic by design: it can't see a handler passed as a prop into a custom
 * wrapper. The escape hatches above (spread, asChild) keep the false-positive
 * rate low; anything else genuinely handler-less is what this rule is for.
 */

const NAMES = new Set(["button", "Button"]);
const HANDLER_RE = /^on[A-Z]/;

function literalValue(attrValue) {
  if (!attrValue) return null;
  if (attrValue.type === "Literal") return attrValue.value;
  if (
    attrValue.type === "JSXExpressionContainer" &&
    attrValue.expression.type === "Literal"
  ) {
    return attrValue.expression.value;
  }
  return null;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a <button>/<Button> with no handler, no type=submit/reset, and no ancestor <form>.",
      url: "https://github.com/your-org/refund-copilot/blob/main/packages/eslint-plugin/rules/no-inert-button.js",
    },
    messages: {
      inert:
        "This <{{name}}> has no event handler, no type=\"submit\"/\"reset\", and no ancestor <form> — " +
        "it renders as an interactive control that does nothing. Wire an onClick, give it " +
        "type=\"submit\" inside a form, or don't render it.",
    },
    schema: [],
  },

  create(context) {
    return {
      JSXOpeningElement(node) {
        const name = node.name.type === "JSXIdentifier" ? node.name.name : null;
        if (name == null || !NAMES.has(name)) return;

        let ok = false;
        for (const attr of node.attributes) {
          if (attr.type === "JSXSpreadAttribute") {
            ok = true; // handler might arrive through the spread
            break;
          }
          if (attr.type !== "JSXAttribute" || attr.name.type !== "JSXIdentifier") {
            continue;
          }
          const attrName = attr.name.name;
          if (HANDLER_RE.test(attrName) || attrName === "asChild") {
            ok = true;
            break;
          }
          if (attrName === "type") {
            const v = literalValue(attr.value);
            if (v === "submit" || v === "reset") {
              ok = true;
              break;
            }
          }
        }
        if (ok) return;

        // Inside a <form>? Then a bare button submits it by default.
        for (let p = node.parent; p; p = p.parent) {
          if (
            p.type === "JSXElement" &&
            p.openingElement &&
            p.openingElement.name.type === "JSXIdentifier" &&
            p.openingElement.name.name === "form"
          ) {
            return;
          }
        }

        context.report({ node, messageId: "inert", data: { name } });
      },
    };
  },
};
