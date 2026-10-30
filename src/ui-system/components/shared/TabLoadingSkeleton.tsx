import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder shaped like a search tab (controls panel + section cards) while its code loads. */
export function TabLoadingSkeleton({ label }: { label: string }) {
  return (
    <div
      role="status"
      className="mpp-rise-in flex flex-col gap-4 p-4 lg:flex-row"
    >
      <span className="sr-only">{label}</span>
      <div className="flex w-full flex-col gap-3 rounded-xl border border-border/60 p-4 lg:w-80 lg:shrink-0">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-2/3" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex flex-col gap-2.5 rounded-xl border border-border/60 p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}
