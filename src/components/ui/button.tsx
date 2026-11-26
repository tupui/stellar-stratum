import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // Square, 48 px, Chivo 600. One primary per screen: acid with a ledge under it. Disabled buttons
  // all look the same: an ink well with muted text.
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-none border text-[15px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:border-line-2 disabled:bg-ink-3 disabled:text-muted-foreground disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border-primary bg-primary text-primary-foreground shadow-[0_4px_0_hsl(var(--acid-deep))] hover:bg-primary-glow active:translate-y-1 active:shadow-none",
        // A click that removes something: red outline, never filled
        destructive: "border-destructive bg-transparent text-destructive hover:bg-destructive/10",
        warn: "border-warning bg-transparent text-warning hover:bg-warning/10",
        outline: "border-input bg-transparent text-foreground hover:border-foreground",
        secondary: "border-input bg-ink-3 text-foreground hover:border-foreground",
        ghost: "border-transparent bg-transparent text-muted-foreground hover:text-foreground",
        link: "border-transparent text-foreground underline decoration-line-2 underline-offset-4 hover:decoration-current",
      },
      size: {
        default: "h-12 px-4",
        sm: "h-11 px-3.5 text-sm",
        lg: "h-12 px-6",
        icon: "h-11 w-11",
        mobile: "h-12 px-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
