import type { Metadata } from "next";
import SettingsPage from "@/components/SettingsPage";

export const metadata: Metadata = { title: "Settings — RallyVision" };

export default function Page() {
  return <SettingsPage />;
}
