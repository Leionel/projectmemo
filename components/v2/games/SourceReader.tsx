"use client";
import { BookOpen, X } from "lucide-react";
import { SourceProvenance } from "@/components/SourceProvenance";
import { evidenceTime, sourceDisplayName } from "@/lib/client/sourceDisplay";
import { highlightSegments, locateExcerpt } from "@/lib/challenges/presentation";
import type { WorkbenchSource } from "@/lib/types/workbench";
import styles from "./SourceReader.module.css";

export function SourceReader({ source, excerpt, onClose, referencedAt }: {
  source: WorkbenchSource; excerpt: string; onClose?: () => void; referencedAt?: string;
}) {
  const range = locateExcerpt(source.text, excerpt);
  const segments = highlightSegments(source.text, range);
  return <aside className={styles.reader} aria-label="原文阅读">
    <header className={styles.head}><span><BookOpen size={15} aria-hidden />原文阅读</span>
      {onClose && <button type="button" onClick={onClose} aria-label="收起原文阅读"><X size={15} aria-hidden />收起</button>}</header>
    <SourceProvenance name={sourceDisplayName(source.id, source.name)} observedAt={source.observedAt} current={source.current}
      referencedAt={referencedAt} technical={[{ label: "来源标识", value: source.id }, { label: "修订标识", value: source.revision },
        ...(source.revision !== source.hash ? [{ label: "内容校验", value: source.hash }] : [])]} />
    <div className={styles.body}>
      <p className={styles.locate} data-found={!!range}>{range ? "已定位到与稿件最接近的段落" : "没有找到逐字相同的段落，以下是来源全文"}</p>
      <blockquote className={styles.text}>{segments.map((segment, index) => segment.marked
        ? <mark key={index} className={styles.mark}>{segment.text}</mark>
        : <span key={index}>{segment.text}</span>)}</blockquote>
      {!source.text.trim() && <p className={styles.empty}>这条来源没有可读正文，请回到原记录核对。</p>}
    </div>
    <p className={styles.note}>原文阅读用于定位出处，不代替事实验证；时间以记录时间为准。</p>
  </aside>;
}

export function sourceCardTime(value?: string | null) {
  return value && Number.isFinite(Date.parse(value)) ? evidenceTime(value) : "时间未记录";
}
