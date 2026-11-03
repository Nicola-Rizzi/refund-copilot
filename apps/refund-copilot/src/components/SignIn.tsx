import { useEffect, useState } from "react"
import { Button } from "@refund-copilot/ui/button"
import { Card } from "@refund-copilot/ui/card"
import { api, ApiError } from "../api"
import type { User } from "../types"

/**
 * Demo sign-in: pick an account; the server sets the session cookie. No passwords
 * because it's a demo. In production this screen is the bank's single sign-on
 * (OIDC), and the server's session layer stays the same.
 */
const SignIn = ({ onSignIn }: { onSignIn: (userId: string) => Promise<void> }) => {
  const [accounts, setAccounts] = useState<{ users: User[]; shop: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<{ users: User[]; shop: string }>("GET", "/api/accounts")
      .then(setAccounts)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't reach the refund service. Is the API server running?"))
  }, [])

  const pick = async (id: string) => {
    setBusy(id); setError(null)
    try {
      await onSignIn(id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't sign in.")
      setBusy(null)
    }
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-16">
      <Card variant="outlined" padding="lg">
        <h1 className="text-xl font-semibold" style={{ color: "rgb(var(--text))" }}>Sign in to {accounts?.shop ?? "Refund copilot"}</h1>
        <p className="mt-1 text-sm" style={{ color: "rgb(var(--text-muted))" }}>
          Demo accounts, no passwords. A real deployment signs in through the company's single sign-on.
        </p>
        <ul className="mt-4 flex flex-col gap-2" aria-label="Accounts">
          {accounts?.users.map((u) => (
            <li key={u.id}>
              {/* Two lines, wrapping: the role description must fit inside the button at any width. */}
              <Button type="button" variant="outline" className="h-auto w-full flex-col items-start gap-0.5 whitespace-normal py-2 text-left" disabled={busy !== null} onClick={() => void pick(u.id)}>
                <span>{u.name}</span>
                <span className="text-xs font-normal" style={{ color: "rgb(var(--text-muted))" }}>{u.role === "supervisor" ? "Supervisor: approves any amount" : "Agent: handles requests, approves up to the limit"}</span>
              </Button>
            </li>
          ))}
        </ul>
        {error && <p role="alert" className="mt-3 text-sm" style={{ color: "rgb(var(--feedback-error))" }}>{error}</p>}
      </Card>
    </main>
  )
}

export default SignIn
