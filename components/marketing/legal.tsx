import type { ReactNode } from "react";

export function LegalPage({
  title,
  effective,
  children,
}: {
  title: string;
  effective: string;
  children: ReactNode;
}) {
  return (
    <article className="mx-auto max-w-3xl px-6 py-14">
      <h1 className="font-(family-name:--font-display) text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Effective date: {effective}</p>
      <div className="mt-8 space-y-8">{children}</div>
    </article>
  );
}

export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold">{heading}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
        {children}
      </div>
    </section>
  );
}

export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
