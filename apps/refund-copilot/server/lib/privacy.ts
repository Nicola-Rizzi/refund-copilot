/**
 * What personal data reaches the model. Two tools, used by every AI core:
 *
 *   redact      free text a customer wrote (an email body) → phone numbers,
 *               IBANs, card numbers and email addresses replaced by [phone],
 *               [iban], [card], [email]. One-way: the model doesn't need them to
 *               read a refund request, and the sender comes from the envelope.
 *   pseudonyms  customer emails in the shop's records (and in the agent's own
 *               question) → CUST-001, CUST-002… for this one call. The model can
 *               still tell customers apart and answer "what did this customer
 *               refund?"; the real address is put back before the answer leaves
 *               the server, including across streamed chunks.
 *
 * Order ids, SKUs, product names and amounts pass through: the features need them.
 * Photos and PDFs can't be redacted as text; they go to the model as sent.
 */

type PiiKind = "email" | "iban" | "card" | "phone";
type RedactionCounts = Partial<Record<PiiKind, number>>;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g;
const CARD = /\b\d(?:[ -]?\d){12,18}\b/g;
// A leading + or at least 9 digits: dates (8 digits at most) and amounts stay readable.
const PHONE = /(?<![\w-])\+?\d[\d ().-]{6,}\d(?![\w-])/g;

const digits = (s: string) => s.replace(/\D/g, "");

/** Card numbers pass the Luhn check; a random 16-digit reference usually doesn't. */
function luhn(n: string): boolean {
  let sum = 0;
  for (let i = 0; i < n.length; i++) {
    let d = Number(n[n.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

const isPhone = (m: string) => {
  const n = digits(m).length;
  return n <= 15 && (m.startsWith("+") ? n >= 8 : n >= 9);
};

export function redact(text: string): { text: string; counts: RedactionCounts } {
  const counts: RedactionCounts = {};
  const hit = (kind: PiiKind) => { counts[kind] = (counts[kind] ?? 0) + 1; return `[${kind}]`; };
  const out = text
    .replace(EMAIL, () => hit("email"))
    .replace(IBAN, () => hit("iban"))
    .replace(CARD, (m) => (luhn(digits(m)) ? hit("card") : m))
    .replace(PHONE, (m) => (isPhone(m) ? hit("phone") : m));
  return { text: out, counts };
}

export const hasRedactions = (c: RedactionCounts) => Object.keys(c).length > 0;

const ALIAS = /CUST-\d{3}/g;
// A chunk that ends in a prefix of an alias ("CU", "CUST-0") is held until the next one.
const PARTIAL_ALIAS = /C(?:U(?:S(?:T(?:-\d{0,2})?)?)?)?$/;

interface Pseudonyms {
  /** Every email address in `text` → its alias (new addresses get the next one). */
  mask(text: string): string;
  /** Aliases → the real addresses. Unknown aliases are left as they are. */
  unmask(text: string): string;
  /** For a stream: push chunks, get back what's safe to show; flush at the end. */
  unmaskStream(): { push(chunk: string): string; flush(): string };
  readonly size: number;
}

export function createPseudonyms(): Pseudonyms {
  const toAlias = new Map<string, string>();
  const toEmail = new Map<string, string>();
  const aliasFor = (email: string) => {
    const key = email.toLowerCase();
    let a = toAlias.get(key);
    if (!a) {
      a = `CUST-${String(toAlias.size + 1).padStart(3, "0")}`;
      toAlias.set(key, a);
      toEmail.set(a, key);
    }
    return a;
  };
  const unmask = (text: string) => text.replace(ALIAS, (a) => toEmail.get(a) ?? a);
  return {
    mask: (text) => text.replace(EMAIL, aliasFor),
    unmask,
    unmaskStream() {
      let held = "";
      return {
        push(chunk) {
          const buf = held + chunk;
          const tail = PARTIAL_ALIAS.exec(buf)?.[0] ?? "";
          held = tail;
          return unmask(buf.slice(0, buf.length - tail.length));
        },
        flush() { const rest = unmask(held); held = ""; return rest; },
      };
    },
    get size() { return toAlias.size; },
  };
}
