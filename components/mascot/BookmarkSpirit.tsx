"use client";
/* eslint-disable @next/next/no-img-element -- 透明 PNG 来自本地白名单，尺寸固定且不做远端优化；next/image 会额外引入优化器与布局包装。 */
import { useEffect, useId, useRef, useState } from "react";
import { BOOKMARK_SPIRIT_ASSETS, BOOKMARK_SPIRIT_POSES, spiritAsset, type BookmarkSpiritPose } from "@/lib/mascot/bookmarkSpirit";
import styles from "./BookmarkSpirit.module.css";

type Props = {
  pose?: BookmarkSpiritPose;
  /** 固定占位尺寸（CSS 像素）。切换姿态不改变布局。 */
  size?: number;
  /** 安静模式：不呼吸、不点头、不响应提示点击。 */
  quiet?: boolean;
  /** 与当前任务相关的一句话提示；只在点击角色后展开。 */
  hint?: string;
  /** 角色在页面中的可访问名称；纯装饰时省略。 */
  label?: string;
  className?: string;
};

const PRELOAD_DELAY = 1800;

export function BookmarkSpirit({ pose = "idle", size = 184, quiet = false, hint, label, className }: Props) {
  const asset = spiritAsset(pose);
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  const shell = useRef<HTMLSpanElement>(null);

  // 先显示当前姿态，再在空闲时预取其余网页尺寸；不一次加载 1024 母版。
  useEffect(() => {
    if (typeof window === "undefined") return;
    const timer = window.setTimeout(() => {
      for (const name of BOOKMARK_SPIRIT_POSES) {
        if (name === pose) continue;
        const image = new Image();
        image.src = BOOKMARK_SPIRIT_ASSETS[name].web;
      }
    }, PRELOAD_DELAY);
    return () => window.clearTimeout(timer);
  }, [pose]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);

  const decorative = !hint;
  const caption = label ?? (decorative ? undefined : "书签精灵");

  return <span ref={shell} className={[styles.shell, quiet ? styles.quiet : "", className].filter(Boolean).join(" ")}
    style={{ width: size, height: size }} data-pose={pose}>
    {hint ? <button type="button" className={styles.trigger} aria-label={(caption ?? "书签精灵") + "：查看本轮提示"}
      aria-expanded={open} aria-controls={open ? tooltipId : undefined} onClick={() => setOpen(value => !value)}>
      <img src={asset.web} width={asset.width} height={asset.height} alt="" className={styles.image} draggable={false}
        decoding="async" data-testid={"bookmark-spirit-" + pose} data-asset={asset.web} />
    </button> : <img src={asset.web} width={asset.width} height={asset.height} alt={caption ?? ""} className={styles.image}
      decoding="async" loading={pose === "idle" ? "eager" : "lazy"} draggable={false} data-testid={"bookmark-spirit-" + pose}
      data-asset={asset.web} aria-hidden={decorative || undefined} />}
    {hint && open && <span role="note" id={tooltipId} className={styles.hint}>
      <span className={styles.hintTitle}>书签精灵</span>{hint}
      <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="收起提示">收起</button>
    </span>}
  </span>;
}

/** 小头像入口：只用于角色提示，不替换产品 Logo。 */
export function BookmarkSpiritAvatar({ size = 40, label = "书签精灵" }: { size?: number; label?: string }) {
  const asset = BOOKMARK_SPIRIT_ASSETS.avatar;
  return <img src={asset.web} width={size} height={size} alt={label} className={styles.avatar} style={{ width: size, height: size }} />;
}
