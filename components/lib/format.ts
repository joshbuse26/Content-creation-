/** Shared formatting helpers (pure — unit-testable). */

const numberFmt = new Intl.NumberFormat("en-US");

export function fmtNumber(n: number): string {
  return numberFmt.format(n);
}

export function fmtCompact(n: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
    n,
  );
}

/** 736 -> "12:16"; 3736 -> "1:02:16". */
export function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "12:16" | "1:02:16" | "736" -> seconds; null when unparseable. */
export function parseDuration(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parts = trimmed.split(":");
  if (parts.some((p) => p === "" || !/^\d+$/.test(p))) return null;
  if (parts.length === 1) return Number(parts[0]);
  if (parts.length === 2) return Number(parts[0]) * 60 + Number(parts[1]);
  if (parts.length === 3) return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  return null;
}

export function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
}

export function fmtDateTime(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}
