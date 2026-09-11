import { isRoleCreditExempt } from "@/lib/credits-exempt";
import type { Role } from "@/lib/types/enums";

/** Client-side skip-paywall: workspace owners/admins are credit-exempt. */
export function isUiCreditExempt(role: Role | null | undefined, billingExempt?: boolean): boolean {
  return billingExempt === true || isRoleCreditExempt(role);
}

export function creditCostLabel(cost: number, exempt: boolean): string {
  if (exempt) return "included";
  return `${String(cost)} credit${cost === 1 ? "" : "s"}`;
}
