import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils"

export const inputVariants = cva(
  "flex w-full bg-[rgb(var(--surface-card))] text-[rgb(var(--text))] placeholder:text-[rgb(var(--text-muted))] transition-colors focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "border border-[rgb(var(--border-input))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--border-focus))] focus-visible:border-transparent",
        error:   "border border-[rgb(var(--feedback-error))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--feedback-error)/0.4)]",
        ghost:   "border-0 bg-[rgb(var(--surface-subtle))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--border-focus))]",
      },
      size: {
        sm: "h-8  rounded-[var(--radius-sm)] px-3 text-sm",
        md: "h-10 rounded-[var(--radius-md)] px-3 text-base",
        lg: "h-12 rounded-[var(--radius-md)] px-4 text-base",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  }
)

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">,
    VariantProps<typeof inputVariants> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, variant, size, ...props }, ref) => (
    <input
      ref={ref}
      aria-invalid={variant === "error" ? true : undefined}
      className={cn(inputVariants({ variant, size, className }))}
      {...props}
    />
  )
)
Input.displayName = "Input"

export { Input }
