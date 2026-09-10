import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppProviders } from "@/components/providers/app-providers";
import { AppShell } from "@/components/shell/app-shell";
import { auth } from "@/server/auth";
import { getConfig } from "@/lib/config";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  // Fixture mode has no sign-in path; the app runs as the fixture user.
  if (session === null && getConfig().PROVIDERS !== "fixture") {
    redirect("/login");
  }
  return (
    <AppProviders>
      <AppShell>{children}</AppShell>
    </AppProviders>
  );
}
