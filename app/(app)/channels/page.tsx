import type { Metadata } from "next";
import { ChannelListScreen } from "@/components/channels/channel-screens";

export const metadata: Metadata = { title: "Channels" };

export default function ChannelsPage() {
  return <ChannelListScreen />;
}
