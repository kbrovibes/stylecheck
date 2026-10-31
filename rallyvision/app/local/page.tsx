import type { Metadata } from "next";
import Studio from "@/components/Studio";

export const metadata: Metadata = { title: "On-device analysis — RallyVision" };

export default function Page() {
  return <Studio />;
}
