"use client";

import { useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  FileText,
  TriangleAlert,
} from "lucide-react";
import { exampleProject } from "./homeExample";
import styles from "@/app/home.module.css";

const stages = [
  { id: "away", label: "离开时" },
  { id: "during", label: "期间" },
  { id: "back", label: "回来后" },
] as const;

type StageId = (typeof stages)[number]["id"];
type Question = "原委托" | "依据" | "变化" | "等你";
type Row = {
  label: Question;
  value: string;
  meta: string;
  tone?: "waiting" | "done";
};

const rowsByStage: Record<StageId, Row[]> = {
  away: [
    {
      label: "原委托",
      value: exampleProject.goal,
      meta: "目标与结束条件已经确认",
    },
    {
      label: "依据",
      value: "比赛材料、任务安排、老师建议",
      meta: "3 条来源已保存",
    },
    {
      label: "变化",
      value: "还没有开始核对",
      meta: "离开期间不改变项目内容",
    },
    {
      label: "等你",
      value: "暂时不需要你操作",
      meta: "关掉页面不会丢掉这条委托",
    },
  ],
  during: [
    {
      label: "原委托",
      value: exampleProject.goal,
      meta: "任务身份与范围不变",
    },
    {
      label: "依据",
      value: "已读 3 条来源",
      meta: "冻结示例，不连接服务器",
      tone: "done",
    },
    {
      label: "变化",
      value: "发现缺口：演示流程还没有完成回执",
      meta: "缺口不会被自动当成已完成",
      tone: "waiting",
    },
    {
      label: "等你",
      value: "回来后处理，期间不改变项目",
      meta: "示例不模拟正在执行的 Worker",
    },
  ],
  back: [
    {
      label: "原委托",
      value: exampleProject.goal,
      meta: "原任务与草稿都留在原处",
    },
    {
      label: "依据",
      value: "比赛材料、任务安排、老师建议",
      meta: "3 条来源可回看原文",
    },
    {
      label: "变化",
      value: "演示流程缺少完成回执",
      meta: "原判断“先写汇报草稿”需要你重新确认",
      tone: "waiting",
    },
    {
      label: "等你",
      value: exampleProject.pending.title,
      meta: "确认后从原委托继续，不会另建任务",
      tone: "waiting",
    },
  ],
};

const toneIcon = {
  waiting: TriangleAlert,
  done: Check,
};

export function HomeHeroLens() {
  const [stageIndex, setStageIndex] = useState(stages.length - 1);
  const [direction, setDirection] = useState<"next" | "prev">("next");
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  const stage = stages[stageIndex].id;

  function selectStage(nextIndex: number, focus = false) {
    if (nextIndex === stageIndex) return;
    setDirection(nextIndex > stageIndex ? "next" : "prev");
    setStageIndex(nextIndex);
    setEvidenceOpen(false);
    if (focus) tabs.current[nextIndex]?.focus();
  }

  function handleTabKey(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? stages.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + stages.length) %
            stages.length;
    selectStage(next, true);
  }

  return (
    <div
      className={styles.lens}
      data-hero-lens
      aria-label="公开示例：委托当前工作包"
    >
      <header className={styles.lensHead}>
        <div className={styles.lensIdentity}>
          <p className={styles.lensKicker}>
            公开示例
            <span aria-hidden="true">·</span>
            {exampleProject.project}
          </p>
          <h2 className={styles.lensMission}>{exampleProject.mission}</h2>
        </div>
        <span className={styles.lensStatus}>
          <span className={styles.statusDot} aria-hidden="true" />
          等你确认
        </span>
      </header>

      <div
        className={styles.stageTabs}
        role="tablist"
        aria-label="委托阶段：离开时、期间、回来后"
      >
        {stages.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`stage-tab-${item.id}`}
            aria-selected={stageIndex === index}
            aria-controls="stage-panel"
            tabIndex={stageIndex === index ? 0 : -1}
            className={styles.stageTab}
            ref={(node) => {
              tabs.current[index] = node;
            }}
            onClick={() => selectStage(index)}
            onKeyDown={(event) => handleTabKey(event, index)}
          >
            <span className={styles.stageIndex} aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            {item.label}
          </button>
        ))}
      </div>

      <div
        className={styles.lensBody}
        id="stage-panel"
        role="tabpanel"
        aria-labelledby={`stage-tab-${stage}`}
        tabIndex={0}
      >
        <dl
          className={styles.lensRows}
          key={stage}
          data-direction={direction}
          data-animate="true"
        >
          {rowsByStage[stage].map((row) => {
            const Icon = row.tone ? toneIcon[row.tone] : null;
            return (
              <div className={styles.lensRow} key={row.label} data-tone={row.tone}>
                <dt>
                  {Icon ? (
                    <Icon
                      size={13}
                      aria-hidden="true"
                      className={styles.rowIcon}
                    />
                  ) : null}
                  {row.label}
                </dt>
                <dd>
                  <span className={styles.rowValue}>{row.value}</span>
                  <span className={styles.rowMeta}>{row.meta}</span>
                </dd>
              </div>
            );
          })}
        </dl>

        <div className={styles.lensActions}>
          <button
            type="button"
            className={styles.lensButton}
            aria-expanded={evidenceOpen}
            aria-controls="hero-evidence"
            onClick={() => setEvidenceOpen((open) => !open)}
          >
            <FileText size={15} aria-hidden="true" />
            {evidenceOpen ? "收起依据" : "查看依据"}
            <ChevronDown
              size={15}
              aria-hidden="true"
              className={styles.chevron}
              data-open={evidenceOpen}
            />
          </button>
          <a className={styles.lensLink} href="#experience">
            回到原委托
            <ArrowRight size={15} aria-hidden="true" />
          </a>
        </div>

        <div className={styles.evidenceWrap} id="hero-evidence" data-open={evidenceOpen}>
          <div className={styles.evidenceInner}>
            {evidenceOpen ? (
              <div className={styles.evidencePanel}>
                <p className={styles.evidenceIntro}>
                  原文来自内置公开素材，不读取你的项目。
                </p>
                <ul className={styles.evidenceList}>
                  {exampleProject.sources.map((source) => (
                    <li key={source.id}>
                      <p className={styles.evidenceName}>
                        {source.title}
                        <span>{source.meta}</span>
                      </p>
                      <q>{source.detail}</q>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <footer className={styles.lensFoot}>
        <span>冻结示例</span>
        <span aria-hidden="true">·</span>
        <span>不调用模型</span>
        <span aria-hidden="true">·</span>
        <span>与下方五步示例使用同一份素材</span>
      </footer>
    </div>
  );
}
