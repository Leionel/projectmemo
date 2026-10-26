import type { ReactNode } from "react";

export function PageHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="flex flex-col justify-between gap-4 border-b archive-rule pb-5 sm:flex-row sm:items-end"><div><p className="archive-label">{eyebrow}</p><h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-soft)]">{description}</p></div>{actions}</div>;
}
