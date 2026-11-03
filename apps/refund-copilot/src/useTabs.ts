import { useRef, useState, type KeyboardEvent } from "react"

/**
 * WAI-ARIA tabs: one tab stop (roving tabindex); arrows (wrapping), Home and End
 * move focus and select. Spread `tabProps(key)` on each tab button.
 */
export function useTabs<K extends string>(keys: readonly K[]) {
  const [tab, setTab] = useState<K>(keys[0])
  const refs = useRef<Partial<Record<K, HTMLButtonElement | null>>>({})

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = keys.indexOf(tab)
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: keys.length - 1 }[e.key]
    if (next === undefined) return
    e.preventDefault()
    const k = keys[(next + keys.length) % keys.length]
    setTab(k)
    refs.current[k]?.focus()
  }

  const tabProps = (k: K) => ({
    ref: (el: HTMLButtonElement | null) => { refs.current[k] = el },
    role: "tab" as const,
    "aria-selected": tab === k,
    tabIndex: tab === k ? 0 : -1,
    onClick: () => setTab(k),
    onKeyDown,
  })

  return { tab, setTab, tabProps }
}
