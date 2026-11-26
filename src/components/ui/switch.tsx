import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      // square, 40 x 22, with a 44 px hit area; on is white: a state, not an action
      "peer relative inline-flex h-[22px] w-10 shrink-0 cursor-pointer items-center rounded-none border border-line-2 bg-ink-3 p-[2px] transition-colors before:absolute before:-inset-x-1 before:-inset-y-[11px] before:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-foreground data-[state=checked]:bg-foreground",
      className
    )}
    {...props}
    ref={ref}
  >
  <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-4 w-4 rounded-none bg-muted-foreground transition-transform data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-ink data-[state=unchecked]:translate-x-0"
      )}
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
