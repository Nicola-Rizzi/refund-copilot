import { useCallback, useEffect, useState } from "react"
import { api, ApiError } from "./api"
import type { Me, Order, Refund } from "./types"

/**
 * Who is signed in and the data they see. The server owns the session (an
 * HttpOnly cookie this code never reads): no session → `signedOut`, and the app
 * shows the sign-in screen. `version` bumps on every reload so views that load
 * their own data (AI metrics) follow the refund list.
 */
export function useSession() {
  const [me, setMe] = useState<Me | null>(null)
  const [signedOut, setSignedOut] = useState(false)
  const [orders, setOrders] = useState<Order[]>([])
  const [refunds, setRefunds] = useState<Refund[]>([])
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  const load = useCallback(async () => {
    try {
      const m = await api<Me>("GET", "/api/me")   // first: without a session, one 401 and the sign-in screen
      const [o, r] = await Promise.all([
        api<{ orders: Order[] }>("GET", "/api/orders"),
        api<{ refunds: Refund[] }>("GET", "/api/refunds"),
      ])
      setMe(m); setOrders(o.orders); setRefunds(r.refunds); setError(null); setSignedOut(false); setVersion((v) => v + 1)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { setMe(null); setSignedOut(true); return }
      setError(err instanceof ApiError ? err.message : "Couldn't reach the refund service. Is the API server running?")
    }
  }, [])

  // Loading on mount: the state updates happen after the fetch resolves.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  /** Sign in (or switch account): the server sets the session cookie, then everything reloads as that user. */
  const signIn = async (userId: string) => {
    await api("POST", "/api/session", { userId })
    await load()
  }
  const signOut = async () => {
    try {
      await api("POST", "/api/session/logout", {})
      setMe(null); setSignedOut(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't sign out.")
    }
  }

  return { me, signedOut, orders, refunds, error, setError, version, load, signIn, signOut }
}
