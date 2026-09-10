import type { Metadata } from "next";
import { Suspense } from "react";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { AppProviders } from "@/components/providers/app-providers";

export const metadata: Metadata = { title: "Get started" };

export default function OnboardingPage() {
  return (
    <AppProviders>
      <Suspense>
        <OnboardingFlow />
      </Suspense>
    </AppProviders>
  );
}
