import Link from "next/link";
import { PRODUCT_NAME } from "@/lib/branding";

const steps = [
  {
    n: "01",
    title: "Feed it your channel",
    body: "Connect with one click or paste a channel URL. We read your catalog and build an editable picture of who actually watches you.",
  },
  {
    n: "02",
    title: "Research with receipts",
    body: "Pull web sources, competitor transcripts, and your own notes into one brief — every fact keeps its citation all the way into the script.",
  },
  {
    n: "03",
    title: "Frame the video",
    body: "Four distinct angles for every idea. Pick one, tune the format, tone, and runtime, and lock the plan before a word is written.",
  },
  {
    n: "04",
    title: "Watch the script assemble",
    body: "A seven-stage writing engine drafts section by section, live — hooks, retention beats, your voice, and a fact-check pass at the end.",
  },
];

const features = [
  {
    title: "Three hooks, tagged by tactic",
    body: "Open loop, bold claim, stakes, in-medias-res — pick the opener that fits, keep the runners-up one click away.",
  },
  {
    title: "Section-level control",
    body: "Regenerate one section with a steering note. Lock the parts you love. Expand or condense without touching the rest.",
  },
  {
    title: "Line-level revision passes",
    body: "Suggested edits arrive as red/green diffs with a rationale. Accept or reject each one individually.",
  },
  {
    title: "Claims you can defend",
    body: "Every factual claim links back to a research source. Anything unsupported is highlighted before you record.",
  },
  {
    title: "Retention-aware structure",
    body: "Re-hooks every 60–90 seconds, open loops that actually close, and payoffs placed where viewers drift.",
  },
  {
    title: "Packaging in the same breath",
    body: "25 scored titles, three description styles, tags, and chapters — generated from the finished script, not from scratch.",
  },
];

const tiers = [
  { name: "Free", price: "$0", detail: "8 credits to try the full loop", items: ["1 channel", "1 seat", "Every pipeline stage"] },
  { name: "Starter", price: "$49", detail: "per month · 60 credits", items: ["3 channels", "2 seats", "~10 full scripts / mo"], featured: true },
  { name: "Team", price: "$99", detail: "per month · 200 credits", items: ["10 channels", "5 seats", "Priority generation"] },
  { name: "Agency", price: "$249", detail: "per month · 600 credits", items: ["Unlimited channels", "15 seats", "Client workspaces"] },
];

export default function LandingPage() {
  return (
    <div>
      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 pt-20 pb-16 sm:pt-28">
        <p className="text-sm font-medium tracking-wide text-emerald-700 uppercase dark:text-emerald-400">
          AI scriptwriting for YouTube
        </p>
        <h1 className="mt-3 max-w-3xl font-(family-name:--font-display) text-4xl leading-tight font-semibold tracking-tight sm:text-6xl">
          Scripts your audience actually finishes.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-zinc-600 dark:text-zinc-400">
          {PRODUCT_NAME} turns an idea into a fact-checked, retention-engineered script in your
          voice — researched, framed, drafted, and packaged in minutes, with you in control of
          every section.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link
            href="/login"
            className="rounded-md bg-emerald-700 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          >
            Write your first script free
          </Link>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            8 free credits · no card required
          </span>
        </div>
      </section>

      {/* How it works */}
      <section className="border-y border-zinc-200 bg-white py-16 dark:border-zinc-800 dark:bg-zinc-900/40">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="font-(family-name:--font-display) text-2xl font-semibold sm:text-3xl">
            Idea to record-ready, one pipeline
          </h2>
          <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s) => (
              <div key={s.n}>
                <span className="font-mono text-xs text-emerald-700 dark:text-emerald-400">{s.n}</span>
                <h3 className="mt-1 text-sm font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="font-(family-name:--font-display) text-2xl font-semibold sm:text-3xl">
          An editor built for talking, not typing
        </h2>
        <div className="mt-8 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title}>
              <h3 className="text-sm font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="border-t border-zinc-200 bg-white py-16 dark:border-zinc-800 dark:bg-zinc-900/40">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="font-(family-name:--font-display) text-2xl font-semibold sm:text-3xl">Pricing</h2>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            One credit system across everything: a full script is 6 credits, a revision pass is 2.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {tiers.map((t) => (
              <div
                key={t.name}
                className={`rounded-lg border p-5 ${
                  t.featured === true
                    ? "border-emerald-600 ring-1 ring-emerald-600 dark:border-emerald-500 dark:ring-emerald-500"
                    : "border-zinc-200 dark:border-zinc-800"
                }`}
              >
                <h3 className="text-sm font-semibold">{t.name}</h3>
                <p className="mt-2 text-3xl font-semibold tracking-tight">{t.price}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{t.detail}</p>
                <ul className="mt-4 space-y-1.5 text-sm text-zinc-600 dark:text-zinc-400">
                  {t.items.map((item) => (
                    <li key={item} className="flex items-center gap-2">
                      <span className="h-1 w-1 rounded-full bg-emerald-600 dark:bg-emerald-500" />
                      {item}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/login"
                  className={`mt-5 block rounded-md py-2 text-center text-sm font-medium ${
                    t.featured === true
                      ? "bg-emerald-700 text-white hover:bg-emerald-600 dark:bg-emerald-600"
                      : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  }`}
                >
                  Get started
                </Link>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-zinc-400 dark:text-zinc-500">
            Alpha pricing — plans and limits may change before public launch.
          </p>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="mx-auto max-w-5xl px-6 py-20 text-center">
        <h2 className="font-(family-name:--font-display) text-3xl font-semibold">
          Your next video, scripted this afternoon.
        </h2>
        <Link
          href="/login"
          className="mt-6 inline-block rounded-md bg-emerald-700 px-6 py-3 text-sm font-semibold text-white hover:bg-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-500"
        >
          Start free
        </Link>
      </section>
    </div>
  );
}
