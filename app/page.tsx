import { PRODUCT_NAME } from "@/lib/branding";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 px-6">
      <h1 className="text-4xl font-bold tracking-tight">{PRODUCT_NAME}</h1>
      <p className="text-center text-zinc-600">
        AI scriptwriting for YouTube creators. Research, frame, script, revise, and package —
        end-to-end.
      </p>
      <p className="rounded-md bg-zinc-100 px-3 py-1 font-mono text-sm text-zinc-500">
        Day-1 skeleton — wave 2 builds here
      </p>
    </main>
  );
}
