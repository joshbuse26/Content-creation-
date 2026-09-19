import { Buffer } from "node:buffer";
import { getArchetypeSeed } from "@/lib/archetypes";
import type { GeneratedImage } from "@/lib/providers/types";
import type { ThumbnailConcept, ThumbnailPreset } from "@/lib/types/entities";
import type { ColorMood, SubjectMode } from "@/lib/types/enums";
import type { ProjectId, WorkspaceId } from "@/lib/types/ids";
import { loadPackagingContext, type PackagingContext } from "@/pipelines/packaging/context";
import { hashInput, PipelineRunner, type PipelineResult } from "@/queue/pipeline-runner";
import { thumbnailImageKey } from "@/server/storage";
import { COMPOSITION_PATTERN_IDS, compositionPatternNote } from "./patterns";
import {
  applyThumbnailConceptTweak,
  insertThumbnailConcepts,
  listBoardConcepts,
  type NewThumbnailConcept,
} from "./persist";
import {
  contrastRuleNote,
  DEFAULT_MAX_OVERLAY_WORDS,
  enforceOverlayWordCap,
  faceRequirementNote,
  paletteTemperatureNote,
  resolveThumbnailPreset,
  type GenerationModeFields,
} from "./presets";
import { defaultFetchBytes, type ThumbnailPipelineDeps } from "./pipeline";

/**
 * Thumbnail Whiteboard board generation (WAVE-D / E2).
 *
 * ADDITIVE to the one-shot §5.10 pipeline: a board generates N independent
 * CONCEPTS (3-6) that share one board_id, each concept being exactly ONE
 * image = ONE credit, charged on completion, idempotent per concept's
 * input hash — the same metering contract as the one-shot `generate`, just
 * metered per image instead of per 3-image run.
 *
 * Every concept's input hash is DETERMINISTIC in its params (project,
 * preset, overlay, subject slot, color mood, composition pattern) and the
 * board prompt version — NOT the board_id — so a re-run with identical
 * params re-serves the stored images and charges nothing (the PipelineRunner
 * skips the done stages; the ledger idempotency key dedupes the charge).
 *
 * Presets stay ABSTRACT composition rules (PRODUCT-CONTRACTS §5): never a
 * reference to, or reproduction of, any real video's or creator's thumbnail.
 */

export const BOARD_PROMPT_VERSION = "tb-v1";
/** 1 credit per concept image — the existing per-image rate (spec §7). */
export const BOARD_PER_IMAGE_CREDIT = 1;
export const BOARD_MIN_COUNT = 3;
export const BOARD_MAX_COUNT = 6;

export interface BoardConceptParams {
  compositionPattern: string;
  overlayText: string | null;
  presetId: string | null;
  subjectMode: SubjectMode | null;
  colorMood: ColorMood | null;
}

export interface GenerateBoardParams {
  workspaceId: WorkspaceId;
  projectId: ProjectId;
  count: number;
  /** Mode fields of the project — resolves the default preset (archetype). */
  project: GenerationModeFields;
  actorUserId: string | null;
  creditExempt?: boolean;
  /** Base overlay text shared by every concept; null = the model picks. */
  overlayText?: string | null;
  /** Preset/archetype key override; null → resolve from the project. */
  presetId?: string | null;
  /** Base subject slot; null → derived from the resolved preset's face rule. */
  subjectMode?: SubjectMode | null;
  /** Base color mood; null → derived from the resolved preset's palette. */
  colorMood?: ColorMood | null;
}

export interface TweakConceptParams {
  workspaceId: WorkspaceId;
  concept: ThumbnailConcept;
  actorUserId: string | null;
  creditExempt?: boolean;
  compositionPattern?: string;
  overlayText?: string | null;
  presetId?: string | null;
  subjectMode?: SubjectMode | null;
  colorMood?: ColorMood | null;
}

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

/** Format the first 32 hex chars of a hash as a v4-shaped UUID string. */
export function deterministicBoardId(seed: string): string {
  const hex = hashInput(seed).slice(0, 32).padEnd(32, "0");
  const v4 = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  return v4;
}

/**
 * Pick `count` distinct composition patterns for a board. The preset's own
 * pattern (when present) leads; the rest are taken from the library in order,
 * skipping the lead so every card is visibly different for side-by-side
 * comparison.
 */
export function boardCompositionPatterns(preset: ThumbnailPreset | null, count: number): string[] {
  const lead = preset?.compositionPatternId ?? null;
  const ordered = lead === null ? [] : [lead];
  for (const id of COMPOSITION_PATTERN_IDS) {
    if (ordered.length >= count) break;
    if (id !== lead) ordered.push(id);
  }
  // Defensive: if the library is smaller than count, cycle to fill.
  let i = 0;
  while (ordered.length < count && COMPOSITION_PATTERN_IDS.length > 0) {
    ordered.push(COMPOSITION_PATTERN_IDS[i % COMPOSITION_PATTERN_IDS.length] ?? "big-text");
    i += 1;
  }
  return ordered.slice(0, count);
}

/** Preset face rule → the default subject slot when none was given. */
export function defaultSubjectMode(preset: ThumbnailPreset | null): SubjectMode {
  switch (preset?.face) {
    case "required":
      return "face";
    case "none":
      return "no_face";
    default:
      return "object";
  }
}

/** Preset palette → the default color mood when none was given. */
export function defaultColorMood(preset: ThumbnailPreset | null): ColorMood {
  switch (preset?.paletteTemperature) {
    case "warm":
      return "warm";
    case "cool":
      return "cool";
    default:
      return "neutral";
  }
}

const SUBJECT_MODE_NOTES: Record<SubjectMode, string> = {
  face: "Feature one expressive human face as the focal subject; strong, readable emotion.",
  no_face: "No human faces anywhere — a hero object or scene carries the frame.",
  object:
    "A single hero object is the focal subject; a supporting face may appear but not dominate.",
};

const COLOR_MOOD_NOTES: Record<ColorMood, string> = {
  warm: "Warm palette — reds, oranges and ambers dominate.",
  cool: "Cool palette — blues, teals and cold greys dominate.",
  neutral: "Neutral palette — desaturated tones with one restrained accent.",
  vibrant: "Vibrant palette — saturated, punchy color with bold contrast (never neon-garish).",
  moody: "Moody palette — deep shadows, low-key lighting, one dramatic highlight.",
};

/**
 * Deterministic per-concept image prompt for a board card. Pure: pattern
 * guidance + subject slot + color mood + project context + the preset's
 * abstract rules + the production constraints. Enforces the preset's overlay
 * word cap (throws OverlayTextTooLongError on overflow — never silently
 * truncates).
 */
export function buildBoardConceptPrompt(
  ctx: PackagingContext,
  params: BoardConceptParams,
  preset: ThumbnailPreset | null,
): string {
  const maxOverlayWords = preset?.maxOverlayWords ?? DEFAULT_MAX_OVERLAY_WORDS;
  const overlayText = enforceOverlayWordCap(params.overlayText, maxOverlayWords);
  const subjectMode = params.subjectMode ?? defaultSubjectMode(preset);
  const colorMood = params.colorMood ?? defaultColorMood(preset);
  const keywords = (ctx.frame?.keywords ?? ctx.nicheKeywords).slice(0, 3).join(", ");
  const lines = [
    `YouTube thumbnail, 1280x720, 16:9. Video: "${ctx.projectTitle}".`,
    "",
    `Composition (${params.compositionPattern}): ${compositionPatternNote(params.compositionPattern)}`,
    `Subject: ${SUBJECT_MODE_NOTES[subjectMode]}`,
    `Color mood: ${COLOR_MOOD_NOTES[colorMood]}`,
    ...(ctx.frame === null
      ? []
      : [
          `Angle of the video: ${ctx.frame.angle}`,
          `Mood: ${ctx.frame.tone} — the image should read the same way at a glance.`,
        ]),
    ...(keywords === "" ? [] : [`Topic context: ${keywords}`]),
    ...(preset === null
      ? []
      : [
          "",
          "Style preset (abstract composition rules):",
          `- Contrast: ${contrastRuleNote(preset.contrastRule)}`,
          `- Palette: ${paletteTemperatureNote(preset.paletteTemperature)}`,
          `- Faces: ${faceRequirementNote(preset.face)}`,
        ]),
    ...(overlayText === null ? [] : [`Overlay text (verbatim, nothing else): "${overlayText}"`]),
    "",
    "Production constraints:",
    "- One dominant focal point; crop tighter than feels comfortable.",
    "- High contrast, saturated but not neon; must stay legible at 168px wide.",
    `- At most ${String(maxOverlayWords)} word${maxOverlayWords === 1 ? "" : "s"} of overlay text, heavy sans-serif, strong contrast against the background.`,
    "- No logos, no watermarks, no brand marks, no channel names.",
    "- No real people's likenesses and no reproduction of any real creator's thumbnail.",
    `[${BOARD_PROMPT_VERSION}]`,
  ];
  return lines.join("\n");
}

/** Deterministic input hash for one board concept — NOT keyed on board_id. */
export function conceptInputHash(
  workspaceId: string,
  projectId: string,
  params: BoardConceptParams,
): string {
  return hashInput({
    promptVersion: BOARD_PROMPT_VERSION,
    workspaceId,
    projectId,
    compositionPattern: params.compositionPattern,
    overlayText: params.overlayText ?? null,
    presetId: params.presetId ?? null,
    subjectMode: params.subjectMode ?? null,
    colorMood: params.colorMood ?? null,
  });
}

// ---------------------------------------------------------------------------
// Single-concept image generation (1 image, 1 credit, idempotent)
// ---------------------------------------------------------------------------

function conceptImageBytes(img: GeneratedImage): Uint8Array | null {
  if (img.base64Png !== null) return Uint8Array.from(Buffer.from(img.base64Png, "base64"));
  return null;
}

interface ConceptGenResult {
  status: PipelineResult["status"];
  imageKey: string | null;
  promptUsed: string;
  /** Why the image stage failed (provider / download error), else null. */
  error: string | null;
}

/**
 * A board or tweak produced NO image. Surfaced to the user (the router maps
 * it to a gateway error) instead of a silent empty board — the message
 * carries the provider/download reason, never a key.
 */
export class ThumbnailImageError extends Error {
  constructor(reason: string) {
    super(`The image service couldn't produce a thumbnail (${reason}). Try again in a moment.`);
    this.name = "ThumbnailImageError";
  }
}

/**
 * Generate (or re-serve) one concept image. Runs the frozen two-stage
 * "thumbnail" pipeline with count=1, stores the image at a deterministic key,
 * and charges exactly BOARD_PER_IMAGE_CREDIT on a fresh completion (never on
 * failure, never on an all-skipped resume). Returns the stored key regardless
 * of skip so callers can attach it to a row.
 */
async function generateConceptImage(
  deps: ThumbnailPipelineDeps,
  args: {
    workspaceId: WorkspaceId;
    projectId: ProjectId;
    params: BoardConceptParams;
    preset: ThumbnailPreset | null;
    actorUserId: string | null;
    creditExempt?: boolean;
  },
): Promise<ConceptGenResult> {
  const loadContext = deps.loadContext ?? loadPackagingContext;
  const fetchBytes = deps.fetchBytes ?? defaultFetchBytes;
  const inputHash = conceptInputHash(args.workspaceId, args.projectId, args.params);
  const imageKey = thumbnailImageKey(args.workspaceId, args.projectId, inputHash, 0);

  // Prompt is pure — build it up front so it is available even on a resume
  // that skips the build_prompt stage (and so overlay-cap errors surface
  // before any pipeline row is created).
  const ctx = await loadContext(args.workspaceId, args.projectId);
  const prompt = buildBoardConceptPrompt(ctx, args.params, args.preset);

  const stageBodies: Record<string, () => Promise<void>> = {
    build_prompt: () => Promise.resolve(),
    generate_images: async () => {
      const images = await deps.image.generate({ prompt, width: 1280, height: 720, count: 1 });
      const img = images[0];
      if (img === undefined) throw new Error("image provider returned no images");
      let bytes = conceptImageBytes(img);
      if (bytes === null) {
        if (img.url === null) {
          throw new Error("image provider returned neither a URL nor inline data");
        }
        // Live providers hand back short-lived hosted URLs — copy the bytes
        // into OUR storage; the provider URL is never persisted (spec §5.10).
        bytes = await fetchBytes(img.url);
      }
      await deps.storage.put(imageKey, bytes, "image/png");
    },
  };

  const runner = new PipelineRunner(deps.runs);
  const result = await runner.execute(
    {
      kind: "thumbnail",
      stages: [
        { name: "build_prompt", run: () => stageBodies.build_prompt?.() ?? Promise.resolve() },
        {
          name: "generate_images",
          run: () => stageBodies.generate_images?.() ?? Promise.resolve(),
        },
      ],
    },
    { workspaceId: args.workspaceId, projectId: args.projectId, input: { inputHash }, inputHash },
  );

  if (result.status === "done" && result.skippedStages.length !== 2) {
    await deps.recordCredits({
      workspaceId: args.workspaceId,
      delta: -BOARD_PER_IMAGE_CREDIT,
      reason: "thumbnail",
      actorUserId: args.actorUserId,
      projectId: args.projectId,
      idempotencyKey: `thumbnail:${inputHash}`,
      ...(args.creditExempt === true ? { skipDebit: true } : {}),
    });
  }

  return {
    status: result.status,
    imageKey: result.status === "done" ? imageKey : null,
    promptUsed: prompt,
    error: result.status === "failed" ? result.error : null,
  };
}

// ---------------------------------------------------------------------------
// Board + tweak orchestration
// ---------------------------------------------------------------------------

export interface GeneratedBoard {
  boardId: string;
  concepts: ThumbnailConcept[];
}

/**
 * Generate a board of `count` concepts. Idempotent: a re-run with identical
 * base params resolves the same board_id, re-serves the stored images, and
 * charges nothing. Only the missing sort slots are (re)generated, so a
 * partial prior failure is healed without duplicating rows.
 */
export async function runThumbnailBoard(
  deps: ThumbnailPipelineDeps,
  params: GenerateBoardParams,
): Promise<GeneratedBoard> {
  const preset =
    params.presetId !== null && params.presetId !== undefined
      ? (getArchetypeSeed(params.presetId)?.thumbnailPreset ?? null)
      : resolveThumbnailPreset(params.project);
  const presetId = params.presetId ?? preset?.id ?? null;
  const overlayText = params.overlayText ?? null;
  const subjectMode = params.subjectMode ?? null;
  const colorMood = params.colorMood ?? null;

  const boardId = deterministicBoardId(
    JSON.stringify({
      promptVersion: BOARD_PROMPT_VERSION,
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      count: params.count,
      presetId,
      overlayText,
      subjectMode,
      colorMood,
    }),
  );

  const patterns = boardCompositionPatterns(preset, params.count);
  const existing = await listBoardConcepts(params.workspaceId, params.projectId, boardId);
  const presentSorts = new Set(existing.map((c) => c.sort));

  const toInsert: NewThumbnailConcept[] = [];
  const failures: string[] = [];
  await Promise.all(
    patterns.map(async (compositionPattern, i) => {
      if (presentSorts.has(i)) return;
      const conceptParams: BoardConceptParams = {
        compositionPattern,
        overlayText,
        presetId,
        subjectMode,
        colorMood,
      };
      const gen = await generateConceptImage(deps, {
        workspaceId: params.workspaceId,
        projectId: params.projectId,
        params: conceptParams,
        preset,
        actorUserId: params.actorUserId,
        creditExempt: params.creditExempt,
      });
      if (gen.status !== "done") {
        failures.push(gen.error ?? "unknown error");
        return;
      }
      toInsert.push({
        workspaceId: params.workspaceId,
        projectId: params.projectId,
        promptUsed: gen.promptUsed,
        compositionPattern,
        imageKey: gen.imageKey,
        boardId,
        overlayText,
        presetId,
        subjectMode,
        colorMood,
        sort: i,
      });
    }),
  );

  if (toInsert.length > 0) {
    // Sort before insert so createdAt order matches the sort order too.
    toInsert.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    await insertThumbnailConcepts(toInsert);
  }

  const concepts = await listBoardConcepts(params.workspaceId, params.projectId, boardId);
  // A board that produced nothing is an error, not an empty success. A
  // partial board is returned as-is: the next identical run heals the gaps.
  if (patterns.length > 0 && concepts.length === 0) {
    throw new ThumbnailImageError(failures[0] ?? "no images were produced");
  }
  return { boardId, concepts };
}

/**
 * Regenerate one concept's image with tweaked params and rewrite the row in
 * place. 1 credit, idempotent on the tweaked input hash (an identical tweak
 * re-serves the stored image and charges nothing). Tenancy: the caller must
 * have already resolved `concept` in the workspace.
 */
export async function runConceptTweak(
  deps: ThumbnailPipelineDeps,
  params: TweakConceptParams,
): Promise<ThumbnailConcept | null> {
  const { concept } = params;
  // Merge tweaks over the concept's current params.
  const presetKey = params.presetId !== undefined ? params.presetId : concept.presetId;
  const preset = presetKey !== null ? (getArchetypeSeed(presetKey)?.thumbnailPreset ?? null) : null;
  const merged: BoardConceptParams = {
    compositionPattern: params.compositionPattern ?? concept.compositionPattern,
    overlayText: params.overlayText !== undefined ? params.overlayText : concept.overlayText,
    presetId: presetKey,
    subjectMode: params.subjectMode !== undefined ? params.subjectMode : concept.subjectMode,
    colorMood:
      params.colorMood !== undefined ? params.colorMood : (concept.colorMood as ColorMood | null),
  };

  const gen = await generateConceptImage(deps, {
    workspaceId: params.workspaceId,
    projectId: concept.projectId,
    params: merged,
    preset,
    actorUserId: params.actorUserId,
    creditExempt: params.creditExempt,
  });
  if (gen.status !== "done") throw new ThumbnailImageError(gen.error ?? "unknown error");

  return applyThumbnailConceptTweak(params.workspaceId, concept.id, {
    imageKey: gen.imageKey,
    promptUsed: gen.promptUsed,
    compositionPattern: merged.compositionPattern,
    overlayText: merged.overlayText,
    presetId: merged.presetId,
    subjectMode: merged.subjectMode,
    colorMood: merged.colorMood,
  });
}
