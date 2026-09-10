import { Buffer } from "node:buffer";
import { getArchetypeSeed } from "@/lib/archetypes";
import type { GeneratedImage, ImageProvider } from "@/lib/providers/types";
import type { ThumbnailConcept } from "@/lib/types/entities";
import { THUMBNAIL_STAGES, type ThumbnailJobInput } from "@/lib/types/pipeline";
import { loadPackagingContext, type PackagingContext } from "@/pipelines/packaging/context";
import type { CreditRecord } from "@/pipelines/script/store";
import { hashInput, PipelineRunner, type PipelineResult } from "@/queue/pipeline-runner";
import type { PipelineRunStore } from "@/queue/pipeline-runner";
import { thumbnailImageKey, type ObjectStorage } from "@/server/storage";
import { insertThumbnailConcepts } from "./persist";
import { buildThumbnailImagePrompt, THUMBNAIL_PROMPT_VERSION } from "./prompt";

/**
 * §5.10 Thumbnail image generation — pattern + subject → image prompt →
 * ImageProvider (3 images, 1280x720) → object storage → one
 * thumbnail_concepts row per image (image_key set). 1 credit per image
 * (3 total), charged on completion only, idempotent per input hash — the
 * same pattern as script (6) and titles (1): never on failure, never twice,
 * and not for an all-skipped resume.
 *
 * Runs under the frozen pipeline kind "thumbnail" with the frozen
 * THUMBNAIL_STAGES ("build_prompt" | "generate_images").
 */

export const THUMBNAIL_IMAGE_COUNT = 3;
export const THUMBNAIL_WIDTH = 1280;
export const THUMBNAIL_HEIGHT = 720;
/** Spec §7: 1 credit per generated image. */
export const THUMBNAIL_CREDIT_COST = THUMBNAIL_IMAGE_COUNT;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export interface ThumbnailPipelineDeps {
  runs: PipelineRunStore;
  image: ImageProvider;
  storage: ObjectStorage;
  recordCredits(record: CreditRecord): Promise<void>;
  /** Injectable for tests; defaults to loadPackagingContext. */
  loadContext?: (workspaceId: string, projectId: string) => Promise<PackagingContext>;
  /** Injectable for tests; defaults to a timeout-guarded fetch. */
  fetchBytes?: (url: string) => Promise<Uint8Array>;
}

export interface ThumbnailPipelineParams {
  input: ThumbnailJobInput;
  actorUserId: string | null;
  /**
   * Archetype id whose thumbnail preset (PRODUCT-CONTRACTS §5) is folded
   * into the prompt — resolved by the router from the project's mode fields
   * (crossover: heavier archetype wins). Null/omitted = legacy prompt.
   */
  presetArchetypeId?: string | null;
  /**
   * Exact overlay text, enforced against the preset's word cap in the
   * prompt builder. Null/omitted = the model picks its own short overlay.
   */
  overlayText?: string | null;
}

/** Fold the prompt version + preset inputs into the hash so a change is new work. */
export function thumbnailInputHash(
  input: ThumbnailJobInput,
  extras: { presetArchetypeId?: string | null; overlayText?: string | null } = {},
): string {
  return hashInput({
    promptVersion: THUMBNAIL_PROMPT_VERSION,
    input,
    presetArchetypeId: extras.presetArchetypeId ?? null,
    overlayText: extras.overlayText ?? null,
  });
}

async function defaultFetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: "follow" });
  if (!res.ok) {
    throw new Error(`image download failed with status ${res.status}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength === 0) throw new Error("image download returned an empty body");
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("image download exceeded the 10MB cap");
  }
  return buf;
}

async function imageBytes(
  img: GeneratedImage,
  fetchBytes: (url: string) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  if (img.base64Png !== null) {
    return Uint8Array.from(Buffer.from(img.base64Png, "base64"));
  }
  if (img.url !== null) {
    // Live providers return hosted URLs — spec §5.10 requires copying the
    // bytes into OUR object storage; the provider URL is never persisted.
    return fetchBytes(img.url);
  }
  throw new Error("image provider returned neither a URL nor inline data");
}

export async function runThumbnailPipeline(
  deps: ThumbnailPipelineDeps,
  params: ThumbnailPipelineParams,
): Promise<{ result: PipelineResult; concepts: ThumbnailConcept[] }> {
  const { input } = params;
  const presetArchetypeId = params.presetArchetypeId ?? null;
  const overlayText = params.overlayText ?? null;
  const loadContext = deps.loadContext ?? loadPackagingContext;
  const fetchBytes = deps.fetchBytes ?? defaultFetchBytes;
  const inputHash = thumbnailInputHash(input, { presetArchetypeId, overlayText });
  const preset =
    presetArchetypeId === null
      ? null
      : (getArchetypeSeed(presetArchetypeId)?.thumbnailPreset ?? null);

  const buildPrompt = async (): Promise<string> => {
    const ctx = await loadContext(input.workspaceId, input.projectId);
    return buildThumbnailImagePrompt(ctx, {
      compositionPattern: input.compositionPattern,
      subjectDescription: input.subjectDescription,
      faceReferenceNote:
        input.faceImageKey === null
          ? null
          : `uploaded face photo on file (key ${input.faceImageKey})`,
      preset,
      overlayText,
    });
  };

  const state: { prompt?: string } = {};
  let concepts: ThumbnailConcept[] = [];

  const stageBodies: Record<(typeof THUMBNAIL_STAGES)[number], () => Promise<void>> = {
    build_prompt: async () => {
      state.prompt = await buildPrompt();
    },

    generate_images: async () => {
      // A resumed run skips build_prompt (it is pure), so rebuild here when
      // the state is empty rather than failing the stage.
      state.prompt ??= await buildPrompt();
      const prompt = state.prompt;
      const images = await deps.image.generate({
        prompt,
        width: THUMBNAIL_WIDTH,
        height: THUMBNAIL_HEIGHT,
        count: THUMBNAIL_IMAGE_COUNT,
      });
      if (images.length === 0) {
        throw new Error("image provider returned no images");
      }
      const keys: string[] = [];
      for (const [i, img] of images.slice(0, THUMBNAIL_IMAGE_COUNT).entries()) {
        const bytes = await imageBytes(img, fetchBytes);
        const key = thumbnailImageKey(input.workspaceId, input.projectId, inputHash, i);
        await deps.storage.put(key, bytes, "image/png");
        keys.push(key);
      }
      concepts = await insertThumbnailConcepts(
        keys.map((key) => ({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          promptUsed: prompt,
          compositionPattern: input.compositionPattern,
          imageKey: key,
        })),
      );
    },
  };

  const runner = new PipelineRunner(deps.runs);
  const result = await runner.execute(
    {
      kind: "thumbnail",
      stages: THUMBNAIL_STAGES.map((name) => ({ name, run: () => stageBodies[name]() })),
    },
    {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      input: params,
      inputHash,
    },
  );

  if (result.status === "done" && result.skippedStages.length !== THUMBNAIL_STAGES.length) {
    await deps.recordCredits({
      workspaceId: input.workspaceId,
      delta: -THUMBNAIL_CREDIT_COST,
      reason: "thumbnail",
      actorUserId: params.actorUserId,
      projectId: input.projectId,
      idempotencyKey: `thumbnail:${inputHash}`,
    });
  }

  return { result, concepts };
}
