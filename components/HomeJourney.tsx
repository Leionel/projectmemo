"use client";

import { useState } from "react";
import { ArrowRight, Check, ChevronRight, FileText, FolderOpen, Link2, MessageSquare, Sparkles } from "lucide-react";
import styles from "@/app/home.module.css";

const stages = [
  { label: "记录", time: "周一 · 记下一次变化", title: "评审设备只有 8 GB 显存", body: "老师建议先核对部署限制，再决定演示方案。", source: "会议记录 · 原始材料", next: "把这条记录留在项目里", kind: "原始记录" },
  { label: "记忆", time: "周三 · 找回已有依据", title: "方案需要适配评审设备", body: "把会议要求和实验笔记放在一起，回看当前方案的约束。", source: "会议记录 + 实验笔记", next: "查看结论来自哪些材料", kind: "项目记忆" },
  { label: "提醒", time: "周五 · 发现仍待确认的事", title: "部署验证还缺一条结果", body: "已有基准实验记录，还没有看到目标设备上的验证结果。建议先做一次最小验证。", source: "依据：设备要求与已有实验记录", next: "由你决定是否创建行动", kind: "待你判断" },
  { label: "行动", time: "下周 · 带着结果继续", title: "完成一次最小部署验证", body: "记录设备、显存占用和验证结果，成为下一轮方案判断的依据。", source: "完成结果 → 回到项目记忆", next: "把结果留给下一次出发", kind: "行动与复盘" },
];

export function HomeJourney() {
  const [active, setActive] = useState(2);
  const stage = stages[active];
  return <div className={styles.journey} aria-label="个人项目 Agent 流程演示">
    <div className={styles.journeyCaption}><span><Sparkles size={14} aria-hidden="true" /> 一段项目经历，持续接续</span><span>交互示例</span></div>
    <div className={styles.workspace}>
      <div className={styles.workspaceHeader}><span className={styles.folderIcon}><FolderOpen size={21} aria-hidden="true" /></span><div><span>我的项目</span><h2>轻量视觉模型复赛</h2></div><span className={styles.projectBadge}>竞赛备赛</span></div>
      <div className={styles.stageTabs} role="tablist" aria-label="查看项目推进阶段"><span aria-hidden="true" className={styles.tabIndicator} style={{ transform: `translateX(${active * 100}%)` }} />{stages.map((item, index) => <button key={item.label} id={`journey-tab-${index}`} type="button" role="tab" aria-label={`查看${item.label}阶段`} aria-selected={active === index} aria-controls="journey-panel" tabIndex={active === index ? 0 : -1} onClick={() => setActive(index)} onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? stages.length - 1 : (active + (event.key === "ArrowRight" ? 1 : -1) + stages.length) % stages.length;
        setActive(next); document.getElementById(`journey-tab-${next}`)?.focus();
      }}><span>{index < active ? <Check size={13} aria-hidden="true" /> : index + 1}</span>{item.label}</button>)}</div>
      <div id="journey-panel" role="tabpanel" aria-labelledby={`journey-tab-${active}`} tabIndex={0} className={styles.stagePanel}>
        <p className={styles.stageTime}>{stage.time}</p>
        <div key={active} className={styles.focusCard}>
          <span className={styles.focusLabel}><span /> {stage.kind}</span><h3>{stage.title}</h3><p>{stage.body}</p>
          <div className={styles.source}><Link2 size={13} aria-hidden="true" />{stage.source}</div>
        </div>
        <div className={styles.nextStep}><MessageSquare size={17} aria-hidden="true" /><span>{stage.next}</span><ChevronRight size={16} aria-hidden="true" /></div>
      </div>
      <div className={styles.workspaceFoot}><FileText size={14} aria-hidden="true" /><span>过程留在项目里，下一步有据可循。</span></div>
    </div>
    <button type="button" className={styles.demoNext} onClick={() => setActive((active + 1) % stages.length)}>点击切换，看看{stages[(active + 1) % stages.length].label}阶段<ArrowRight size={15} aria-hidden="true" /></button>
  </div>;
}
