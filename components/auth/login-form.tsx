"use client";

import Link from "next/link";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { TextInput, Label } from "@/components/ui/field";
import { IconGoogle, IconMail } from "@/components/ui/icons";

export function LoginForm({ fixtureMode }: { fixtureMode: boolean }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMagicLink = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await signIn("email", { email, callbackUrl: "/projects", redirect: false });
      if (typeof res.error === "string" && res.error !== "") {
        setError("Could not send the sign-in link. Check the address and try again.");
      } else {
        setSent(true);
      }
    } catch {
      setError(
        fixtureMode
          ? "Email sign-in is inactive in this environment — use the demo entrance below."
          : "Could not send the sign-in link. Try again in a moment.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        New here? Signing in creates your account.
      </p>

      <button
        type="button"
        onClick={() => {
          void signIn("google", { callbackUrl: "/projects" });
        }}
        className="mt-6 flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
      >
        <IconGoogle size={16} className="text-zinc-700 dark:text-zinc-300" />
        Continue with Google
      </button>

      <div className="my-5 flex items-center gap-3 text-[11px] tracking-wide text-zinc-400 uppercase">
        <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
        or
        <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
      </div>

      {sent ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          <p className="font-medium">Check your inbox</p>
          <p className="mt-1">
            We sent a sign-in link to <strong>{email}</strong>. It expires in 24 hours.
          </p>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendMagicLink();
          }}
        >
          <Label htmlFor="login-email">Email address</Label>
          <TextInput
            id="login-email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@channel.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
          />
          <Button type="submit" variant="primary" busy={busy} className="mt-3 w-full">
            <IconMail size={14} />
            Email me a sign-in link
          </Button>
        </form>
      )}

      {error !== null ? (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : null}

      {fixtureMode ? (
        <div className="mt-6 rounded-md border border-dashed border-zinc-300 p-3 text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          <p className="font-medium text-zinc-600 dark:text-zinc-300">Development environment</p>
          <p className="mt-1">
            Auth providers are not configured. You can{" "}
            <Link href="/projects" className="font-medium text-emerald-700 underline dark:text-emerald-400">
              enter the app on fixture data
            </Link>{" "}
            without signing in.
          </p>
        </div>
      ) : null}

      <p className="mt-8 text-xs text-zinc-400 dark:text-zinc-500">
        By continuing you agree to our{" "}
        <Link href="/terms" className="underline">
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="underline">
          Privacy Policy
        </Link>
        .
      </p>
    </div>
  );
}
