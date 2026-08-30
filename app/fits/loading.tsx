import { ChipRowSkeleton, HeaderSkeleton, TileGridSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <div>
      <HeaderSkeleton />
      <div className="mb-5 h-10 w-64 rounded-full shimmer" />
      <ChipRowSkeleton />
      <TileGridSkeleton count={8} />
    </div>
  );
}
