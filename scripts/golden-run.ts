import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getConfig } from "@/lib/config";
import { FIXTURE_IDS, fixtureVoiceProfile } from "@/lib/fixtures";
import { getProviders } from "@/lib/providers";
import { projectSchema } from "@/lib/types/entities";
import { channelIdSchema, projectIdSchema, workspaceIdSchema } from "@/lib/types/ids";
import type { ScriptStreamEvent } from "@/lib/types/pipeline";
import { runResearchPipeline } from "@/pipelines/research/pipeline";
import type { EngineDeps } from "@/pipelines/script/deps";
import { InProcessScriptEventBus } from "@/pipelines/script/events";
import { runFramePipeline } from "@/pipelines/script/frames";
import { runScriptPipeline } from "@/pipelines/script/pipeline";
import { InMemoryEngineStore } from "@/pipelines/script/store";
import { runTitlesPipeline } from "@/pipelines/script/titles";
import { PROMPT_VERSION } from "@/prompts";
import { InMemoryPipelineRunStore } from "@/queue/pipeline-runner";

/**
 * Golden-set runner (sprint plan Day 3/4: the only thing standing between
 * you and shipping slop).
 *
 * Usage:
 *   pnpm exec tsx scripts/golden-run.ts [briefs.json] [--out results.md]
 *
 * Runs each brief through research → frames → full 7-stage script → titles
 * against an isolated in-memory store, honoring PROVIDERS (fixture: zero
 * env, deterministic; live: real models — set the API keys), and emits a
 * markdown scoring sheet with a blank 1-5 column for human scoring.
 */

const briefSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  researchQuery: z.string().min(3),
  targetMinutes: z.number().int().min(2).max(60).default(10),
});
const briefsSchema = z.array(briefSchema).min(1);

interface BriefResult {
  id: string;
  title: string;
  hookStyle: string;
  hook: string;
  words: number;
  runtimeSeconds: number;
  gatePassed: boolean;
  autoFixed: boolean;
  flags: string[];
  topTitles: { text: string; family: string; score: number }[];
  wallClockMs: number;
  error: string | null;
}

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

async function runBrief(brief: z.infer<typeof briefSchema>): Promise<BriefResult> {
  const started = Date.now();
  const deps = await makeGoldenDeps();
  const workspaceId = workspaceIdSchema.parse(FIXTURE_IDS.workspace);
  const result: BriefResult = {
    id: brief.id,
    title: brief.title,
    hookStyle: "-",
    hook: "-",
    words: 0,
    runtimeSeconds: 0,
    gatePassed: false,
    autoFixed: false,
    flags: [],
    topTitles: [],
    wallClockMs: 0,
    error: null,
  };
  try {
    // Fresh project in the isolated store.
    const project = projectSchema.parse({
      id: projectIdSchema.parse(randomUUID()),
      workspaceId,
      channelId: channelIdSchema.parse(FIXTURE_IDS.channel),
      title: brief.title,
      status: "researching",
      ideaId: null,
      targetPublishDate: null,
      publishedVideoId: null,
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

    // 3. Script — full 7 stages.
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
      },
      scriptId: script.id,
      actorUserId: null,
    });
    if (scriptResult.status !== "done") {
      throw new Error(`script failed at ${scriptResult.stage}: ${scriptResult.error}`);
    }

    // 4. Titles
    const titled = await runTitlesPipeline(deps, {
      input: { workspaceId, projectId: project.id },
      actorUserId: null,
    });

    // Collect results.
    const sections = await deps.store.listSections(workspaceId, script.id);
    const hook = sections.find((s) => s.kind === "hook");
    result.hook = hook?.body ?? "-";
    const events: ScriptStreamEvent[] = [];
    for await (const event of deps.events.subscribe(script.id)) events.push(event);
    const hooksEvent = events.find((e) => e.type === "hooks");
    if (hooksEvent?.type === "hooks") {
      result.hookStyle = hooksEvent.candidates.find((c) => c.autoPicked)?.style ?? "-";
    }
    const persisted = await deps.store.getScript(workspaceId, script.id);
    result.words = persisted?.stats.words ?? 0;
    result.runtimeSeconds = persisted?.stats.estRuntimeS ?? 0;
    const report = deps.store.getCachedQualityReport(script.id);
    result.gatePassed = report?.passed ?? false;
    result.autoFixed = report?.autoFixAttempted ?? false;
    result.flags = report?.warnings ?? [];
    const unsupported = sections
      .flatMap((s) => s.factRefs)
      .filter((r) => r.researchDocId === null).length;
    if (unsupported > 0) result.flags.push(`${unsupported} unsupported claim(s)`);
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

function fmtRuntime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function renderSheet(results: BriefResult[], providers: string): string {
  const lines: string[] = [
    `# Golden-set scoring sheet`,
    "",
    `- Date: ${new Date().toISOString()}`,
    `- Providers: ${providers} · Prompt version: ${PROMPT_VERSION}`,
    `- Scoring: 1 = unusable · 2 = heavy rewrite · 3 = usable with edits · 4 = light edits · 5 = shoot it as-is`,
    "",
    "| Brief | Hook (style) | Words | Runtime | Gate | Flags | Wall clock | Score (1-5) |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const r of results) {
    const hookCell =
      r.error !== null
        ? `FAILED: ${r.error.slice(0, 60)}`
        : `${r.hook.slice(0, 70).replaceAll("|", "/")}… (${r.hookStyle})`;
    const gate =
      r.error !== null
        ? "-"
        : `${r.gatePassed ? "pass" : "FAIL"}${r.autoFixed ? " (auto-fixed)" : ""}`;
    const flags =
      r.flags.length === 0
        ? "none"
        : r.flags
            .map((f) => f.replaceAll("|", "/"))
            .join("; ")
            .slice(0, 80);
    lines.push(
      `| ${r.id} | ${hookCell} | ${r.words} | ${fmtRuntime(r.runtimeSeconds)} | ${gate} | ${flags} | ${(r.wallClockMs / 1000).toFixed(1)}s |  |`,
    );
  }
  lines.push("", "---", "");
  for (const r of results) {
    lines.push(`## ${r.id} — ${r.title}`, "");
    if (r.error !== null) {
      lines.push(`**Run failed:** ${r.error}`, "");
      continue;
    }
    lines.push(`**Hook (${r.hookStyle}):**`, "", `> ${r.hook}`, "", "**Top titles:**", "");
    for (const t of r.topTitles) {
      lines.push(`- [${t.score}] ${t.text} _(${t.family})_`);
    }
    if (r.flags.length > 0) {
      lines.push("", "**Flags:**", "", ...r.flags.map((f) => `- ${f}`));
    }
    lines.push("", "**Notes / score:**", "", "_(write here)_", "");
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out");
  const outFile = outIndex !== -1 ? args[outIndex + 1] : undefined;
  const positional = args.filter((a, i) => a !== "--out" && i !== outIndex + 1);
  const briefsPath = positional[0] ?? path.join(import.meta.dirname, "golden-briefs.json");

  const briefs = briefsSchema.parse(JSON.parse(readFileSync(briefsPath, "utf8")));
  const providers = getConfig().PROVIDERS;
  process.stderr.write(`golden-run: ${briefs.length} briefs, providers=${providers}\n`);

  const results: BriefResult[] = [];
  for (const brief of briefs) {
    process.stderr.write(`  running ${brief.id}…\n`);
    results.push(await runBrief(brief));
  }

  const sheet = renderSheet(results, providers);
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
