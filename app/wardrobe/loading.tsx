import { ChipRowSkeleton, HeaderSkeleton, TileGridSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <div>
      <HeaderSkeleton />
      <ChipRowSkeleton count={6} />
      <TileGridSkeleton count={12} aspect="aspect-square" />
    </div>
  );
}
