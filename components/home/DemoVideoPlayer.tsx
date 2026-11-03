"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Play, X } from "lucide-react";
import styles from "@/app/home.module.css";

const VIDEO_WATCH_URL =
  "https://www.bilibili.com/video/BV1Qaxb6PE7G?vd_source=eaf1b5590706fdf5d967f5f1d697db8b";
const VIDEO_EMBED_URL =
  "https://player.bilibili.com/player.html?bvid=BV1Qaxb6PE7G&page=1&high_quality=1&danmaku=0&autoplay=1";

/**
 * 决赛演示：默认只显示本地门面，不请求任何外部域名；
 * 用户点击后才加载 Bilibili 官方播放器 iframe，并提供收起（卸载 iframe）与在新窗口打开的退路。
 */
export function DemoVideoPlayer() {
  const [active, setActive] = useState(false);
  const facadeRef = useRef<HTMLButtonElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const pendingFacadeFocus = useRef(false);

  useEffect(() => {
    if (active || !pendingFacadeFocus.current) return;
    pendingFacadeFocus.current = false;
    facadeRef.current?.focus();
  }, [active]);

  // 播放器是跨域 iframe：按钮卸载后焦点会落回 body，这里在 iframe 挂载并加载后把焦点送进播放器框架。
  useEffect(() => {
    if (!active) return;
    const timers = [180, 900, 1800].map((delay) =>
      window.setTimeout(() => {
        iframeRef.current?.focus({ preventScroll: true });
      }, delay),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [active]);

  return (
    <div className={styles.videoPlayer}>
      <div className={styles.videoStage} data-active={active}>
        {active ? (
          <iframe
            ref={iframeRef}
            className={styles.videoIframe}
            src={VIDEO_EMBED_URL}
            title="2026 C4-AI 决赛演示视频（Bilibili 官方播放器）"
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
            allowFullScreen
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            onLoad={(event) => event.currentTarget.focus()}
          />
        ) : (
          <button
            ref={facadeRef}
            type="button"
            className={styles.videoFacade}
            onClick={() => setActive(true)}
            aria-label="在本页加载 2026 C4-AI 决赛演示视频的 Bilibili 官方播放器"
          >
            <span className={styles.videoFacadeCorner} aria-hidden="true">
              公开视频 · Bilibili
            </span>
            <span className={styles.videoFacadePlay} aria-hidden="true">
              <Play size={22} fill="currentColor" />
            </span>
            <span className={styles.videoFacadeTitle}>
              2026 C4-AI 决赛演示视频
            </span>
            <span className={styles.videoFacadeMeta}>
              点击加载播放器 · 在播放器内播放
            </span>
          </button>
        )}
      </div>
      <div className={styles.videoBelow}>
        <p>
          视频托管在 Bilibili；点击后在本页加载其官方播放器，加载前不请求外部站点。
        </p>
        <div className={styles.videoBelowLinks}>
          {active ? (
            <button
              type="button"
              className={styles.videoOpenLink}
              onClick={() => {
                pendingFacadeFocus.current = true;
                setActive(false);
              }}
            >
              <X size={12} aria-hidden="true" />
              收起播放器
            </button>
          ) : null}
          <a
            className={styles.videoOpenLink}
            href={VIDEO_WATCH_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="在 Bilibili 打开 2026 C4-AI 决赛演示视频（新窗口）"
          >
            在 Bilibili 打开（新窗口）
            <ExternalLink size={12} aria-hidden="true" />
          </a>
        </div>
      </div>
    </div>
  );
}
