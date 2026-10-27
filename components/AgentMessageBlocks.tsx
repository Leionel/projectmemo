"use client";
import { useEffect, useState } from "react";
import { ArrowUpRight, Check, ChevronDown, Circle, FileText, GitBranch, Search } from "lucide-react";
import type { AllowedAction, HydratedBlock, RichTextNode } from "@/lib/types/agentExperience";
import type { ConversationMessage } from "@/lib/types/conversation";
import { ConversationAnswer } from "./ConversationFileGuides";
import { conversationHref } from "@/lib/conversation/navigation";
import styles from "./AgentMessageBlocks.module.css";
import { readConversationDraft, saveConversationDraft } from "@/lib/client/conversationDrafts";

const goalLabels: Record<string, string> = { VERIFIED: "已核验", REPORTED: "记录已报告", UNKNOWN: "待明确", BLOCKED: "有阻碍", NOT_APPLICABLE: "本目标不要求" };
const receiptLabels: Record<string, string> = { CREATED: "行动已创建", SUBMITTED: "已提交", RUNNING: "进行中", WAITING_USER: "等待你的回应", SUCCEEDED: "结果已保存", FAILED: "未完成", UNKNOWN: "结果尚不明确", CANCELLED: "已取消" };
const approvalLabels: Record<string, string> = { PENDING: "等待你确认", COMMITTED: "已采用", DECLINED: "已暂缓", STALE: "依据有变化", EXPIRED: "提案已过期", UNKNOWN: "请读取原状态" };
type ActionHandler = (action: AllowedAction, answer?: string) => Promise<void>;
export function supportsAgentPresentation(message: ConversationMessage) {
  return message.presentation?.schemaVersion === 1 && Array.isArray(message.presentation.blocks) && Array.isArray(message.presentation.allowedActions);
}
function RichText({ nodes, message, conversationId }: { nodes: RichTextNode[]; message: ConversationMessage; conversationId: string }) {
  const inline = (spans: Array<{ kind: string; text: string }>) => spans.map((span, i) => {
    const text = <ConversationAnswer message={{ ...message, content: span.text }} conversationId={conversationId}/>;
    return span.kind === "strong" ? <strong key={i}>{text}</strong> : span.kind === "emphasis" ? <em key={i}>{text}</em> : span.kind === "code" ? <code key={i}>{span.text}</code> : <span key={i}>{text}</span>;
  });
  return nodes.map((node, i) => {
    if (node.type === "paragraph") return <p key={i}>{inline(node.spans)}</p>;
    if (node.type === "heading") return node.level === 2 ? <h3 key={i}>{inline(node.spans)}</h3> : <h4 key={i}>{inline(node.spans)}</h4>;
    if (node.type === "list") { const List = node.ordered ? "ol" : "ul"; return <List key={i}>{node.items.map((item, j) => <li key={j}>{inline(item)}</li>)}</List>; }
    if (node.type === "code") return <pre key={i}><code>{node.text}</code></pre>;
    if (node.type === "table") return <div className={styles.tableScroll} key={i} role="region" aria-label="回答中的对照表" tabIndex={0}><table><thead><tr>{node.headers.map((s, j) => <th key={j}>{s}</th>)}</tr></thead><tbody>{node.rows.map((row, j) => <tr key={j}>{row.map((s, k) => <td key={k}>{s}</td>)}</tr>)}</tbody></table></div>;
    return null;
  });
}
function Question({ block, actions, busy, onAction }: { block: Extract<HydratedBlock, { semanticType: "question" }>; actions: AllowedAction[]; busy: boolean; onAction: ActionHandler }) {
  const [value, setValue] = useState(() => readConversationDraft(block.draftKey).answer);
  useEffect(() => { saveConversationDraft(block.draftKey, { ...readConversationDraft(block.draftKey), answer: value }); }, [block.draftKey, value]);
  const action = actions.find(a => a.actionKind === "ASK");
  return <form className={styles.question} onSubmit={e => { e.preventDefault(); if (action && value.trim()) void onAction(action, value.trim()); }}>
    <label htmlFor={block.draftKey}>{block.question}</label>
    {!!block.choices.length && <div className={styles.choices}>{block.choices.map(choice => <button type="button" key={choice.id} aria-pressed={value === choice.label} onClick={() => setValue(choice.label)}>{choice.label}</button>)}</div>}
    <textarea id={block.draftKey} value={value} required={block.required} disabled={busy || action?.enabled === false} maxLength={3000} placeholder="补充关键条件，接着讨论…" onChange={e => setValue(e.target.value)}/>
    {action && <button className={styles.primary} disabled={busy || !action.enabled || !value.trim()} type="submit">继续讨论 <ArrowUpRight size={15} aria-hidden="true"/></button>}
  </form>;
}
export function AgentMessageBlocks({ message, conversationId, busy, onAction }: {
  message: ConversationMessage; conversationId: string; busy: boolean; onAction: ActionHandler;
}) {
  const [selected, setSelected] = useState<Record<string, string>>(() => Object.fromEntries(
    (message.presentation?.blocks ?? []).filter(b => b.semanticType === "comparison").map(b => [b.blockKey,
      readConversationDraft(`${conversationId}:${message.id}:${b.blockKey}`).selected[0] ?? ""])
  ));
  const presentation = message.presentation;
  if (!supportsAgentPresentation(message) || !presentation) return null;
  const actionButtons = (block: HydratedBlock) => block.actionBindingIds.map(id => presentation.allowedActions.find(a => a.bindingId === id)).filter((a): a is AllowedAction => !!a);
  function controls(block: HydratedBlock) {
    const actions = actionButtons(block);
    return <div className={styles.actions}>{actions.map(action => <button key={action.bindingId} type="button"
      className={action.actionKind === "CONFIRM" ? styles.primary : styles.secondary} disabled={busy || !action.enabled}
      title={action.disabledReason ?? undefined} onClick={() => void onAction(action)}>{action.label}{action.actionKind === "OPEN" && <ArrowUpRight size={15} aria-hidden="true"/>}</button>)}
      {actions.find(a => a.disabledReason) && <small>{actions.find(a => a.disabledReason)?.disabledReason}</small>}</div>;
  }
  return <div className={styles.blocks} data-testid="agent-message-blocks">{presentation.blocks.map(block => {
    const common = { "data-block": block.semanticType, "data-emphasis": block.emphasis };
    if (block.semanticType === "prose") return <div key={block.blockKey} {...common} className={styles.prose}><RichText nodes={block.content} message={message} conversationId={conversationId}/></div>;
    if (block.semanticType === "goal_gap") return <section key={block.blockKey} {...common} className={styles.goal} aria-label="目标差距">
      <div className={styles.sectionHead}><GitBranch size={16} aria-hidden="true"/><h3>离目标还差什么</h3></div>
      <p className={styles.goalQuote}>{block.goalGap.goalQuote}</p>
      <ul>{block.goalGap.criteria.map(c => <li key={c.id}><span className={styles.state} data-state={c.state}>{c.state === "VERIFIED" ? <Check size={14}/> : <Circle size={10}/>}</span>
        <div><div className={styles.criterion}><strong>{c.requirement}</strong><span>{goalLabels[c.state]}</span></div><p>{c.explanation}</p></div></li>)}</ul>
      {block.goalGap.nextInformationNeed && <p className={styles.nextNeed}>接下来要明确：{block.goalGap.nextInformationNeed}</p>}{controls(block)}
    </section>;
    if (block.semanticType === "evidence") return <details key={block.blockKey} {...common} className={styles.evidence} open={block.emphasis === "primary"}>
      <summary><FileText size={16} aria-hidden="true"/><span>{block.fallbackText}</span><ChevronDown size={14} aria-hidden="true"/></summary>
      {block.evidence.map((e, i) => {
        const file = message.fileGuides?.find(f => f.sourceId === e.source.id);
        return <div key={e.source.id + i} className={styles.source}><blockquote>{e.quote}</blockquote><p>{e.claim}</p>
          {e.relation === "CONTRADICTS" && <small>这条记录与目标条件存在冲突</small>}
          {file && !file.missing && <a className="focus-ring" href={file.kind === "ATTACHMENT" ? file.href : conversationHref(file.href, conversationId, message.id)} target={file.kind === "ATTACHMENT" ? "_blank" : undefined} rel={file.kind === "ATTACHMENT" ? "noopener noreferrer" : undefined}>查看原资料 <ArrowUpRight size={14} aria-hidden="true"/></a>}
        </div>;
      })}{controls(block)}
    </details>;
    if (block.semanticType === "investigation") return <details key={block.blockKey} {...common} className={styles.trace}>
      <summary><Search size={15} aria-hidden="true"/><span>{block.fallbackText}</span><ChevronDown size={14} aria-hidden="true"/></summary>
      <ol>{block.steps.map(step => <li key={step.id}><span data-status={step.status}>{step.status === "SUCCEEDED" ? <Check size={14}/> : <Circle size={10}/>}</span><div>
        <strong>{step.decision.decision === "READ_EXISTING" ? step.decision.informationNeed : "核对资料"}</strong><p>{step.status === "SUCCEEDED" ? "已读取原资料" : step.failureReason ?? "正在核对"}</p>
      </div></li>)}</ol>{controls(block)}
    </details>;
    if (block.semanticType === "comparison") {
      const picked = selected[block.blockKey];
      const actions = actionButtons(block).filter(a => !a.frozen?.candidateId || a.frozen.candidateId === picked);
      return <section key={block.blockKey} {...common} className={styles.comparison} aria-label="方案比较"><h3>下一步的取舍</h3>
        <div className={styles.choices} role="group" aria-label="选择一个方案">{block.candidates.map(c => <button type="button" key={c.id} aria-pressed={picked === c.id} disabled={busy || c.feasibility !== "READY"} onClick={() => { setSelected(old => ({ ...old, [block.blockKey]: c.id })); const key = `${conversationId}:${message.id}:${block.blockKey}`; saveConversationDraft(key, { ...readConversationDraft(key), selected: [c.id] }); }}>
          <strong>{c.title}</strong><span>{c.tradeoff}</span>{c.expectedObservation && <small>要明确：{c.expectedObservation}</small>}
        </button>)}</div><div className={styles.actions}>{actions.map(a => <button key={a.bindingId} type="button" className={styles.primary} disabled={busy || !a.enabled} onClick={() => void onAction(a)}>{a.label}</button>)}</div>
        {picked && <details><summary>什么情况下继续或停止</summary><p>{block.candidates.find(c => c.id === picked)?.stopCondition}</p>{block.candidates.find(c => c.id === picked)?.branches.map((b, i) => <p key={i}>{b.observation} → {b.consequence}</p>)}</details>}
      </section>;
    }
    if (block.semanticType === "approval") return <section key={block.blockKey} {...common} className={styles.approval} aria-label="行动确认"><span className={styles.status}>{approvalLabels[block.state]}</span><h3>{block.fallbackText.split("\n")[0]}</h3>
      <p>{block.fallbackText.split("\n").slice(1).join("\n")}</p>{controls(block)}
    </section>;
    if (block.semanticType === "receipt") return <section key={block.blockKey} {...common} className={styles.receipt} aria-label="原业务回执"><span className={styles.receiptMark}><Check size={17}/></span><div><strong>{receiptLabels[block.state]}</strong><p>{block.fallbackText}</p>
      <small>{block.state === "CREATED" ? "等待执行，目标条件尚未验收" : block.verification === "VERIFIED" ? "已有独立核验依据" : "按原任务记录显示"}</small>{controls(block)}</div></section>;
    if (block.semanticType === "question") return <section key={block.blockKey} {...common}><Question key={block.draftKey} block={block} actions={actionButtons(block)} busy={busy} onAction={onAction}/></section>;
    if (block.semanticType === "change") return <section key={block.blockKey} {...common} className={styles.change}><h3>{block.disposition === "KEEP_PLAN" ? "保留当前计划" : "这条变化与目标有关"}</h3><p>{block.changeKind}</p><p>{block.relevance}</p>{block.unknowns.map((s, i) => <p key={i}>{s}</p>)}{controls(block)}</section>;
    if (block.semanticType === "timeline") return <ol key={block.blockKey} {...common} className={styles.timeline}>{block.events.map(e => <li key={e.ref.id}><time dateTime={e.occurredAt}>{new Date(e.occurredAt).toLocaleDateString("zh-CN")}</time><p>{e.summary}</p></li>)}</ol>;
    return <p key={(block as { blockKey: string }).blockKey} className={styles.prose}>{(block as { fallbackText: string }).fallbackText}</p>;
  })}</div>;
}
