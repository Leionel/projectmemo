import Image from "next/image";
import Link from "next/link";

/** Shared brand typography and optical size for public pages and the workspace. */
export function BrandLink({ descriptor = false }: { descriptor?: boolean }) {
  return (
    <Link
      href="/"
      aria-label="忆程 ProjectMemo 首页"
      className="app-brand focus-ring"
    >
      <Image src="/logo.png" alt="" width={28} height={28} priority unoptimized/>
      <span className="app-brand-name">
        忆程<span className="app-brand-english"> ProjectMemo</span>
      </span>
      {descriptor && <span className="app-brand-descriptor">MEMORY AGENT</span>}
    </Link>
  );
}
