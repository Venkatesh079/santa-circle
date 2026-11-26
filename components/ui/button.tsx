import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
const styles = cva("button inline-flex items-center justify-center gap-2", {
  variants: {
    variant: { default: "primary", outline: "outline-btn", ghost: "ghost" },
    size: { default: "", sm: "small" },
  },
  defaultVariants: { variant: "default", size: "default" },
});
export function Button({
  asChild = false,
  variant,
  size,
  className,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof styles> & { asChild?: boolean }) {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      data-slot="button"
      className={cn(styles({ variant, size }), className)}
      {...props}
    />
  );
}
