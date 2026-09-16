"use client";

import { useState } from "react";
import Link from "next/link";
import { PRODUCT_NAME } from "@/lib/branding";
import type { FreeToolResult } from "@/server/tools/definitions";
import { isPlausibleEmail, isUnlocked, recordUse, readUses, shouldGate, unlock } from "./gate";
import type { ToolDef } from "./tool-defs";

/**
 * Shared client page for the free standalone tools: form → result → copy →
 * sign-up CTA. Third use asks for an email (client-side honor gate; the
 * server independently caps at 5 uses/day per IP).
 */
export function ToolPage({ def }: { def: ToolDef }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FreeToolResult | null>(null);
  const [gateOpen, setGateOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [copied, setCopied] = useState(false);

  const filled = def.fields.every((f) => !f.required || (values[f.name] ?? "").trim() !== "");

  const run = async () => {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const body: Record<string, string> = { tool: def.id };
      for (const f of def.fields) {
        const v = (values[f.name] ?? "").trim();
        if (v !== "") body[f.name] = v;
      }
      const res = await fetch("/api/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 429) {
        setError(
          `That's the free limit for today (5 runs). Sign up for ${PRODUCT_NAME} — the full studio starts with 8 free credits.`,
        );
        return;
      }
      if (!res.ok) {
        setError("Something went wrong generating that — try again in a moment.");
        return;
      }
      const data = (await res.json()) as FreeToolResult;
      recordUse();
      setResult(data);
    } catch {
      setError("Something went wrong generating that — try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = () => {
    if (!filled || busy) return;
    if (shouldGate(readUses(), isUnlocked())) {
      setGateOpen(true);
      return;
    }
    void run();
  };

  const copyText = result === null ? "" : (result.items?.join(def.copyJoin) ?? result.text ?? "");

  return (
    <div className="mx-auto max-w-2xl px-6 py-14">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent-700 dark:text-accent-500">
        Free tool
      </p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight">{def.name}</h1>
      <p className="mt-3 text-zinc-600 dark:text-zinc-400">{def.lead}</p>

      <form
        className="mt-8 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        {def.fields.map((f) => (
          <div key={f.name}>
            <label
              htmlFor={`tool-${f.name}`}
              className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              {f.label}
            </label>
            {f.kind === "textarea" ? (
              <textarea
                id={`tool-${f.name}`}
                className="min-h-28 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-accent-600 focus:outline-none focus:ring-1 focus:ring-accent-600 dark:border-zinc-700 dark:bg-zinc-950"
                maxLength={f.maxLength}
                value={values[f.name] ?? ""}
                onChange={(e) => {
                  setValues((v) => ({ ...v, [f.name]: e.target.value }));
                }}
                placeholder={f.placeholder}
              />
            ) : (
              <input
                id={`tool-${f.name}`}
                type="text"
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-accent-600 focus:outline-none focus:ring-1 focus:ring-accent-600 dark:border-zinc-700 dark:bg-zinc-950"
                maxLength={f.maxLength}
                value={values[f.name] ?? ""}
                onChange={(e) => {
                  setValues((v) => ({ ...v, [f.name]: e.target.value }));
                }}
                placeholder={f.placeholder}
              />
            )}
          </div>
        ))}

        {gateOpen ? (
          <div className="space-y-3 rounded-md border border-accent-200 bg-accent-50 p-4 dark:border-accent-900 dark:bg-accent-950/40">
            <p className="text-sm text-accent-900 dark:text-accent-200">
              You&rsquo;ve used your two quick tries — drop your email to keep going free (5 runs a
              day).
            </p>
            <div className="flex gap-2">
              <input
                type="email"
                aria-label="Email address"
                className="w-full rounded-md border border-accent-300 bg-white px-3 py-2 text-sm focus:border-accent-600 focus:outline-none focus:ring-1 focus:ring-accent-600 dark:border-accent-800 dark:bg-zinc-950"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                }}
              />
              <button
                type="button"
                className="shrink-0 rounded-md bg-accent-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50 dark:bg-accent-600 dark:hover:bg-accent-500"
                disabled={!isPlausibleEmail(email)}
                onClick={() => {
                  unlock();
                  setGateOpen(false);
                  void run();
                }}
              >
                Continue
              </button>
            </div>
          </div>
        ) : (
          <button
            type="submit"
            className="rounded-md bg-accent-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50 dark:bg-accent-600 dark:hover:bg-accent-500"
            disabled={!filled || busy}
          >
            {busy ? "Working…" : def.submitLabel}
          </button>
        )}
      </form>

      {error !== null ? (
        <p
          role="alert"
          className="mt-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        >
          {error}
        </p>
      ) : null}

      {result !== null ? (
        <section className="mt-8">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {def.resultHeading}
            </h2>
            <button
              type="button"
              className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              onClick={() => {
                void navigator.clipboard
                  .writeText(copyText)
                  .then(() => {
                    setCopied(true);
                  })
                  .catch(() => undefined);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            {result.items !== null ? (
              <ul className="space-y-2 text-sm">
                {result.items.map((item) => (
                  <li key={item} className="text-zinc-800 dark:text-zinc-200">
                    {item}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="whitespace-pre-line text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
                {result.text}
              </p>
            )}
          </div>

          <div className="mt-8 rounded-lg border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="font-medium">Like this? The full studio does the whole video.</p>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {PRODUCT_NAME} researches with citations, drafts a retention-aware script in your
              voice, and packages titles, thumbnails, tags and chapters — start free with 8 credits.
            </p>
            <Link
              href="/login"
              className="mt-3 inline-block rounded-md bg-accent-700 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 dark:bg-accent-600 dark:hover:bg-accent-500"
            >
              Start writing free
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}
