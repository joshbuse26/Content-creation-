import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";
import { getConfig } from "@/lib/config";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  const fixtureMode = getConfig().PROVIDERS === "fixture";
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6 py-16">
      <LoginForm fixtureMode={fixtureMode} />
    </div>
  );
}
