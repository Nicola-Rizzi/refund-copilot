/**
 * Who is calling: a server-issued session, never a header the browser chooses.
 *
 * Signing in sets one cookie, `rc_session=<userId>.<expiry>.<HMAC-SHA256>`:
 *   HttpOnly      page scripts can't read it (an XSS can't steal the session)
 *   SameSite=Strict  never sent on a cross-site request (with the JSON-only rule
 *                 in handlers.ts, the CSRF defence)
 *   Secure        in production: HTTPS only
 *   Max-Age 8h    a working day; the expiry is also inside the signed value, so a
 *                 replayed old cookie fails even if the browser kept it
 *
 * The demo signs in by picking an account (no passwords). In production this is
 * the one place an identity provider plugs in: an OIDC callback (the bank's SSO)
 * calls `issue(userId)` instead of the account picker; nothing else changes.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "rc_session";
const SESSION_TTL_S = 8 * 60 * 60;

interface SessionOptions {
  secret?: string;
  secure?: boolean;
  now?: () => number;   // ms, for tests
}

export function createSessions({ secret = process.env.SESSION_SECRET, secure = process.env.NODE_ENV === "production", now = Date.now }: SessionOptions = {}) {
  if (!secret && process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET is required in production.");
  // Without a configured secret (dev, tests), a random one: sessions end when the server restarts.
  const key = secret ?? randomBytes(32).toString("hex");
  const mac = (payload: string) => createHmac("sha256", key).update(payload).digest();
  const attrs = `Path=/; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;

  return {
    /** The cookie value for a signed-in user. */
    issue(userId: string): string {
      const payload = `${userId}.${Math.floor(now() / 1000) + SESSION_TTL_S}`;
      return `${payload}.${mac(payload).toString("base64url")}`;
    },

    /** The user id in a valid, unexpired cookie value; null for anything else. */
    verify(value: string | null | undefined): string | null {
      const parts = value?.split(".");
      if (parts?.length !== 3) return null;
      const [userId, exp, sig] = parts;
      const expected = mac(`${userId}.${exp}`);
      const given = Buffer.from(sig, "base64url");
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
      return Number(exp) * 1000 > now() ? userId : null;
    },

    setCookie: (value: string) => `${SESSION_COOKIE}=${value}; ${attrs}; Max-Age=${SESSION_TTL_S}`,
    clearCookie: () => `${SESSION_COOKIE}=; ${attrs}; Max-Age=0`,
  };
}

export type Sessions = ReturnType<typeof createSessions>;

/** One cookie's value from a Cookie header. */
export function readCookie(header: string | string[] | undefined, name: string): string | null {
  const h = Array.isArray(header) ? header.join("; ") : header;
  for (const part of h?.split(";") ?? []) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
