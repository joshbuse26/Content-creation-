import type { Metadata } from "next";
import { DiscoveryScreen } from "@/components/discovery/discovery-screen";

export const metadata: Metadata = { title: "Ideas" };

/** Ideation (niche concepts, outliers, competitor compare) — a Tool, not Intel. */
export default function IdeasToolPage() {
  return <DiscoveryScreen />;
}
