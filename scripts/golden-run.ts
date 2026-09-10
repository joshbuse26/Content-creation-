import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getConfig } from "@/lib/config";
import { FIXTURE_IDS, fixtureVoiceProfile } from "@/lib/fixtures";
import { getProviders } from "@/lib/providers";
import { generationTargetSchema, projectSchema, type GenerationTarget } from "@/lib/types/entities";
import { asUserId, channelIdSchema, projectIdSchema, workspaceIdSchema } from "@/lib/types/ids";
import type { ScriptStreamEvent } from "@/lib/types/pipeline";
import { runResearchPipeline } from "@/pipelines/research/pipeline";
import { setEngineDepsForTests, type EngineDeps } from "@/pipelines/script/deps";
import { setStageDepsForTests } from "@/pipelines/stages/deps";
import { InProcessScriptEventBus } from "@/pipelines/script/events";
import { runFramePipeline } from "@/pipelines/script/frames";
import { runScriptPipeline } from "@/pipelines/script/pipeline";
import { InMemoryEngineStore } from "@/pipelines/script/store";
import { runTitlesPipeline } from "@/pipelines/script/titles";
import { PROMPT_VERSION } from "@/prompts";
import { InMemoryPipelineRunStore } from "@/queue/pipeline-runner";
import { scriptContracts } from "@/lib/types/api";
import { scriptStagesImpl } from "@/server/routers/impl/script-stages";
import type { WorkspaceHandlerCtx } from "@/server/routers/impl/_shared";
import {
  briefModeLabel,
  computeGatePassRates,
  goldenBriefsSchema,
  parseScoringTable,
  renderCompareSection,
  renderSheet,
  type GoldenBrief,
  type GoldenBriefResult,
} from "./golden-lib";

/**
 * Golden-set runner v2 (sprint plan Day 3/4 + PRODUCT-CONTRACTS §6: the only
 * thing standing between you and shipping slop).
 *
 * Usage:
 *   pnpm exec tsx scripts/golden-run.ts [briefs.json] [--out results.md] [--compare baseline.md]
 *
 * Per brief:
 *   - legacy (no archetype): research → frames → full 7-stage script → titles,
 *     exactly the v1 flow.
 *   - archetype / crossover: research → frames, then the STAGED pipeline path
 *     (PRODUCT-CONTRACTS §4) through the real stage handlers — topics are
 *     SKIPPED because the brief already carries its topic; outline → hooks →
 *     draft run with the brief's generation target, so the golden loop
 *     exercises whatever the staged handlers currently are (stubs today, C1's
 *     Grok-backed pipeline when it lands) → titles.
 *
 * Everything runs against an isolated in-memory engine store, honoring
 * PROVIDERS (fixture: zero env, deterministic; live: real models). The
 * staged path passes the same credit gate as production dispatch — keyless
 * runs use the in-memory fixture workspace; a DB-backed run needs the seeded
 * fixture workspace (`pnpm seed`).
 *
 * The scoring sheet carries the per-gate style columns from the frozen
 * styleGateReportSchema plus a blank human 1–5 column; `--compare` diffs
 * gate pass-rates against a previous sheet (it parses only the
 * machine-generated table this script writes).
 */

async function makeGoldenDeps(): Promise<EngineDeps & { store: InMemoryEngineStore }> {
  const providers = await getProviders();
  return {
    mode: getConfig().PROVIDERS,
    llm: providers.llm,
    search: providers.search,
    transcript: providers.transcript,
    store: new InMemoryEngineStore(),
    runs: new InMemoryPipelineRunStore(),
    events: new InProcessScriptEventBus(),
  };
}

function generationFor(brief: GoldenBrief): GenerationTarget | null {
  if (brief.archetypeId !== null) {
    return generationTargetSchema.parse({ mode: "archetype", archetypeId: brief.archetypeId });
  }
  if (brief.crossover !== null) {
    return generationTargetSchema.parse({ mode: "crossover", crossover: brief.crossover });
  }
  return null;
}

async function runBrief(brief: GoldenBrief): Promise<GoldenBriefResult> {
  const started = Date.now();
  const deps = await makeGoldenDeps();
  const workspaceId = workspaceIdSchema.parse(FIXTURE_IDS.workspace);
  const result: GoldenBriefResult = {
    id: brief.id,
    title: brief.title,
    mode: briefModeLabel(brief),
    hookStyle: "-",
    hook: "-",
    words: 0,
    runtimeSeconds: 0,
    gatePassed: false,
    autoFixed: false,
    styleGates: null,
    flags: [],
    topTitles: [],
    wallClockMs: 0,
    error: null,
  };
  try {
    // Fresh project in the isolated store, carrying the brief's mode fields.
    const generation = generationFor(brief);
    const project = projectSchema.parse({
      id: projectIdSchema.parse(randomUUID()),
      workspaceId,
      channelId: channelIdSchema.parse(FIXTURE_IDS.channel),
      title: brief.title,
      status: "researching",
      ideaId: null,
      targetPublishDate: null,
      publishedVideoId: null,
      generationMode: generation?.mode ?? null,
      archetypeId: generation?.archetypeId ?? null,
      crossover: generation?.crossover ?? null,
      partnerId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    deps.store.seedProject(project);

    // 1. Research
    const research = await runResearchPipeline(deps, {
      input: { workspaceId, projectId: project.id, query: brief.researchQuery },
      actorUserId: null,
    });
    if (research.status !== "done") {
      throw new Error(`research failed at ${research.stage}: ${research.error}`);
    }

    // 2. Frames — choose the first proposal, pinned to the brief's length.
    const framed = await runFramePipeline(deps, {
      input: { workspaceId, projectId: project.id },
      actorUserId: null,
    });
    if (framed.result.status !== "done") {
      throw new Error(`framing failed: ${framed.result.status}`);
    }
    const frame = framed.frames[0];
    if (frame === undefined) throw new Error("no frames proposed");
    await deps.store.chooseFrame(workspaceId, frame.id);
    await deps.store.updateFrame(workspaceId, frame.id, {
      targetMinutes: brief.targetMinutes,
    });

    // 3. Script — staged path when the brief carries an archetype/crossover,
    // the legacy 7-stage pipeline otherwise.
    let scriptId;
    if (generation !== null) {
      const ctx: WorkspaceHandlerCtx = { userId: asUserId(FIXTURE_IDS.user), workspaceId };
      // The stage handlers resolve deps through getStageDeps() →
      // getEngineDeps(); point the engine at this brief's isolated store and
      // clear the stage-deps cache so it rebuilds around it (otherwise the
      // first brief's store is captured for every later brief).
      setEngineDepsForTests(deps);
      setStageDepsForTests(undefined);
      try {
        // topics SKIPPED — the brief IS the chosen topic.
        const { outline } = await scriptStagesImpl.outline({
          ctx,
          input: scriptContracts.outline.input.parse({
            workspaceId,
            projectId: project.id,
            frameId: frame.id,
            topic: { title: brief.title, angle: brief.researchQuery },
            generation,
          }),
        });
        const { hooks } = await scriptStagesImpl.hooks({
          ctx,
          input: scriptContracts.hooks.input.parse({
            workspaceId,
            projectId: project.id,
            outline,
            generation,
          }),
        });
        const chosenHook = hooks.find((h) => h.autoPicked) ?? hooks[0] ?? null;
        const draft = await scriptStagesImpl.draft({
          ctx,
          input: scriptContracts.draft.input.parse({
            workspaceId,
            projectId: project.id,
            frameId: frame.id,
            outline,
            hook: chosenHook,
            generation,
          }),
        });
        scriptId = draft.scriptId;
        result.hookStyle = chosenHook?.style ?? "-";
      } finally {
        setEngineDepsForTests(undefined);
        setStageDepsForTests(undefined);
      }
    } else {
      const script = await deps.store.createScript({
        workspaceId,
        projectId: project.id,
        voiceProfileId: fixtureVoiceProfile.id,
      });
      const scriptResult = await runScriptPipeline(deps, {
        input: {
          workspaceId,
          projectId: project.id,
          frameId: frame.id,
          voiceProfileId: fixtureVoiceProfile.id,
          generation: null,
        },
        scriptId: script.id,
        actorUserId: null,
      });
      if (scriptResult.status !== "done") {
        throw new Error(`script failed at ${scriptResult.stage}: ${scriptResult.error}`);
      }
      scriptId = script.id;
      const events: ScriptStreamEvent[] = [];
      for await (const event of deps.events.subscribe(script.id)) events.push(event);
      const hooksEvent = events.find((e) => e.type === "hooks");
      if (hooksEvent?.type === "hooks") {
        result.hookStyle = hooksEvent.candidates.find((c) => c.autoPicked)?.style ?? "-";
      }
    }

    // 4. Titles
    const titled = await runTitlesPipeline(deps, {
      input: { workspaceId, projectId: project.id },
      actorUserId: null,
    });

    // Collect results.
    const sections = await deps.store.listSections(workspaceId, scriptId);
    const hook = sections.find((s) => s.kind === "hook");
    result.hook = hook?.body ?? "-";
    const persisted = await deps.store.getScript(workspaceId, scriptId);
    result.words = persisted?.stats.words ?? 0;
    result.runtimeSeconds = persisted?.stats.estRuntimeS ?? 0;
    const report = deps.store.getCachedQualityReport(scriptId);
    result.gatePassed = report?.passed ?? false;
    result.autoFixed = report?.autoFixAttempted ?? false;
    result.styleGates = report?.styleGates ?? null;
    result.flags = [...(report?.warnings ?? [])];
    const unsupported = sections
      .flatMap((s) => s.factRefs)
      .filter((r) => r.researchDocId === null).length;
    if (unsupported > 0) result.flags.push(`${String(unsupported)} unsupported claim(s)`);
    result.topTitles = (titled.titleSet?.options ?? [])
      .slice()
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((o) => ({ text: o.text, family: o.patternFamily, score: o.score }));
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }
  result.wallClockMs = Date.now() - started;
  return result;
}

function takeFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  args.splice(index, 2);
  return value;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outFile = takeFlagValue(args, "--out");
  const compareFile = takeFlagValue(args, "--compare");
  const briefsPath = args[0] ?? path.join(import.meta.dirname, "golden-briefs.json");

  const briefs = goldenBriefsSchema.parse(JSON.parse(readFileSync(briefsPath, "utf8")));
  const providers = getConfig().PROVIDERS;
  process.stderr.write(`golden-run: ${String(briefs.length)} briefs, providers=${providers}\n`);

  const results: GoldenBriefResult[] = [];
  for (const brief of briefs) {
    process.stderr.write(`  running ${brief.id}…\n`);
    results.push(await runBrief(brief));
  }

  let sheet = renderSheet(results, { providers, promptVersion: PROMPT_VERSION });
  if (compareFile !== undefined) {
    const baselineRates = computeGatePassRates(
      parseScoringTable(readFileSync(compareFile, "utf8")),
    );
    const currentRates = computeGatePassRates(parseScoringTable(sheet));
    sheet += `\n${renderCompareSection(compareFile, baselineRates, currentRates)}\n`;
  }

  if (outFile !== undefined) {
    writeFileSync(outFile, sheet);
    process.stderr.write(`wrote ${outFile}\n`);
  } else {
    process.stdout.write(`${sheet}\n`);
  }
  const failed = results.filter((r) => r.error !== null).length;
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
