import test from "node:test";
import { RuleTester } from "eslint";
import noHardcodedColors from "../rules/no-hardcoded-colors.js";
import noSilentCatch from "../rules/no-silent-catch.js";
import noInertButton from "../rules/no-inert-button.js";

const jsx = new RuleTester({
  languageOptions: { ecmaVersion: "latest", sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } },
});
const js = new RuleTester({
  languageOptions: { ecmaVersion: "latest", sourceType: "module" },
});

test("no-hardcoded-colors", () => {
  jsx.run("no-hardcoded-colors", noHardcodedColors, {
    valid: [
      { code: 'const C = () => <div style={{ color: "rgb(var(--feedback-error))" }} />;' },
      { code: 'const C = () => <div className="bg-red-700" />;' },
      { code: 'const C = () => <a href="#a1b2c3">x</a>;' }, // hex-shaped, but not className/style
      { code: 'const C = () => <div style={{ color: token.value }} />;' }, // dynamic
    ],
    invalid: [
      {
        code: 'const C = () => <div style={{ color: "#B91C1C" }} />;',
        errors: [{ messageId: "noHardcodedColor" }],
      },
      {
        code: 'const C = () => <div style={{ color: "#fff" }} />;', // 3-char
        errors: [{ messageId: "noHardcodedColor" }],
      },
      {
        code: 'const C = () => <div className="bg-[#B91C1C]" />;', // bare className literal
        errors: [{ messageId: "noHardcodedColor" }],
      },
      {
        // the CallExpression case — hex hidden inside a clsx() argument
        code: 'const C = () => <div className={clsx("p-2", cond && "bg-[#123456]")} />;',
        errors: [{ messageId: "noHardcodedColor" }],
      },
    ],
  });
});

test("no-silent-catch", () => {
  js.run("no-silent-catch", noSilentCatch, {
    valid: [
      { code: "try { f(); } catch (e) { throw e; }" },
      { code: "try { f(); } catch (e) { throw new Error('wrapped', { cause: e }); }" },
      { code: "try { f(); } catch (e) { console.error(e); }" },
      { code: "try { f(); } catch (e) { setError(e.message); }" }, // surfaces it
      { code: "try { f(); } catch (e) { if (e.code !== 'ENOENT') throw e; }" }, // conditional re-throw
      { code: "function g() { try { f(); } catch (e) { return e.fallback; } }" }, // uses the error
    ],
    invalid: [
      { code: "try { f(); } catch (e) {}", errors: [{ messageId: "silentCatch" }] },
      { code: "try { f(); } catch {}", errors: [{ messageId: "silentCatch" }] },
      { code: "function g() { try { f(); } catch (e) { return null; } }", errors: [{ messageId: "silentCatch" }] },
      { code: "try { f(); } catch { showFallback(); }", errors: [{ messageId: "silentCatch" }] },
    ],
  });
});

test("no-inert-button", () => {
  jsx.run("no-inert-button", noInertButton, {
    valid: [
      { code: "const C = () => <button onClick={f}>Go</button>;" },
      { code: "const C = () => <Button onClick={f}>Edit</Button>;" },
      { code: "const C = () => <Button onPointerUp={next} />;" }, // any on* handler
      { code: "const C = () => <button type=\"submit\">Save</button>;" },
      { code: "const C = () => <Button type={\"reset\"} />;" },
      { code: "const C = () => <Button {...props}>Edit</Button>;" }, // handler may be in the spread
      { code: "const C = () => <form><button>Save</button></form>;" }, // implicit submit
      { code: "const C = () => <Button asChild><a href=\"/x\">Go</a></Button>;" }, // Slot pattern
      { code: "const C = () => <Foo.Button>x</Foo.Button>;" }, // member expression — not our target
    ],
    invalid: [
      { code: "const C = () => <button>Click</button>;", errors: [{ messageId: "inert" }] },
      { code: "const C = () => <Button variant=\"outline\">Edit</Button>;", errors: [{ messageId: "inert" }] },
      { code: "const C = () => <div><Button>Edit</Button></div>;", errors: [{ messageId: "inert" }] },
      { code: "const C = () => <button type=\"button\">Edit</button>;", errors: [{ messageId: "inert" }] },
    ],
  });
});
