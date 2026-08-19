export default function Loading() {
  return <main id="main-content" className="shell py-12" aria-busy="true" aria-label="页面正在加载">
    <div className="h-4 w-28 animate-pulse rounded bg-[var(--rule-strong)]" />
    <div className="mt-8 h-10 w-full max-w-xl animate-pulse rounded-xl bg-[var(--rule)]" />
    <div className="mt-4 h-5 w-full max-w-2xl animate-pulse rounded bg-[var(--rule)]" />
    <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((item) => <div key={item} className="card-surface h-52 animate-pulse rounded-[1.5rem]" />)}</div>
    <span className="sr-only">正在加载忆程 ProjectMemo…</span>
  </main>;
}
