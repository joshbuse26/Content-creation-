import { hasDb } from "@/db";
import { getIdeationStore, type IdeationStore } from "@/pipelines/ideation/store";
import { getEngineDeps, type EngineDeps } from "@/pipelines/script/deps";
import { DrizzleChannelRepo, getSharedMemoryStore, type ChannelRepo } from "@/server/channel/repo";
import { getPartnerSource, type PartnerSource } from "./partners";

/**
 * StageDeps — everything the staged script procedures (PRODUCT-CONTRACTS
 * §4) need beyond the script engine itself: channel rows (ownership checks
 * + niche keywords for `topics`), the outlier index (topic evidence), and
 * partner records (partnered_named resolution). Injectable so tests run
 * fully in-memory with zero env, same pattern as EngineDeps/IdeationDeps.
 */
export interface StageDeps {
  engine: EngineDeps;
  channels: ChannelRepo;
  ideation: IdeationStore;
  partners: PartnerSource;
}

let cachedDeps: StageDeps | undefined;

export async function getStageDeps(): Promise<StageDeps> {
  if (cachedDeps === undefined) {
    cachedDeps = {
      engine: await getEngineDeps(),
      channels: hasDb() ? new DrizzleChannelRepo() : getSharedMemoryStore(),
      ideation: getIdeationStore(),
      partners: getPartnerSource(),
    };
  }
  return cachedDeps;
}

export function setStageDepsForTests(deps: StageDeps | undefined): void {
  cachedDeps = deps;
}
