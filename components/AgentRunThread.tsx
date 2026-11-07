"use client";
import { useEffect, useState } from "react";
import type { ConversationProgress } from "@/lib/types/conversation";
import styles from "./AgentRunThread.module.css";

const phaseLabels: Record<string, string> = {
  RECOORDINATING: "方向已更新，正在重新协调",
  ROUTING: "正在定位相关项目",
  READING_SOURCE: "正在读取原资料",
  EVALUATING: "正在判断目标差距",
  WAITING_MODEL: "正在整理结论",
  READY: "正在保存本轮回答",
  WAITING_USER: "正在整理需要你补充的条件",
  STOPPING: "正在停止后续调查",
};
const STALE_AFTER_MS = 20_000;

type NodeState = "done" | "active" | "failed" | "unknown" | "stopped" | "idle";
function stepState(status: string): NodeState {
  if (status === "SUCCEEDED") return "done";
  if (status === "STARTED") return "active";
  if (status === "FAILED") return "failed";
  if (status === "UNKNOWN") return "unknown";
  if (status === "STOPPED") return "stopped";
  return "idle";
}

/**
 * 一轮调查的接续线。只呈现服务端已返回的阶段和步骤：不估算百分比，没有进度时不继续运动。
 * 动效是装饰，文字和节点形状足以读懂状态，减少动效时全部静止。
 */
export function AgentRunThread({ progress, onStop }: { progress?: ConversationProgress; onStop?: () => void }) {
  const phase = progress?.phase ?? "";
  const steps = progress?.steps ?? [];
  const finished = steps.filter(step => step.status === "SUCCEEDED").length;
  const signature = phase + ":" + steps.length + ":" + finished;
  const [waited, setWaited] = useState<{ signature: string; seconds: number }>({ signature, seconds: 0 });
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setWaited({ signature, seconds: Math.floor((Date.now() - started) / 1000) }), 1000);
    return () => window.clearInterval(timer);
  }, [signature]);
  const seconds = waited.signature === signature ? waited.seconds : 0;
  const stale = seconds * 1000 >= STALE_AFTER_MS;
  const stopping = phase === "STOPPING";
  const running = !stale && !stopping;
  const label = phaseLabels[phase] ?? "正在读取和处理…";
  return <div className={styles.thread} data-testid="agent-run-thread">
    <ol className={styles.list}>
      {steps.map(step => {
        const state = stepState(step.status);
        return <li key={step.id} className={styles.step} data-state={state === "active" && !running ? "idle" : state}>
          <span className={styles.node} aria-hidden="true"/>
          <span className={styles.stepLabel}>{step.label}</span>
          <span className="sr-only">{state === "done" ? "已完成" : state === "failed" ? "未读取到" : state === "unknown" ? "结果未知" : state === "stopped" ? "已停止" : "进行中"}</span>
        </li>;
      })}
      <li className={styles.step} data-state={stopping ? "stopped" : running ? "active" : "idle"} data-current="">
        <span className={styles.node} aria-hidden="true"/>
        <strong className={running ? styles.sweep : undefined} role="status">{label}</strong>
        {stale && <span className={styles.waited}>已等待 {seconds} 秒</span>}
      </li>
    </ol>
    {progress && onStop && <button type="button" className="workspace-link focus-ring" disabled={stopping} onClick={onStop}>停止本轮调查</button>}
  </div>;
}
