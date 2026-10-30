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
        "border-blue-700/40 bg-blue-600 font-semibold text-white shadow-sm dark:border-blue-300/40 dark:bg-blue-500",
        className,
      )}
    >
      <ShoppingCartIcon aria-hidden />
      {label}
    </Badge>
  );
}
