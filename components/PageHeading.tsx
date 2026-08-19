import type { ReactNode } from "react";

export function PageHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="flex flex-col justify-between gap-5 border-b archive-rule pb-7 sm:flex-row sm:items-end"><div><p className="archive-label">{eyebrow}</p><h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">{title}</h1><p className="mt-3 max-w-2xl leading-7 text-[var(--ink-soft)]">{description}</p></div>{actions}</div>;
}
