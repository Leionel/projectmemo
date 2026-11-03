import type { Metadata } from "next";
import { PrototypeAnchor, PrototypeHeroA } from "@/components/home/PrototypeHeroA";
import styles from "@/components/home/prototype.module.css";

export const metadata: Metadata = {
  title: "B1 原型 A｜原委托四问工作包",
  robots: { index: false, follow: false },
};

export default function PrototypeHeroAPage() {
  return (
    <main id="main-content" className={styles.protoShell}>
      <p className={styles.protoBadge}>
        B1 隔离原型 A · 仅本地对照 · 不进入生产导航
      </p>
      <PrototypeHeroA />
      <PrototypeAnchor variant="a" />
    </main>
  );
}
