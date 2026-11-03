/**
 * Production: the same server hands out the built UI (dist/), so the demo is one
 * service on one origin: the session cookie stays first-party and SameSite=Strict
 * just works. Dev uses Vite instead and never reaches this.
 */
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

/**
 * Sent on every response in production. React sets inline `style` attributes, hence
 * 'unsafe-inline' for styles only; scripts come from this origin alone.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Strict-Transport-Security": "max-age=31536000",
};

/** A file under `root` for a URL path; unknown paths get index.html (client-side app). */
export async function staticFile(root: string, urlPath: string): Promise<{ body: Buffer; type: string; cache: string } | null> {
  const clean = normalize(decodeURIComponent(urlPath.split("?")[0])).replace(/^([/\\])+/, "");
  const file = join(root, clean);
  if (file !== root && !file.startsWith(root + sep)) return null;   // ../ out of dist
  const tryRead = async (f: string) => readFile(f).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT" || err.code === "EISDIR") return null;
    throw err;
  });
  const hit = clean ? await tryRead(file) : null;
  if (hit) return { body: hit, type: TYPES[extname(file)] ?? "application/octet-stream", cache: clean.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache" };
  const index = await tryRead(join(root, "index.html"));
  return index ? { body: index, type: TYPES[".html"], cache: "no-cache" } : null;
}
