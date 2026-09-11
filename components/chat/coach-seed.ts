/**
 * Coach hand-off seed (Wave-D D3) — the bridge from the discovery surface's
 * "Ask Coach" into a project's Coach thread. Discovery writes {title, angle}
 * to sessionStorage under this per-project key; the chat panel reads it once
 * on mount and prefills the composer so the Coach can go straight to a hook
 * and outline. The unique angle also reaches the Coach through project context
 * (buildCoachContext reads it off the seeded chosen frame), so a dropped seed
 * degrades gracefully — the angle is never lost.
 */

export interface CoachSeed {
  title: string;
  angle: string;
}

export function coachSeedKey(projectId: string): string {
  return `coach-seed:${projectId}`;
}

/** Read + clear the seed for a project. Best-effort: never throws. */
export function takeCoachSeed(projectId: string): CoachSeed | null {
  try {
    const raw = sessionStorage.getItem(coachSeedKey(projectId));
    if (raw === null) return null;
    sessionStorage.removeItem(coachSeedKey(projectId));
    const parsed = JSON.parse(raw) as Partial<CoachSeed>;
    const title = typeof parsed.title === "string" ? parsed.title : "";
    const angle = typeof parsed.angle === "string" ? parsed.angle : "";
    if (title === "" && angle === "") return null;
    return { title, angle };
  } catch {
    return null;
  }
}

/** The prefilled first message the Coach thread opens with. */
export function coachSeedPrompt(seed: CoachSeed): string {
  const angle = seed.angle.trim();
  const anglePart = angle === "" ? "" : ` My unique angle: ${angle}.`;
  return `Let's plan a video: "${seed.title}".${anglePart} Give me a strong hook and a section outline.`;
}
