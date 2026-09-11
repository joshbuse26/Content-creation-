import { getConfig } from "@/lib/config";
import type { Role } from "@/lib/types/enums";

/**
 * Free-admin credit bypass — product admins listed in ADMIN_EMAILS, plus
 * workspace owners/admins, skip balance checks and are never debited.
 *
 * Pure enough to unit-test: pass `adminEmails` explicitly, or omit it to
 * read the parsed ADMIN_EMAILS list from config.
 */
export function parseAdminEmails(raw: string | undefined | null): string[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const email = part.trim().toLowerCase();
    if (email === "" || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

export function isRoleCreditExempt(workspaceRole: Role | null | undefined): boolean {
  return workspaceRole === "owner" || workspaceRole === "admin";
}

export function isCreditExempt(
  userEmail: string | null | undefined,
  workspaceRole: Role | null | undefined,
  adminEmails: readonly string[] = getConfig().ADMIN_EMAILS,
): boolean {
  if (isRoleCreditExempt(workspaceRole)) return true;
  if (typeof userEmail !== "string" || userEmail.trim() === "") return false;
  const needle = userEmail.trim().toLowerCase();
  return adminEmails.some((email) => email === needle);
}
