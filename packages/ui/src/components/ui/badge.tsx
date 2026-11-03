import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils"

export const badgeVariants = cva(
  "inline-flex items-center rounded-[var(--radius-full)] px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default:     "bg-[rgb(var(--brand))] text-[rgb(var(--brand-foreground))]",
        outline:     "border border-[rgb(var(--border))] text-[rgb(var(--text))]",
        success:     "bg-[rgb(var(--feedback-success)/0.15)] text-[rgb(var(--feedback-success))]",
        error:       "bg-[rgb(var(--feedback-error)/0.15)] text-[rgb(var(--feedback-error))]",
        accent:      "bg-[rgb(var(--brand-accent)/0.15)] text-[rgb(var(--brand-accent))]",
        muted:       "bg-[rgb(var(--surface-subtle))] text-[rgb(var(--text-muted))]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(badgeVariants({ variant, className }))}
      {...props}
    />
  )
)
Badge.displayName = "Badge"

export { Badge }
