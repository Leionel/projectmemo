import type { ReactNode } from "react";

/** Workspace page title: serif heading with one quiet line; the eyebrow stays for callers but the layout no longer repeats it. */
export function PageHeading({ title, description, actions }: { eyebrow?: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions}</div>;
}
