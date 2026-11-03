import type { Metadata } from "next";
import { PrototypeHeroB } from "@/components/home/PrototypeHeroB";
import { PrototypeAnchor } from "@/components/home/PrototypeHeroA";
import styles from "@/components/home/prototype.module.css";

export const metadata: Metadata = {
  title: "B1 原型 B｜来源变化因果镜头",
  robots: { index: false, follow: false },
};

export default function PrototypeHeroBPage() {
  return (
    <main id="main-content" className={styles.protoShell}>
      <p className={styles.protoBadge}>
        B1 隔离原型 B · 仅本地对照 · 不进入生产导航
      </p>
      <PrototypeHeroB />
      <PrototypeAnchor variant="b" />
    </main>
  );
}
