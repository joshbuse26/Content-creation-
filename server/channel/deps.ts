import { hasDb } from "@/db";
import { getProviders } from "@/lib/providers";
import type { Providers } from "@/lib/providers/types";
import { getSharedQuotaTracker, type QuotaTracker } from "@/pipelines/sync/quota";
import {
  DrizzleAvatarRepo,
  DrizzleChannelRepo,
  DrizzleTrackingRepo,
  getSharedMemoryStore,
  type AvatarRepo,
  type ChannelRepo,
  type TrackingRepo,
} from "./repo";

/**
 * Default dependency assembly for the A1 channel domain: Drizzle repos when
 * a database is configured, the seeded in-memory store otherwise (keyless
 * fixture mode), providers via lib/providers (fixture|live by env), and the
 * shared quota tracker.
 */

export interface ChannelDomainDeps {
  channelRepo: ChannelRepo;
  avatarRepo: AvatarRepo;
  trackingRepo: TrackingRepo;
  providers: Providers;
  quota: QuotaTracker;
}

export async function getChannelDomainDeps(): Promise<ChannelDomainDeps> {
  const providers = await getProviders();
  const quota = await getSharedQuotaTracker();
  if (hasDb()) {
    return {
      channelRepo: new DrizzleChannelRepo(),
      avatarRepo: new DrizzleAvatarRepo(),
      trackingRepo: new DrizzleTrackingRepo(),
      providers,
      quota,
    };
  }
  const store = getSharedMemoryStore();
  return {
    channelRepo: store,
    avatarRepo: store.asAvatarRepo(),
    trackingRepo: store,
    providers,
    quota,
  };
}
