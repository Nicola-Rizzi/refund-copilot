// The browser side of the refund copilot API. Who is calling travels in the
// session cookie (HttpOnly: this code never sees it, the browser sends it on
// same-origin requests); every request carries a trace id that joins the
// server's [request] and [usage] log lines.
const newTraceId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `t-${Date.now().toString(36)}`;

export class ApiError extends Error {
  readonly status: number;
  readonly kind?: string;
  readonly disabled: boolean;
  constructor(status: number, message: string, kind?: string, disabled = false) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.kind = kind;
    this.disabled = disabled;
  }
}

function messageForStatus(status: number, serverMessage?: string): string {
  if (serverMessage) return serverMessage;
  if (status === 429) return "Too many requests. Wait a minute and try again.";
  if (status === 401) return "Sign in first.";
  return `Something went wrong (${status}). Try again.`;
}

export async function api<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { "x-trace-id": newTraceId(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch((err: unknown) => ({ error: undefined, parseError: String(err) }));
  if (!res.ok) throw new ApiError(res.status, messageForStatus(res.status, data?.error), data?.kind, Boolean(data?.disabled));
  return data as T;
}

export const eur = (n: number) => `${n.toFixed(2)} €`;

/** POST, then read a text/event-stream body frame by frame (Ask). */
export async function apiStream(
  path: string, body: unknown,
  { signal, onFrame }: { signal?: AbortSignal; onFrame: (event: string, data: unknown) => void },
): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "x-trace-id": newTraceId(), "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch((err: unknown) => ({ error: undefined, parseError: String(err) }));
    throw new ApiError(res.status, messageForStatus(res.status, data?.error), data?.kind, Boolean(data?.disabled));
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /^event: (.*)$/m.exec(raw)?.[1] ?? "message";
      const data = /^data: (.*)$/m.exec(raw)?.[1];
      if (data !== undefined) onFrame(ev, JSON.parse(data));
    }
  }
}

export const isAbort = (err: unknown) => err instanceof DOMException && err.name === "AbortError";

/** DOM id of a refund in the list — what an Ask citation scrolls to. */
export const refundAnchor = (id: string) => `refund-${id}`
