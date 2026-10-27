import { ShoppingCartIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Marks a course or section already in the shopping cart (cart blue, as on the calendar). */
export function InCartBadge({
  label = "In cart",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <Badge
      className={cn(
        "bg-blue-600/10 text-blue-700 dark:bg-blue-400/15 dark:text-blue-300",
        className,
      )}
    >
      <ShoppingCartIcon aria-hidden />
      {label}
    </Badge>
  );
}
