import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex h-[22px] items-center whitespace-nowrap rounded-none border px-[7px] text-xs font-normal",
  {
    variants: {
      variant: {
        // a tag: a hairline box with small muted text; color only for an error or a warning
        default: "border-line-2 text-muted-foreground",
        secondary: "border-line-2 text-muted-foreground",
        destructive: "border-destructive text-destructive",
        outline: "border-line-2 text-foreground",
        success: "border-line-2 text-foreground",
        warning: "border-warning text-warning",
        info: "border-line-2 text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
