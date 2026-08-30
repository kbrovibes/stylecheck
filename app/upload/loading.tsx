import { HeaderSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <div>
      <HeaderSkeleton />
      <div className="h-56 rounded-2xl shimmer" />
    </div>
  );
}
