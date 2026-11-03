import noHardcodedColors from "./rules/no-hardcoded-colors.js";
import noSilentCatch from "./rules/no-silent-catch.js";
import noInertButton from "./rules/no-inert-button.js";

const plugin = {
  meta: {
    name: "@refund-copilot/eslint-plugin",
    version: "1.2.0",
  },
  rules: {
    "no-hardcoded-colors": noHardcodedColors,
    "no-silent-catch": noSilentCatch,
    "no-inert-button": noInertButton,
  },
};

export default plugin;
