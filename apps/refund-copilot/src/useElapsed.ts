import { useEffect, useState } from "react"

/** Whole seconds since `running` turned true; 0 when it isn't. */
export function useElapsed(running: boolean): number {
  const [s, setS] = useState(0)
  useEffect(() => {
    if (!running) return
    const start = Date.now()
    const t = setInterval(() => setS(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => { clearInterval(t); setS(0) }
  }, [running])
  return s
}
