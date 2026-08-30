import { HeaderSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <div>
      <HeaderSkeleton />
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-16 rounded-2xl shimmer" />
        ))}
      </div>
    </div>
  );
}
