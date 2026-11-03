/**
 * Flags catch blocks that swallow the error without surfacing it — no re-throw,
 * no use of the caught value at all. A silently eaten error is a bug that only
 * ever shows up as "nothing happened", which is the most expensive kind to find.
 *
 * OK:    catch (e) { throw new AppError("…", { cause: e }); }
 * OK:    catch (e) { console.error(e); setError(e); }
 * OK:    catch (e) { if (e.code !== "ENOENT") throw e; }   // conditional re-throw
 * Wrong: catch (e) { }                                     // empty
 * Wrong: catch (e) { return null; }                        // e never touched, no re-throw
 * Wrong: catch { showFallback(); }                         // no binding, no re-throw
 *
 * The bar is deliberately low: reference the error (log it, wrap it, set an
 * error state) OR re-throw. Doing neither is what this rule catches.
 */

// Depth-first search over an ESTree node for the first descendant matching `pred`.
function contains(node, pred) {
  if (!node || typeof node.type !== "string") return false;
  if (pred(node)) return true;
  for (const key of Object.keys(node)) {
    if (key === "parent") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) if (contains(child, pred)) return true;
    } else if (value && typeof value.type === "string") {
      if (contains(value, pred)) return true;
    }
  }
  return false;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow catch blocks that swallow the error without re-throwing, logging, or otherwise using it.",
      url: "https://github.com/your-org/refund-copilot/blob/main/packages/eslint-plugin/rules/no-silent-catch.js",
    },
    messages: {
      silentCatch:
        "This catch block swallows the error silently. Re-throw it (optionally with `{ cause }`), " +
        "log it (`console.error`), or surface it (e.g. set an error state).",
    },
    schema: [],
  },

  create(context) {
    return {
      CatchClause(node) {
        const statements = node.body.body;
        if (statements.length === 0) {
          context.report({ node, messageId: "silentCatch" });
          return;
        }

        // A re-throw anywhere in the block (including a conditional one) is fine.
        if (contains(node.body, (n) => n.type === "ThrowStatement")) return;

        // Otherwise the caught error must at least be referenced somewhere.
        const paramName =
          node.param && node.param.type === "Identifier" ? node.param.name : null;
        const usesError =
          paramName != null &&
          contains(
            node.body,
            (n) => n.type === "Identifier" && n.name === paramName,
          );
        if (usesError) return;

        context.report({ node, messageId: "silentCatch" });
      },
    };
  },
};
