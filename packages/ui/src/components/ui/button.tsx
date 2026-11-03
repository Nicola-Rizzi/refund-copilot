import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils"

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--border-focus))] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:     "bg-[rgb(var(--brand))] text-[rgb(var(--brand-foreground))] hover:bg-[rgb(var(--brand-hover))]",
        outline:     "border border-[rgb(var(--border))] bg-transparent text-[rgb(var(--text))] hover:bg-[rgb(var(--surface-subtle))]",
        ghost:       "text-[rgb(var(--text))] hover:bg-[rgb(var(--surface-subtle))]",
        destructive: "bg-[rgb(var(--feedback-error))] text-white hover:brightness-90",
        accent:      "bg-[rgb(var(--brand-accent))] text-[rgb(var(--brand-accent-fg))] hover:brightness-90",
      },
      size: {
        sm:   "h-8  rounded-[var(--radius-sm)] px-3 text-sm",
        md:   "h-10 rounded-[var(--radius-md)] px-4 text-base",
        lg:   "h-12 rounded-[var(--radius-md)] px-6 text-base",
        icon: "h-10 w-10 rounded-[var(--radius-md)]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
)
Button.displayName = "Button"

export { Button }
