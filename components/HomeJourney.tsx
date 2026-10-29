"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileText,
  FolderOpen,
  Link2,
  RotateCcw,
  X,
} from "lucide-react";
import { StateDiffView } from "@/components/StateDiffView";
import type { ProjectStateDiff } from "@/lib/types/projectState";
import styles from "@/app/home.module.css";

// Verbatim demonstration material from prisma/seed.ts; no private project data.
const sources = [
  {
    id: "task",
    title: "任务安排",
    text: "目前还没有完整 Demo，需要先完成项目创建、碎片捕获和成果生成闭环。",
  },
  {
    id: "requirements",
    title: "比赛材料",
    text: "初赛需要准备创意描述、设计稿、作品介绍文档和演示材料。",
  },
  {
    id: "advice",
    title: "老师建议",
    text: "老师建议作品不要叫普通学习助手，要突出项目制学习和知识资产复用。",
  },
];
const steps = [
  {
    label: "查看记录",
    title: "先看看上次留下了什么",
    description:
      "这份示例项目保留了任务安排、参赛要求和老师建议。先读原文，再判断现在该做什么。",
    context: "已有示例素材",
  },
  {
    label: "核对依据",
    title: "记录说了什么，哪些还不知道",
    description:
      "历史记录和当前状态分别看。没有找到新的完成结果，不能据此断言功能现在仍未完成。",
    context: "已知与待确认",
  },
  {
    label: "查看判断",
    title: "下一步建议，要能说清依据",
    description:
      "根据材料要求和已有任务记录，先验证一条最小演示流程。这里展示预设的建议读法，不进行实时模型推理。",
    context: "预设建议",
  },
  {
    label: "确认行动",
    title: "先核对提案，再决定是否创建",
    description:
      "建议还不是待办。查看行动要做什么、怎样记录结果，再由你确认。这里的操作只影响本页示例。",
    context: "等待你的确认",
  },
  {
    label: "填写回执",
    title: "完成了什么，由实际结果来说明",
    description:
      "确认示例行动后，试着填写一段模拟回执。保存后回到依据页，可以看到这段结果和原记录放在一起。",
    context: "本页模拟操作",
  },
];
const demoDiff: ProjectStateDiff = {
  fromSnapshotId: "已有记录",
  toSnapshotId: "本页核对",
  algorithmVersion: "homepage-example",
  materialChange: false,
  summary: "当前完成情况待确认",
  items: [
    {
      changeKey: "example:completion",
      kind: "UNCERTAIN",
      summary: "演示流程的当前完成情况还需要核对",
      before: null,
      after: "已有任务记录，但没有新的完成回执；当前状态待确认",
      evidenceRefs: sources.slice(0, 2).map((source) => ({
        entityKind: "card",
        entityId: "example-" + source.id,
        field: "原文",
        observedAt: "",
        contentHash: "example-only",
      })),
    },
  ],
};

export function HomeJourney() {
  const [active, setActive] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [draft, setDraft] = useState("");
  const [receipt, setReceipt] = useState("");
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const step = steps[active];
  const selectedSource =
    sourceId === "receipt"
      ? { title: "模拟回执", text: receipt }
      : sources.find((source) => source.id === sourceId);

  useEffect(() => {
    const element = dialog.current;
    if (sourceId && element && !element.open) element.showModal();
    if (!sourceId && element?.open) element.close();
  }, [sourceId]);

  function reset() {
    setActive(0);
    setConfirmed(false);
    setDraft("");
    setReceipt("");
    setSourceId(null);
    setNotice("示例已重置，未修改任何个人项目。");
  }
  function sourceButton(id: string, title: string) {
    return (
      <button
        type="button"
        className={styles.sourceButton}
        onClick={() => setSourceId(id)}
        aria-label={"查看原文：" + title}
      >
        <Link2 size={13} aria-hidden="true" />
        {title}
        <span>查看原文</span>
      </button>
    );
  }
  return (
    <div className={styles.storyFrame} aria-label="参赛项目交互示例">
      <div className={styles.storyHeader}>
        <div className={styles.projectIdentity}>
          <span className={styles.projectIcon}>
            <FolderOpen size={20} aria-hidden="true" />
          </span>
          <div>
            <span>内置示例项目</span>
            <h3>忆程参赛作品开发</h3>
          </div>
        </div>
        <button type="button" className={styles.resetButton} onClick={reset}>
          <RotateCcw size={13} aria-hidden="true" />
          重置示例
        </button>
      </div>
      <div
        className={styles.storyTabs}
        role="tablist"
        aria-label="项目故事步骤"
      >
        {steps.map((item, index) => (
          <button
            type="button"
            role="tab"
            id={"story-tab-" + index}
            aria-selected={active === index}
            aria-controls="story-panel"
            tabIndex={active === index ? 0 : -1}
            key={item.label}
            onClick={() => {
              setActive(index);
              setNotice("");
            }}
            onKeyDown={(event) => {
              if (
                !["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? 4
                    : (active + (event.key === "ArrowRight" ? 1 : -1) + 5) % 5;
              setActive(next);
              setNotice("");
              document.getElementById("story-tab-" + next)?.focus();
            }}
          >
            <span aria-hidden="true">{index + 1}</span>
            {item.label}
          </button>
        ))}
      </div>
      <div
        className={styles.storyBody}
        role="tabpanel"
        id="story-panel"
        aria-labelledby={"story-tab-" + active}
        tabIndex={0}
      >
        <div className={styles.storyContext}>
          <p className={styles.contextLabel}>{step.context}</p>
          <h4>{step.title}</h4>
          <p>{step.description}</p>
          <div className={styles.contextPosition}>
            {active + 1}
            <span> / 5</span>
          </div>
        </div>
        <div className={styles.storyContent}>
          {active === 0 && (
            <div className={styles.recordCollection}>
              <div className={styles.paneHeading}>
                <h4>原始记录</h4>
                <span>3 条内置素材</span>
              </div>
              {sources.map((source) => (
                <article className={styles.record} key={source.id}>
                  <div>
                    <FileText size={15} aria-hidden="true" />
                    <h5>{source.title}</h5>
                  </div>
                  <p>{source.text}</p>
                  {sourceButton(source.id, source.title)}
                </article>
              ))}
            </div>
          )}
          {active === 1 && (
            <div className={styles.evidencePane}>
              <div className={styles.paneHeading}>
                <h4>已有依据</h4>
                <span>示例整理</span>
              </div>
              <div className={styles.factRow}>
                <span className={styles.factMark}>记录中提到</span>
                <p>初赛需要作品说明文档和演示材料。</p>
                {sourceButton("requirements", "比赛材料")}
              </div>
              <div className={styles.factRow}>
                <span className={styles.factMark}>已有任务安排</span>
                <p>先完成项目创建、资料录入和成果生成流程。</p>
                {sourceButton("task", "任务安排")}
              </div>
              <div className={styles.unknownRow}>
                <span className={styles.waitingBadge}>当前状态待确认</span>
                <p>
                  {receipt
                    ? "下方是你填写的模拟结果，真实完成情况仍需实际回执。"
                    : "上述任务现在是否已经完成？现有素材没有提供新的完成回执。"}
                </p>
              </div>
              {receipt && (
                <div className={styles.receiptEvidence}>
                  <span className={styles.exampleBadge}>新增模拟回执</span>
                  <p>{receipt}</p>
                  {sourceButton("receipt", "模拟回执")}
                </div>
              )}
            </div>
          )}
          {active === 2 && (
            <div className={styles.judgmentPane}>
              <div className={styles.paneHeading}>
                <h4>判断与建议</h4>
                <span>预设示例</span>
              </div>
              <StateDiffView diff={demoDiff} />
              <div className={styles.suggestion}>
                <span className={styles.factMark}>建议下一步</span>
                <h5>先跑通一次最小演示流程</h5>
                <p>
                  参赛材料需要演示，任务记录也提到流程待完成。可以先验证一条记录能否整理为记忆，再生成一份草稿，并记录实际结果。
                </p>
                <details className={styles.evidenceDetails}>
                  <summary>展开这条建议的依据</summary>
                  {sources.slice(0, 2).map((source) => (
                    <div key={source.id}>
                      <p>{source.text}</p>
                      {sourceButton(source.id, source.title)}
                    </div>
                  ))}
                  <p className={styles.detailNote}>
                    这里没有断言当前功能未完成；判断仍需要新的结果记录。
                  </p>
                </details>
              </div>
            </div>
          )}
          {active === 3 && (
            <div className={styles.actionProposal}>
              <div className={styles.paneHeading}>
                <h4>行动提案</h4>
                <span
                  className={
                    confirmed ? styles.confirmedBadge : styles.waitingBadge
                  }
                >
                  {confirmed ? "本页示例已确认" : "待用户确认"}
                </span>
              </div>
              <h5>验证一次资料录入到成果草稿的流程</h5>
              <dl className={styles.proposalFields}>
                <div>
                  <dt>要做什么</dt>
                  <dd>
                    录入一条项目记录，查看生成的记忆，再整理一份成果草稿。
                  </dd>
                </div>
                <div>
                  <dt>完成后记录</dt>
                  <dd>实际操作结果、失败位置，以及是否需要补充材料。</dd>
                </div>
                <div>
                  <dt>来源</dt>
                  <dd>
                    {sourceButton("task", "任务安排")}
                    {sourceButton("requirements", "比赛材料")}
                  </dd>
                </div>
              </dl>
              {!confirmed ? (
                <button
                  type="button"
                  className={styles.primary}
                  onClick={() => {
                    setConfirmed(true);
                    setNotice("已在本页示例中确认行动，没有创建真实待办。");
                  }}
                >
                  <Check size={16} aria-hidden="true" />
                  在示例中确认行动
                </button>
              ) : (
                <div className={styles.confirmationResult}>
                  <p>
                    <Check size={16} aria-hidden="true" />
                    {receipt
                      ? "示例行动与模拟回执已保存在本页。"
                      : "示例行动已确认，尚未填写完成结果。"}
                  </p>
                  <button
                    type="button"
                    className={styles.secondary}
                    onClick={() => setActive(4)}
                  >
                    去填写模拟回执
                    <ArrowRight size={15} aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          )}
          {active === 4 && (
            <div className={styles.receiptPane}>
              <div className={styles.paneHeading}>
                <h4>完成回执</h4>
                <span className={styles.exampleBadge}>模拟数据</span>
              </div>
              {!confirmed ? (
                <div className={styles.receiptGate}>
                  <p>
                    先确认行动，再填写模拟回执。单纯切换到这一步，不会把行动标为完成。
                  </p>
                  <button
                    type="button"
                    className={styles.secondary}
                    onClick={() => setActive(3)}
                  >
                    返回确认行动
                    <ArrowLeft size={15} aria-hidden="true" />
                  </button>
                </div>
              ) : receipt ? (
                <div className={styles.savedReceipt}>
                  <p className={styles.receiptSavedTitle}>
                    <Check size={17} aria-hidden="true" />
                    模拟回执已加入本页示例
                  </p>
                  <blockquote>{receipt}</blockquote>
                  <p>结果由你在本页填写，未经过实际操作核验。</p>
                  <button
                    type="button"
                    className={styles.secondary}
                    onClick={() => setActive(1)}
                  >
                    回到依据页查看
                    <ArrowRight size={15} aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (draft.trim().length < 5) return;
                    setReceipt(draft.trim());
                    setNotice("模拟回执已保存在本页，刷新页面后不会保留。");
                  }}
                >
                  <label htmlFor="demo-receipt">填写一段模拟完成结果</label>
                  <p id="receipt-help">
                    请写下一个假设的操作结果。不要填写私人资料；这不会成为真实项目的完成证明。
                  </p>
                  <textarea
                    id="demo-receipt"
                    aria-describedby="receipt-help"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    maxLength={500}
                    minLength={5}
                    required
                    placeholder="例如：假设已录入一条记录并生成草稿；草稿中的来源还需要逐项核对。"
                  />
                  <button
                    type="submit"
                    className={styles.primary}
                    disabled={draft.trim().length < 5}
                  >
                    保存模拟回执
                    <Check size={15} aria-hidden="true" />
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
      {notice && (
        <p role="status" className={styles.storyNotice}>
          {notice}
        </p>
      )}
      <div className={styles.storyFooter}>
        <p>
          已有记录取自内置素材；建议与回执为本页演示。不会调用模型或修改个人项目。
        </p>
        <div>
          <button
            type="button"
            aria-label="上一步"
            disabled={active === 0}
            onClick={() => setActive(active - 1)}
          >
            <ArrowLeft size={16} />
          </button>
          <button
            type="button"
            aria-label="下一步"
            disabled={active === 4}
            onClick={() => setActive(active + 1)}
          >
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
      <dialog
        ref={dialog}
        className={styles.sourceDialog}
        aria-labelledby="source-title"
        onCancel={() => setSourceId(null)}
        onClose={() => setSourceId(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setSourceId(null);
        }}
      >
        <div className={styles.dialogHeader}>
          <p>{sourceId === "receipt" ? "本页模拟记录" : "示例原始记录"}</p>
          <button
            type="button"
            aria-label="关闭原始记录"
            onClick={() => setSourceId(null)}
          >
            <X size={19} />
          </button>
        </div>
        <h3 id="source-title">{selectedSource?.title}</h3>
        <blockquote>{selectedSource?.text}</blockquote>
        <p className={styles.dialogProvenance}>
          {sourceId === "receipt"
            ? "这是你在本页填写的模拟回执，没有作为真实项目数据保存。"
            : "原文取自项目自带的演示素材，不是在线用户的个人记录。"}
        </p>
      </dialog>
    </div>
  );
}
