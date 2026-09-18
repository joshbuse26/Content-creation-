import { APP_HOME } from "@/components/shell/nav";

/** Query-string key a tool launch uses to seed a new Coach conversation. */
export const COACH_PROMPT_PARAM = "prompt";

/** The Coach, opening a fresh conversation with `prompt` in the composer. */
export function coachLaunchHref(prompt: string): string {
  return `${APP_HOME}?${COACH_PROMPT_PARAM}=${encodeURIComponent(prompt)}`;
}
