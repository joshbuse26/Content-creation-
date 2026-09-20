import type { Metadata } from "next";
import { ChannelStatsScreen } from "@/components/intel/channel-stats-screen";

export const metadata: Metadata = { title: "Intel" };

/** Intel is the creator's own channel stats — idea mining lives under Tools. */
export default function IntelPage() {
  return <ChannelStatsScreen />;
}
