import {
  researchContracts,
  revisionContracts,
  scriptContracts,
  thumbnailsContracts,
  titlesContracts,
} from "@/lib/types/api";
import type { ChatToolName } from "@/lib/types/enums";
import { getChatTool } from "@/lib/chat/tools";
import { getStageDeps } from "@/pipelines/stages/deps";
import { compositionPatternNote, resolveThumbnailPreset } from "@/pipelines/thumbnails";
import { scriptStagesImpl } from "@/server/routers/impl/script-stages";
import { revisionImpl } from "@/server/routers/impl/revision";
import { titlesImpl } from "@/server/routers/impl/titles";
import { researchImpl } from "@/server/routers/impl/research";
import { notFound, type WorkspaceHandlerCtx } from "@/server/routers/impl/_shared";

/**
 * Chat tool execution (Wave D, D1) — the confirm side of the tool-calling
 * flow. A proposed tool is executed here by CALLING THE EXISTING staged
 * handler (never reimplementing it), so a chat tool call and the staged UI
 * hitting the same stage go through the identical requireCreditsWithOverage
 * gate and the identical idempotent ledger key (`<stage>:<input hash>`) — a
 * staged call then an identical chat confirm never double-charges.
 *
 * The full contract input is reconstructed by re-parsing the proposal's
 * (already schema-validated) args plus the caller's workspaceId through the
 * SAME contract input schema the staged UI uses, so the hashed run identity
 * matches exactly. The licensed-voice guard and every mode/credit check live
 * INSIDE those handlers and therefore run for the chat route too.
 */

export interface ChatToolExecution {
  summary: string;
  creditsCharged: number;
  /** Set when the tool produced a script (draft) so the UI can deep-link. */
  scriptId: string | null;
}

/** How many credits the engine ledger actually debited during this call
 *  (null when the store doesn't expose its ledger — production Drizzle). */
function ledgerCount(store: unknown): number | null {
  const entries = (store as { creditEntries?: unknown }).creditEntries;
  return Array.isArray(entries) ? entries.length : null;
}

function chargedSince(store: unknown, before: number | null): number | null {
  if (before === null) return null;
  const entries = (store as { creditEntries?: { delta: number }[] }).creditEntries;
  if (!Array.isArray(entries)) return null;
  return entries.slice(before).reduce((sum, e) => sum + Math.max(0, -e.delta), 0);
}

export async function executeChatTool(params: {
  ctx: WorkspaceHandlerCtx;
  name: ChatToolName;
  args: Record<string, unknown>;
}): Promise<ChatToolExecution> {
  const { ctx, name, args } = params;
  const tool = getChatTool(name);
  if (tool === null) notFound("chat tool");

  // thumbnail_brief is the one zero-cost tool: v1 emits a TEXT composition
  // brief (no image pipeline, no charge) — see CHAT_TOOLS. Handle it before
  // touching the metered image handler so the 0-credit quote stays honest.
  if (name === "thumbnail_brief") {
    const input = thumbnailsContracts.generate.input.parse({
      ...args,
      workspaceId: ctx.workspaceId,
    });
    const deps = await getStageDeps();
    const project = await deps.engine.store.getProject(ctx.workspaceId, input.projectId);
    if (project === null) notFound("project");
    const preset = resolveThumbnailPreset(project);
    const pattern =
      input.compositionPattern === "auto"
        ? (preset?.compositionPatternId ?? "scale-contrast")
        : input.compositionPattern;
    const overlay = input.overlayText === null ? "" : ` Overlay: "${input.overlayText}".`;
    return {
      summary:
        `Thumbnail brief — ${pattern}: ${compositionPatternNote(pattern)} ` +
        `Subject: ${input.subjectDescription}.${overlay}`,
      creditsCharged: 0,
      scriptId: null,
    };
  }

  const deps = await getStageDeps();
  const store = deps.engine.store;
  const before = ledgerCount(store);

  const done = (summary: string, scriptId: string | null = null): ChatToolExecution => ({
    summary,
    creditsCharged: chargedSince(store, before) ?? tool.creditCost,
    scriptId,
  });

  switch (name) {
    case "list_topics": {
      const input = scriptContracts.topics.input.parse({ ...args, workspaceId: ctx.workspaceId });
      const { topics } = await scriptStagesImpl.topics({ ctx, input });
      return done(
        `Generated ${topics.length} topic candidate${topics.length === 1 ? "" : "s"} grounded in your niche and recent outliers.`,
      );
    }
    case "make_outline": {
      const input = scriptContracts.outline.input.parse({ ...args, workspaceId: ctx.workspaceId });
      const { outline } = await scriptStagesImpl.outline({ ctx, input });
      return done(
        `Built a ${outline.sections.length}-section outline honoring your pacing and target length.`,
      );
    }
    case "make_hooks": {
      const input = scriptContracts.hooks.input.parse({ ...args, workspaceId: ctx.workspaceId });
      const { hooks } = await scriptStagesImpl.hooks({ ctx, input });
      const picked = hooks.find((h) => h.autoPicked) ?? hooks[0];
      return done(
        `Generated ${hooks.length} hook options constrained to your style card` +
          (picked === undefined ? "." : `; auto-picked the "${picked.style}" hook.`),
      );
    }
    case "draft_script": {
      const input = scriptContracts.draft.input.parse({ ...args, workspaceId: ctx.workspaceId });
      const out = await scriptStagesImpl.draft({ ctx, input });
      return done(
        "Drafting your full script now — open it in the editor to watch the sections stream in.",
        out.scriptId,
      );
    }
    case "revise_section": {
      const input = revisionContracts.run.input.parse({ ...args, workspaceId: ctx.workspaceId });
      await revisionImpl.run({ ctx, input });
      return done(
        "Revision pass started — per-section suggestions will appear in the editor to accept or reject.",
      );
    }
    case "make_titles": {
      const input = titlesContracts.generate.input.parse({ ...args, workspaceId: ctx.workspaceId });
      await titlesImpl.generate({ ctx, input });
      return done("Generating scored title options across pattern families.");
    }
    case "fetch_research": {
      const input = researchContracts.search.input.parse({ ...args, workspaceId: ctx.workspaceId });
      await researchImpl.search({ ctx, input });
      return done("Researching your query and attaching a cited brief to the project.");
    }
    // thumbnail_brief handled above.
  }
  // Exhaustive: every ChatToolName is covered.
  notFound("chat tool");
}
