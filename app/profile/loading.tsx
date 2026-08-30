import { HeaderSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <div>
      <HeaderSkeleton />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="h-64 rounded-2xl shimmer" />
        <div className="h-64 rounded-2xl shimmer" />
      </div>
    </div>
  );
}
