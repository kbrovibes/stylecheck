/**
 * Loading skeletons for the route-level `loading.tsx` boundaries.
 *
 * These are not only cosmetic: Next skips prefetching a dynamic route entirely
 * unless it has a loading boundary, so adding these is what lets the app shell
 * be prefetched and a navigation paint immediately.
 */

export function TileGridSkeleton({
  count = 8,
  aspect = "aspect-[3/4]",
}: {
  count?: number;
  aspect?: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-2xl border hairline bg-paper">
          <div className={`${aspect} shimmer`} />
          <div className="space-y-2 p-3">
            <div className="h-3 w-2/3 rounded shimmer" />
            <div className="h-2.5 w-1/3 rounded shimmer" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function HeaderSkeleton() {
  return (
    <div className="mb-6">
      <div className="mb-3 h-2.5 w-24 rounded shimmer" />
      <div className="h-8 w-56 rounded shimmer" />
    </div>
  );
}

export function ChipRowSkeleton({ count = 7 }: { count?: number }) {
  return (
    <div className="mb-6 flex gap-2 overflow-hidden">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-8 w-20 shrink-0 rounded-full shimmer" />
      ))}
    </div>
  );
}
