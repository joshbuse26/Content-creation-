import { fixtureAvatar, fixtureChannel, fixtureSnapshot } from "@/lib/fixtures";
import { InMemoryIdeationStore } from "@/pipelines/ideation/store";
import { InMemoryPartnerSource } from "@/pipelines/stages/partners";
import type { StageDeps } from "@/pipelines/stages/deps";
import { InMemoryChannelStore } from "@/server/channel/repo";
import { makeDeps } from "./a2-helpers";

/**
 * Fresh, fully in-memory StageDeps for the C1 staged-pipeline tests — the
 * engine deps from a2-helpers plus a fixture-seeded channel repo, a
 * fixture-seeded ideation store (one niche outlier), and an EMPTY partner
 * registry (tests seed partners explicitly).
 */
export function makeStageDeps(): StageDeps & {
  engine: ReturnType<typeof makeDeps>;
  channels: InMemoryChannelStore;
  ideation: InMemoryIdeationStore;
  partners: InMemoryPartnerSource;
} {
  const channels = new InMemoryChannelStore();
  channels.seedChannel(fixtureChannel);
  channels.seedSnapshot(fixtureSnapshot);
  channels.seedAvatar(fixtureAvatar);
  return {
    engine: makeDeps(),
    channels,
    ideation: new InMemoryIdeationStore(),
    partners: new InMemoryPartnerSource(),
  };
}
