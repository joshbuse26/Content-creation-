import { isBlankAngle, SET_UNIQUE_ANGLE_NUDGE } from "@/lib/style-gates";

/**
 * Non-blocking framing nudge (WAVE-D-PLAN §3 D4): while the chosen frame's
 * `angle` is blank, encourage the user to set a specific perspective before
 * generating. It is purely informational — angle-less projects still
 * generate; the nudge + the reported `uniqueAngleApplied` signal are the
 * driver. Renders nothing once an angle is set.
 */
export function UniqueAngleNudge({ angle }: { angle: string | null | undefined }) {
  if (!isBlankAngle(angle)) return null;
  return (
    <p
      role="note"
      className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-300"
    >
      {SET_UNIQUE_ANGLE_NUDGE}
    </p>
  );
}
