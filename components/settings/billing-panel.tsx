"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { IconExternal, IconWarning } from "@/components/ui/icons";
import { ErrorState, LoadingState } from "@/components/ui/state";
import { useToast } from "@/components/ui/toast";
import { fmtDate, fmtDateTime, fmtNumber } from "@/components/lib/format";
import { isUiCreditExempt } from "@/components/lib/credits-ui";
import type { BillingStatus } from "@/server/billing/status";
import { PAID_PLANS, PLAN_RANK, TIERS, type PaidPlan } from "@/server/billing/tiers";

/**
 * Billing settings (B3): current plan + cycle, credit balance with cycle
 * progress, tier cards with Stripe Checkout, the customer portal link,
 * overage status, and the failed-payment banners (grace countdown →
 * read-only lockdown). Billing actions are owner-gated; state comes from
 * billing.summary (frozen contract) plus GET /api/stripe/billing-status.
 */

async function fetchBillingStatus(workspaceId: string): Promise<BillingStatus> {
  const res = await fetch(
    `/api/stripe/billing-status?workspaceId=${encodeURIComponent(workspaceId)}`,
  );
  if (!res.ok) throw new Error(`billing status ${String(res.status)}`);
  return (await res.json()) as BillingStatus;
}

export function BillingPanel() {
  const { workspaceId, workspace } = useWorkspace();
  const { toast } = useToast();

  const summaryQuery = trpc.billing.summary.useQuery(
    workspaceId !== null ? { workspaceId } : skipToken,
  );
  const statusQuery = useQuery({
    queryKey: ["billing-status", workspaceId],
    queryFn: workspaceId !== null ? () => fetchBillingStatus(workspaceId) : skipToken,
  });
  const checkoutMutation = trpc.billing.checkout.useMutation({
    onSuccess: ({ checkoutUrl }) => {
      window.location.assign(checkoutUrl);
    },
    onError: () => {
      toast("Could not open checkout — nothing was charged. Try again.");
    },
  });
  const portalMutation = trpc.billing.portal.useMutation({
    onSuccess: ({ portalUrl }) => {
      window.location.assign(portalUrl);
    },
    onError: () => {
      toast("Could not open the billing portal — try again in a moment.");
    },
  });

  if (workspaceId === null || summaryQuery.isLoading) return <LoadingState />;
  if (summaryQuery.isError || summaryQuery.data === undefined) {
    return (
      <ErrorState
        message="Couldn't load your billing summary — retry in a moment."
        onRetry={() => {
          void summaryQuery.refetch();
        }}
      />
    );
  }

  const { plan, creditBalance, billingCycleAnchor, ledger } = summaryQuery.data;
  const status = statusQuery.data;
  const exempt = isUiCreditExempt(workspace?.role, status?.creditExempt);
  const isOwner = workspace?.role === "owner";
  const ownerHint = isOwner ? undefined : "Only the workspace owner can manage billing";
  const tier = TIERS[plan];
  const cyclePct =
    tier.monthlyCredits > 0
      ? Math.max(0, Math.min(100, Math.round((creditBalance / tier.monthlyCredits) * 100)))
      : 0;

  const startCheckout = (target: PaidPlan) => {
    checkoutMutation.mutate({ workspaceId, plan: target });
  };

  return (
    <div className="space-y-6">
      {status?.readOnly === true ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          <IconWarning size={16} className="mt-0.5 shrink-0" />
          <div className="space-y-1.5">
            <p className="font-medium">This workspace is read-only.</p>
            <p>
              A payment failed over 7 days ago, so generating is paused. Your scripts and data are
              safe — update the payment method to pick up where you left off.
            </p>
            {isOwner ? (
              <Button
                size="sm"
                variant="primary"
                busy={portalMutation.isPending}
                onClick={() => {
                  portalMutation.mutate({ workspaceId });
                }}
              >
                <IconExternal size={12} /> Update payment method
              </Button>
            ) : (
              <p className="text-xs">Ask the workspace owner to update the payment method.</p>
            )}
          </div>
        </div>
      ) : status?.paymentFailedAt != null ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-900 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-200"
        >
          <IconWarning size={16} className="mt-0.5 shrink-0" />
          <p>
            Your last payment didn&apos;t go through. Everything keeps working
            {status.graceEndsAt !== null
              ? ` until ${fmtDate(new Date(status.graceEndsAt))}`
              : " for 7 days"}
            {" — after that the workspace becomes read-only. "}
            {isOwner
              ? "Update the payment method in the billing portal below."
              : "The workspace owner can fix this in the billing portal."}
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader title="Plan" />
          <CardBody className="space-y-3">
            <div className="flex items-baseline gap-2">
              <p className="text-2xl font-semibold">{tier.label}</p>
              {tier.priceUsdMonthly > 0 ? (
                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                  ${fmtNumber(tier.priceUsdMonthly)}/mo
                </span>
              ) : null}
            </div>
            {status?.pendingPlan != null && status.pendingPlan !== plan ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Changing to <span className="font-medium">{TIERS[status.pendingPlan].label}</span>{" "}
                at the next billing cycle
                {status.billingPeriodEnd !== null
                  ? ` (${fmtDate(new Date(status.billingPeriodEnd))})`
                  : ""}
                .
              </p>
            ) : null}
            {billingCycleAnchor !== null ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Current cycle started {fmtDate(billingCycleAnchor)}
                {status?.billingPeriodEnd != null
                  ? ` — renews ${fmtDate(new Date(status.billingPeriodEnd))}`
                  : " — credits reset monthly"}
                .
              </p>
            ) : (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Free plans include 8 credits to try everything — upgrades start a monthly cycle.
              </p>
            )}
            {plan !== "free" ? (
              <Button
                size="sm"
                disabled={!isOwner}
                busy={portalMutation.isPending}
                title={ownerHint}
                onClick={() => {
                  portalMutation.mutate({ workspaceId });
                }}
              >
                <IconExternal size={12} /> Manage billing in Stripe
              </Button>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Credits"
            subtitle={
              exempt
                ? "This account is not billed for generation."
                : "A full script costs 6; a revision pass 2."
            }
          />
          <CardBody className="space-y-3">
            <div>
              <p className="text-4xl font-semibold tracking-tight">
                {exempt ? "Unlimited" : fmtNumber(creditBalance)}
              </p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {exempt
                  ? "Credit balance checks and debits are skipped."
                  : `of ${fmtNumber(tier.monthlyCredits)} this cycle`}
              </p>
            </div>
            {exempt ? null : (
              <>
                <div
                  role="progressbar"
                  aria-valuenow={cyclePct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Credits remaining this cycle"
                  className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
                >
                  <div
                    className="h-full rounded-full bg-emerald-600 transition-all dark:bg-emerald-500"
                    style={{ width: `${String(cyclePct)}%` }}
                  />
                </div>
                {status?.overageEnabled === true ? (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {status.overageUsed > 0 ? (
                      <>
                        <span className="font-medium text-zinc-700 dark:text-zinc-300">
                          {fmtNumber(status.overageUsed)}
                        </span>{" "}
                        of {fmtNumber(status.overageCeiling)} overage credits used this cycle at $
                        {status.overageUnitUsd.toFixed(2)} each.
                      </>
                    ) : (
                      <>
                        If you run out, up to {fmtNumber(status.overageCeiling)} overage credits at
                        ${status.overageUnitUsd.toFixed(2)} each keep you generating.
                      </>
                    )}
                  </p>
                ) : null}
              </>
            )}
          </CardBody>
        </Card>
      </div>

      {exempt ? null : (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            {plan === "free" ? "Pick a plan" : "Change plan"}
          </h3>
          <div className="grid gap-4 sm:grid-cols-3">
            {PAID_PLANS.map((paidPlan) => {
              const t = TIERS[paidPlan];
              const isCurrent = paidPlan === plan;
              const isUpgrade = PLAN_RANK[paidPlan] > PLAN_RANK[plan];
              return (
                <Card key={paidPlan}>
                  <CardBody className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold">{t.label}</p>
                      {isCurrent ? <Badge tone="emerald">Current</Badge> : null}
                    </div>
                    <p>
                      <span className="text-2xl font-semibold tracking-tight">
                        ${fmtNumber(t.priceUsdMonthly)}
                      </span>
                      <span className="text-sm text-zinc-500 dark:text-zinc-400">/mo</span>
                    </p>
                    <ul className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                      <li>{fmtNumber(t.monthlyCredits)} credits / month</li>
                      <li>
                        {t.channelLimit === null
                          ? "Unlimited channels"
                          : `${String(t.channelLimit)} channel${t.channelLimit === 1 ? "" : "s"}`}
                      </li>
                      <li>
                        {String(t.seatLimit)} seat{t.seatLimit === 1 ? "" : "s"}
                      </li>
                    </ul>
                    {isCurrent ? null : (
                      <Button
                        size="sm"
                        variant={isUpgrade ? "primary" : "secondary"}
                        disabled={!isOwner}
                        busy={
                          checkoutMutation.isPending && checkoutMutation.variables.plan === t.plan
                        }
                        title={ownerHint}
                        onClick={() => {
                          startCheckout(paidPlan);
                        }}
                      >
                        <IconExternal size={12} /> {isUpgrade ? `Upgrade to ${t.label}` : "Switch"}
                      </Button>
                    )}
                  </CardBody>
                </Card>
              );
            })}
          </div>
          {plan !== "free" ? (
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              Downgrades take effect at the next billing cycle; upgrades start a new cycle right
              away.
            </p>
          ) : null}
        </div>
      )}

      <Card>
        <CardHeader title="Recent credit activity" />
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
          {ledger.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
              No credit activity yet — charges and grants appear here as you generate.
            </li>
          ) : (
            ledger.map((entry) => (
              <li key={entry.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <Badge tone={entry.delta >= 0 ? "green" : "neutral"}>
                  {entry.delta >= 0 ? `+${String(entry.delta)}` : entry.delta}
                </Badge>
                <span className="flex-1 text-zinc-700 dark:text-zinc-300">
                  {entry.reason.replace(/_/g, " ")}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {fmtDateTime(entry.createdAt)}
                </span>
              </li>
            ))
          )}
        </ul>
      </Card>
    </div>
  );
}
