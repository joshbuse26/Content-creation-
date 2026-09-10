import { logger } from "@/lib/logger";
import type { Channel } from "@/lib/types/entities";
import type { WorkspaceId } from "@/lib/types/ids";
import { encryptRefreshToken } from "./crypto";
import type { ChannelDomainDeps } from "./deps";
import type { SyncEnqueuer } from "./jobs";

/**
 * OAuth-mode channel connect (build spec §5.1, mode="oauth").
 *
 * The Google OAuth dance itself (incremental `youtube.readonly` consent)
 * happens in the Auth.js/route layer — A0 owns app/api. That layer calls
 * this function with the OAuth result: the refresh token and the channel to
 * connect. The token is encrypted (AES-256-GCM, server/channel/crypto.ts)
 * before it is stored; plaintext never touches the database or logs.
 *
 * INTEGRATOR WIRING POINT (A0): from the OAuth callback, call
 * connectOauthChannel with the deps from getChannelDomainDeps() and the
 * enqueuer from getDefaultSyncEnqueuer(). See REQUESTS-A1.md.
 */

export interface OauthConnectParams {
  workspaceId: WorkspaceId;
  /** The user's channel: a UC… id or @handle resolvable by YoutubeProvider. */
  channelIdOrHandle: string;
  /** Plaintext refresh token from the OAuth token exchange. */
  refreshToken: string;
  nicheKeywords?: string[];
}

export async function connectOauthChannel(
  deps: Pick<ChannelDomainDeps, "channelRepo" | "providers" | "quota">,
  enqueuer: SyncEnqueuer,
  params: OauthConnectParams,
): Promise<Channel> {
  await deps.quota.charge("channels.list");
  const yt = await deps.providers.youtube.getChannel(params.channelIdOrHandle);
  const encrypted = encryptRefreshToken(params.refreshToken);

  const existing = await deps.channelRepo.findByYoutubeId(params.workspaceId, yt.youtubeChannelId);

  let channel: Channel;
  if (existing !== null) {
    // Re-connect: upgrade to oauth mode and rotate the stored token.
    const updated = await deps.channelRepo.update(params.workspaceId, existing.id, {
      mode: "oauth",
      title: yt.title,
      handle: yt.handle,
      oauthRefreshTokenEnc: encrypted,
      ...(params.nicheKeywords !== undefined ? { nicheKeywords: params.nicheKeywords } : {}),
    });
    if (updated === null) throw new Error("channel disappeared during oauth reconnect");
    channel = updated;
  } else {
    channel = await deps.channelRepo.create({
      workspaceId: params.workspaceId,
      mode: "oauth",
      youtubeChannelId: yt.youtubeChannelId,
      title: yt.title,
      handle: yt.handle,
      nicheKeywords: params.nicheKeywords ?? [],
      oauthRefreshTokenEnc: encrypted,
    });
  }

  await deps.channelRepo.update(params.workspaceId, channel.id, { syncStatus: "queued" });
  await enqueuer.enqueueChannelSync({ workspaceId: params.workspaceId, channelId: channel.id });
  await enqueuer.enqueueAvatarGenerate({
    workspaceId: params.workspaceId,
    channelId: channel.id,
    regenerateAll: false,
  });
  logger.info(
    { channelId: channel.id, mode: "oauth" },
    "channel connected via oauth; sync + avatar queued",
  );

  const fresh = await deps.channelRepo.get(params.workspaceId, channel.id);
  return fresh ?? channel;
}
