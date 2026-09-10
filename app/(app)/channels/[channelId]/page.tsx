"use client";

import { useParams } from "next/navigation";
import { ChannelDetailScreen } from "@/components/channels/channel-screens";
import type { ChannelId } from "@/lib/types/ids";

export default function ChannelDetailPage() {
  const params = useParams<{ channelId: string }>();
  return <ChannelDetailScreen channelId={params.channelId as ChannelId} />;
}
