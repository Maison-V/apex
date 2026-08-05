import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-[4px] border px-2 py-0.5 text-[11px] font-medium font-mono uppercase tracking-wide",
  {
    variants: {
      variant: {
        default: "border-border-default text-text-secondary",
        accent: "border-accent/40 text-accent-glow bg-accent/[0.06]",
        buy: "border-buy/30 text-buy bg-buy/[0.05]",
        sell: "border-sell/30 text-sell bg-sell/[0.05]",
        warning: "border-warning/30 text-warning bg-warning/[0.05]",
        info: "border-info/30 text-info bg-info/[0.05]",
        muted: "border-border-strong text-text-muted",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };