/**
 * Any error a route throws → the HTTP status, the message the user sees and a
 * `kind` the UI uses to give the right advice (src/api.ts). Our own rule and
 * input errors keep their message; model and upstream failures get advice
 * instead; anything else is our bug, a 500 without details.
 */
import { DomainError } from "./refunds.ts";
import { ReadError, FileError } from "./readRequest.ts";
import { PayloadError, isObject } from "./validation.ts";

type ErrorKind = "bad_input" | "rule" | "invalid_output" | "aborted" | "upstream" | "internal";

export function errorStatus(err: unknown): [status: number, message: string, kind: ErrorKind] {
  if (err instanceof PayloadError || err instanceof TypeError) return [400, err.message, "bad_input"];
  if (err instanceof FileError) return [err.status, err.message, "bad_input"];
  if (err instanceof DomainError) return [err.status, err.message, "rule"];
  if (err instanceof ReadError) return [502, "The model couldn't read that request reliably. Fill in the refund by hand.", "invalid_output"];
  const e = isObject(err) ? err : {};
  if (e.name === "AbortError" || e.name === "APIUserAbortError") return [499, "Client closed the request.", "aborted"];
  if (typeof e.status === "number") return [502, "The AI service is unavailable right now. Fill in the refund by hand or try later.", "upstream"];
  return [500, "Internal error.", "internal"];
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : undefined);
