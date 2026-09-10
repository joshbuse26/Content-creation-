/**
 * B3 billing domain — tiers, limits, Stripe checkout/portal, webhook
 * handling, overage metering, and the overage-aware requireCredits
 * replacement. See REQUESTS-B3.md for the integrator wiring notes.
 */

export {
  TIERS,
  PAID_PLANS,
  PLAN_RANK,
  isPaidPlan,
  checkChannelLimit,
  checkSeatLimit,
  graceEndsAt,
  isWorkspaceReadOnly,
  GRACE_PERIOD_DAYS,
  OVERAGE_CEILING_CREDITS,
  OVERAGE_UNIT_USD,
  type TierConfig,
  type PaidPlan,
  type LimitCheck,
} from "@/server/billing/tiers";
export { assertChannelLimit, assertSeatLimit } from "@/server/billing/limits";
export { requireCreditsWithOverage, type OverageMeter } from "@/server/billing/overage";
export { handleStripeEvent, type StripeWebhookEvent } from "@/server/billing/events";
export {
  getBillingStore,
  resetBillingStoreForTests,
  DrizzleBillingStore,
  InMemoryBillingStore,
  type BillingStore,
  type BillingWorkspace,
} from "@/server/billing/store";
export { createCheckoutSession, createPortalSession } from "@/server/billing/checkout";
export { getBillingStatus, type BillingStatus } from "@/server/billing/status";
