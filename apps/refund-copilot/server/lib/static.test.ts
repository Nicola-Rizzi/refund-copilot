// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { staticFile } from "./static.ts";

const root = mkdtempSync(join(tmpdir(), "rc-dist-"));
mkdirSync(join(root, "assets"));
writeFileSync(join(root, "index.html"), "<!doctype html>app");
writeFileSync(join(root, "assets", "app-123.js"), "console.log(1)");
writeFileSync(join(tmpdir(), "rc-secret.txt"), "secret");

describe("staticFile", () => {
  it("serves built assets with long caching, and index.html for app routes", async () => {
    expect(await staticFile(root, "/assets/app-123.js")).toMatchObject({ type: "text/javascript; charset=utf-8", cache: expect.stringContaining("immutable") });
    expect(String((await staticFile(root, "/"))?.body)).toBe("<!doctype html>app");
    expect(String((await staticFile(root, "/refunds/RF-2003"))?.body)).toBe("<!doctype html>app");
  });

  it("never leaves dist/", async () => {
    for (const p of ["/../rc-secret.txt", "/%2e%2e/rc-secret.txt", "/assets/../../rc-secret.txt"]) {
      expect(String((await staticFile(root, p))?.body)).not.toBe("secret");
    }
  });
});
