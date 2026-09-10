"use client";

import { skipToken } from "@tanstack/react-query";
import { trpc } from "@/components/providers/trpc";
import { useWorkspace } from "@/components/providers/workspace-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { IconExternal } from "@/components/ui/icons";
import { ErrorState, LoadingState } from "@/components/ui/state";
import { fmtDate, fmtDateTime, fmtNumber } from "@/components/lib/format";

/** Read-only billing status + credits, with Stripe Checkout for Starter. */
export function BillingPanel() {
  const { workspaceId, workspace } = useWorkspace();

  const summaryQuery = trpc.billing.summary.useQuery(
    workspaceId !== null ? { workspaceId } : skipToken,
  );
  const checkoutMutation = trpc.billing.checkout.useMutation({
    onSuccess: ({ checkoutUrl }) => {
      window.location.assign(checkoutUrl);
    },
  });

  if (workspaceId === null || summaryQuery.isLoading) return <LoadingState />;
  if (summaryQuery.isError || summaryQuery.data === undefined) {
    return (
      <ErrorState
        onRetry={() => {
          void summaryQuery.refetch();
        }}
      />
    );
  }

  const { plan, creditBalance, billingCycleAnchor, ledger } = summaryQuery.data;
  const isOwner = workspace?.role === "owner";

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader title="Plan" />
          <CardBody className="space-y-3">
            <p className="text-2xl font-semibold capitalize">{plan}</p>
            {billingCycleAnchor !== null ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Cycle anchored {fmtDate(billingCycleAnchor)} — credits reset monthly.
              </p>
            ) : null}
            {plan === "free" ? (
              <Button
                variant="primary"
                disabled={!isOwner}
                busy={checkoutMutation.isPending}
                title={isOwner ? undefined : "Only the workspace owner can manage billing"}
                onClick={() => {
                  checkoutMutation.mutate({ workspaceId, plan: "starter" });
                }}
              >
                <IconExternal size={13} /> Upgrade to Starter — $49/mo
              </Button>
            ) : (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Plan changes and invoices are handled by support during alpha.
              </p>
            )}
            {checkoutMutation.isError ? (
              <p className="text-xs text-red-600 dark:text-red-400">
                Could not open checkout — try again.
              </p>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Credits" subtitle="A full script costs 6; a revision pass 2." />
          <CardBody>
            <p className="text-4xl font-semibold tracking-tight">{fmtNumber(creditBalance)}</p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">available this cycle</p>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Recent credit activity" />
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
          {ledger.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-zinc-400">No activity yet.</li>
          ) : (
            ledger.map((entry) => (
              <li key={entry.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <Badge tone={entry.delta >= 0 ? "green" : "neutral"}>
                  {entry.delta >= 0 ? `+${entry.delta}` : entry.delta}
                </Badge>
                <span className="flex-1 text-zinc-700 dark:text-zinc-300">
                  {entry.reason.replace(/_/g, " ")}
                </span>
                <span className="text-xs text-zinc-400">{fmtDateTime(entry.createdAt)}</span>
              </li>
            ))
          )}
        </ul>
      </Card>
    </div>
  );
}
