import Link from "next/link";
import { PRODUCT_NAME } from "@/lib/branding";
import { APP_HOME } from "@/components/shell/nav";
import { getConfig } from "@/lib/config";

/** The eight things the product does — names first, one short line each. */
export const CORE_FEATURES = [
  { name: "Coach", line: "Chat script coach" },
  { name: "Intel", line: "Your YouTube channel stats" },
  { name: "Ideas", line: "Concepts for your niche" },
  { name: "Scripts", line: "Outline → hooks → draft" },
  { name: "Styles", line: "Train or pick a voice" },
  { name: "Packaging", line: "Titles, description, tags" },
  { name: "Thumbnail Studio", line: "Real YouTube thumbnails" },
  { name: "Channels", line: "Connect & switch channels" },
] as const;

export default function LandingPage() {
  const fixtureMode = getConfig().PROVIDERS === "fixture";
  const enterHref = fixtureMode ? APP_HOME : "/login";
  return (
    <div className="mx-auto max-w-4xl px-6">
      <section className="pt-24 pb-14 sm:pt-32" data-testid="marketing-hero">
        <h1 className="font-display text-4xl font-semibold tracking-tight text-zinc-900 sm:text-6xl">
          {PRODUCT_NAME}
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-zinc-600">
          Your YouTube script and packaging coach — from idea to thumbnail, in your voice.
        </p>
        <Link
          href={enterHref}
          className="mt-8 inline-block rounded-md bg-accent-600 px-5 py-3 text-sm font-semibold text-white hover:bg-accent-500"
        >
          {fixtureMode ? "Enter the app" : "Sign in"}
        </Link>
      </section>

      <section className="border-t border-zinc-200 py-14" data-testid="marketing-features">
        <ul className="grid gap-x-10 gap-y-6 sm:grid-cols-2" aria-label="Core features">
          {CORE_FEATURES.map((f) => (
            <li key={f.name} className="flex items-baseline gap-3">
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-[3px] bg-accent-500" />
              <span>
                <span className="font-semibold text-zinc-900">{f.name}</span>
                <span className="text-zinc-500"> — {f.line}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
