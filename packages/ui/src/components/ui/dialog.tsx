import * as React from "react"
import { createPortal } from "react-dom"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils"

export const dialogPanelVariants = cva(
  "relative flex flex-col gap-4 rounded-[var(--radius-lg)] bg-[rgb(var(--surface-card))] p-6 shadow-lg",
  {
    variants: {
      size: {
        sm: "w-full max-w-sm",
        md: "w-full max-w-md",
        lg: "w-full max-w-lg",
      },
    },
    defaultVariants: {
      size: "md",
    },
  }
)

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export interface DialogProps extends VariantProps<typeof dialogPanelVariants> {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  className?: string
}

// Focus trap + restore + Escape-to-close, the three things a "just render a
// styled <div>" modal always gets wrong. Verified with jest-axe in
// dialog.test.tsx — role/aria-modal alone don't prove any of this works.
const Dialog = ({ open, onClose, title, children, size, className }: DialogProps) => {
  const panelRef = React.useRef<HTMLDivElement>(null)
  const titleId = React.useId()
  const previouslyFocused = React.useRef<HTMLElement | null>(null)

  // Keep the latest onClose reachable without making it an effect dependency.
  // A parent passing an inline `onClose={() => ...}` gives a new function every
  // render; if that were a dep, the effect would tear down and re-run while the
  // dialog is open — re-capturing `previouslyFocused` as an element *inside* the
  // dialog, so focus never returns to the real trigger on close.
  const onCloseRef = React.useRef(onClose)
  React.useEffect(() => {
    onCloseRef.current = onClose
  })

  React.useEffect(() => {
    if (!open) return

    previouslyFocused.current = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const firstFocusable = panel?.querySelector<HTMLElement>(FOCUSABLE)
    ;(firstFocusable ?? panel)?.focus()

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current()
        return
      }
      if (e.key !== "Tab" || !panel) return

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("keydown", handleKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocused.current?.focus()
    }
    // onClose is intentionally read through onCloseRef, not depended on here.
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(dialogPanelVariants({ size, className }))}
      >
        <h2 id={titleId} className="text-lg font-semibold text-[rgb(var(--text))]">
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body
  )
}
Dialog.displayName = "Dialog"

export { Dialog }
