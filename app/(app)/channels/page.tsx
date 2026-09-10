import type { Metadata } from "next";
import { Suspense } from "react";
import { ChannelListScreen } from "@/components/channels/channel-screens";

export const metadata: Metadata = { title: "Channels" };

export default function ChannelsPage() {
  // Suspense boundary: ChannelListScreen reads useSearchParams (the OAuth
  // callback's connectError flag).
  return (
    <Suspense>
      <ChannelListScreen />
    </Suspense>
  );
}
