import type { Metadata } from "next";
import { DiscoveryScreen } from "@/components/discovery/discovery-screen";

export const metadata: Metadata = { title: "Intel" };

export default function DiscoverPage() {
  return <DiscoveryScreen />;
}
