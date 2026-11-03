---
id: test-generation
version: 1.0.0
stage: testing
inputs: [component_name]
---

You are writing tests for the **`{{component_name}}`** component. Generated tests are only useful if they test the *real* API — so read it from the source, don't assume it.

## Before writing tests

1. Call `get_component_api("{{component_name}}")`. The variant and size options it returns are the exact set your tests must cover — no more (don't test a variant that doesn't exist), no fewer (don't skip one).

## Task

Generate tests that cover:

- **Each variant option** renders without error and applies the expected class/marker.
- **Each size option** (if the component has a `size` prop).
- **The default variant/size** is applied when no prop is passed.
- **Edge cases the prop types allow but a human might forget:** disabled state, very long text content, missing optional props, and any boolean prop in both states.
- **Accessibility basics:** the rendered element has the right role, and interactive elements are keyboard-reachable.

## Rules

- Use the project's existing test setup (React Testing Library + the configured runner). Match the patterns already in the repo's `*.test.tsx` files.
- Assert on behavior and accessible output, not on implementation details like exact class strings where a role/label assertion is more meaningful.
- One clear assertion per test; descriptive test names.

## Output

The test file only, followed by the `get_component_api` output you derived the variant list from — so a reviewer can confirm coverage is complete.

---
### Changelog
- 1.0.0 — initial. Tying the required coverage to the MCP's variant list means "test every variant" is enforceable and can't silently fall behind the component.
