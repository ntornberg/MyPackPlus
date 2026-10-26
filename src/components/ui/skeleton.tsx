import * as React from "react";

import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn(
        "mpp-skeleton rounded-md bg-muted bg-[linear-gradient(90deg,transparent_0%,rgb(255_255_255/0.55)_50%,transparent_100%)] bg-size-[200%_100%] bg-no-repeat animate-[mpp-shimmer_1.6s_ease-in-out_infinite] dark:bg-[linear-gradient(90deg,transparent_0%,rgb(255_255_255/0.06)_50%,transparent_100%)]",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
