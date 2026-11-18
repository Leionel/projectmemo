"use client";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, BookOpen, Check, CheckCircle2, FileText, Loader2, Paperclip, RotateCcw, Send, ShieldQuestion, X } from "lucide-react";
import { BookmarkSpirit } from "@/components/mascot/BookmarkSpirit";
import { evidenceTime, sourceDisplayName } from "@/lib/client/sourceDisplay";
import type { ChallengeKind, ChallengeSession } from "@/lib/types/challenge";
import { challengeKindLabel, evidenceVerdict, handoffStatus, mentorFinding, rehearsalStep, REHEARSAL_STEPS } from "@/lib/challenges/presentation";
import type { WorkbenchOutput, WorkbenchSource } from "@/lib/types/workbench";
import { SourceReader } from "./games/SourceReader";
import styles from "./OutcomeChallenges.module.css";

type Pending = { url: string; body: Record<string, unknown> };
type Props = {
  missionId: string; outputId?: string; outputs: WorkbenchOutput[]; latestOutput: WorkbenchOutput | null;
  kind: ChallengeKind; sources: WorkbenchSource[]; phase: string; phaseLabel: string;
  onKind: (kind: ChallengeKind) => void; onHandoff: () => void | Promise<void>; onOpenRevision: (revision: number) => void;
};

const EMPTY_HINT = "先打开原文，再选出这段稿实际引用的记录。";
const VERIFIED_HINT = "打开原文只定位出处；核对引用不等于证明内容正确。";
const DONE_HINT = "引用关系已对上，内容仍待核验；要改稿就显式交回。";
const HANDOFF_HINT = "已交回；新稿要等原委托真正保存后才会出现。";

function sourceName(source: WorkbenchSource) { return sourceDisplayName(source.id, source.name); }
function sourceTime(source: WorkbenchSource) { return source.observedAt ? evidenceTime(source.observedAt) : "时间未记录"; }

function HandoffReceipt({ session, latestOutput, phase, phaseLabel, onOpenRevision }: {
  session: ChallengeSession; latestOutput: WorkbenchOutput | null; phase: string; phaseLabel: string; onOpenRevision: (revision: number) => void;
}) {
  const newer = latestOutput && session.handoffAt && latestOutput.revision > session.revision &&
    Date.parse(latestOutput.createdAt) >= Date.parse(session.handoffAt) ? latestOutput : null;
  const status = handoffStatus(phase);
  return <section className={styles.receipt} aria-label="交回回执">
    <div className={styles.receiptHead}><span className={styles.receiptCheck}><Check size={15} aria-hidden />已接收</span>
      <span>{session.handoffAt ? evidenceTime(session.handoffAt) : "时间未记录"}</span></div>
    <h3>{newer ? "交回后，原委托保存了新稿" : "反馈已交回原委托"}</h3>
    <p>{newer ? "新版本已保存；旧版本仍可读，交回建议不等于已批准结论。" : status}</p>
    <div className={styles.receiptMeta}><span>{phaseLabel || "原委托已接收"}</span>{newer && <span>第 {newer.revision} 版 · {evidenceTime(newer.createdAt)}</span>}</div>
    {newer && <button type="button" className={styles.primary} onClick={() => onOpenRevision(newer.revision)}>
      <FileText size={15} aria-hidden />打开第 {newer.revision} 版</button>}
  </section>;
}

function RetryNote({ uncertain, busy, error, onRetry }: { uncertain: boolean; busy: boolean; error: string; onRetry: () => void }) {
  return <>
    {error && <p role="alert" className={styles.error}><AlertTriangle size={15} aria-hidden />{error}</p>}
    {uncertain && !busy && <button type="button" className={styles.retry} onClick={onRetry}><RotateCcw size={14} aria-hidden />重试原请求</button>}
  </>;
}

function Launch({ kind, outputId, busy, uncertain, error, onStart, onRetry, onKind }: {
  kind: ChallengeKind; outputId?: string; busy: boolean; uncertain: boolean; error: string;
  onStart: (kind: ChallengeKind) => void; onRetry: () => void; onKind: (kind: ChallengeKind) => void;
}) {
  const copy = kind === "EVIDENCE"
    ? { title: "给这句话，找回原记录", lead: "从这版稿里挑出它真正引用的记录。核对引用只说明出处关系，不证明结论正确。", action: "开始引用追溯" }
    : kind === "REHEARSAL"
      ? { title: "把这版稿，讲清楚", lead: "依据、边界、改稿三轮追问。回答会整理成待核对意见，不会自动改动原稿。", action: "开始三轮彩排" }
      : { title: "两条记录，能不能直接比？", lead: "从本稿来源中的真实指标记录出题；判断不会改变项目事实。", action: "开始指标核对" };
  return <div className={styles.launch}>
    <div className={styles.launchArt}><BookmarkSpirit pose={kind === "REHEARSAL" ? "thinking" : "inspect"} size={152}
      hint={kind === "EVIDENCE" ? EMPTY_HINT : undefined} /></div>
    <div className={styles.launchCopy}><p className={styles.eyebrow}>{challengeKindLabel(kind)}</p><h2>{copy.title}</h2><p>{copy.lead}</p>
      {!outputId ? <p className={styles.blocked}>先准备一版有来源的成果，再开始。</p> : <div className={styles.launchActions}>
        <button type="button" className={styles.primary} disabled={busy || uncertain} onClick={() => onStart(kind)}>{copy.action}<ArrowRight size={15} aria-hidden /></button>
        {kind === "EVIDENCE" && <button type="button" className={styles.quietAction} disabled={busy || uncertain} onClick={() => onKind("METRIC")}>改做指标可比性</button>}
      </div>}
      <RetryNote uncertain={uncertain} busy={busy} error={error} onRetry={onRetry} />
    </div>
  </div>;
}

function StepTrail({ index }: { index: number }) {
  return <ol className={styles.steps} aria-label="彩排进度">
    {REHEARSAL_STEPS.map((step, position) => <li key={step.key} data-state={position < index ? "done" : position === index ? "current" : "pending"}>
      <span>{position < index ? <Check size={13} aria-hidden /> : position + 1}</span>{step.label}</li>)}
  </ol>;
}

function EvidenceView({ session, sources, busy, uncertain, readerKey, closeReader, choices, setChoice, clearChoices, openSource, handoff, latestOutput, phase, phaseLabel, onOpenRevision, celebrate }: {
  session: ChallengeSession; sources: WorkbenchSource[]; busy: boolean; uncertain: boolean;
  readerKey: string | null; closeReader: () => void;
  choices: string[]; setChoice: (key: string, selected: boolean) => void; clearChoices: () => void;
  openSource: (source: WorkbenchSource) => void; handoff: () => void;
  latestOutput: WorkbenchOutput | null; phase: string; phaseLabel: string; onOpenRevision: (revision: number) => void; celebrate: boolean;
}) {
  const question = session.questions[0];
  const [dragging, setDragging] = useState(false);
  const readerColumn = useRef<HTMLDivElement>(null);
  const readerTrigger = useRef<HTMLButtonElement>(null);
  const done = session.status === "COMPLETED";
  const verdict = evidenceVerdict(session);
  const roundSources = sources.filter(source => session.sourceKeys.includes(source.key));
  const byId = new Map(roundSources.map(source => [source.id, source]));
  const reader = readerKey ? roundSources.find(source => source.key === readerKey) : undefined;
  const optionFor = (source: WorkbenchSource) => question?.options.find(option => option.key === source.id);
  const cards = (question?.options ?? []).filter(option => option.key !== "NO_REFERENCE")
    .map(option => ({ option, source: byId.get(option.key) }))
    .filter((item): item is { option: typeof question.options[number]; source: WorkbenchSource } => !!item.source);
  const noReference = question?.options.find(option => option.key === "NO_REFERENCE");
  const selectedSources = choices.map(key => byId.get(key)).filter((source): source is WorkbenchSource => !!source);
  const pose = celebrate ? "success" : session.handoffSourceId ? "handoff" : reader ? "inspect" : choices.length ? "inspect" : "idle";
  const hint = session.handoffSourceId ? HANDOFF_HINT : done ? DONE_HINT : choices.length ? VERIFIED_HINT : EMPTY_HINT;
  function read(source: WorkbenchSource, trigger: HTMLButtonElement) {
    readerTrigger.current = trigger;
    openSource(source);
    if (window.matchMedia("(max-width: 680px)").matches) {
      window.requestAnimationFrame(() => {
        const panel = readerColumn.current;
        panel?.focus({ preventScroll: true });
        panel?.scrollIntoView({ block: "start", behavior: "instant" });
      });
    }
  }
  function close() {
    closeReader();
    readerTrigger.current?.focus();
  }

  if (!question) return <div className={styles.summary}><p>本轮题面已撤下，请核对当前版本与来源许可。</p></div>;
  return <div className={styles.evidenceLayout}>
    <div className={styles.canvas}>
      <div className={styles.draftRow}>
        <div className={styles.draftCard}><span className={styles.draftLabel}><FileText size={15} aria-hidden />稿件原句 · 第 {session.revision} 版</span>
          <p>{question.excerpt}</p></div>
        <div className={styles.mascotSpot}><BookmarkSpirit pose={pose} size={104} hint={hint} /></div>
      </div>
      <div className={styles.slot} data-dragging={dragging} data-filled={selectedSources.length > 0}
        onDragOver={event => { if (done || busy || uncertain || !event.dataTransfer.types.includes("application/x-projectmemo-source")) return; event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
        onDrop={event => {
          if (done || busy || uncertain) return; event.preventDefault(); setDragging(false);
          const key = event.dataTransfer.getData("application/x-projectmemo-source");
          if (cards.some(card => card.option.key === key)) setChoice(key, true);
        }}>
        <div className={styles.slotHead}><span><Paperclip size={16} aria-hidden />{selectedSources.length ? "已放入 " + selectedSources.length + " 条引用" : "点选或拖入引用记录"}</span>
          {!!selectedSources.length && !done && <button type="button" onClick={clearChoices} disabled={busy || uncertain}>清空</button>}</div>
        {selectedSources.length ? <ul className={styles.chips}>{selectedSources.map(source => <li key={source.key}>
          <button type="button" className={styles.chip} onClick={event => read(source, event.currentTarget)}><BookOpen size={13} aria-hidden />{sourceName(source)}
            <span>{sourceTime(source)}</span></button>
          {!done && <button type="button" className={styles.chipRemove} aria-label={"取消选择 " + sourceName(source)} disabled={busy || uncertain}
            onClick={() => setChoice(optionFor(source)?.key ?? source.id, false)}><X size={13} aria-hidden /></button>}
        </li>)}</ul> : <p className={styles.slotEmpty}>拖到这里，或逐张点“选择这条”。多选按本题实际引用为准。</p>}
      </div>
      {noReference && <label className={styles.noReference}><input type="checkbox" checked={choices.includes(noReference.key)} disabled={done || busy || uncertain}
        onChange={event => { clearChoices(); if (event.target.checked) setChoice(noReference.key, true); }} />这段没有引用依据</label>}
      <div className={styles.shelf} aria-label="候选来源">{cards.map(({ option, source }) => {
        const selected = choices.includes(option.key);
        return <article key={option.key} className={styles.sourceCard} data-selected={selected} draggable={!done && !busy && !uncertain}
          onDragStart={event => { event.dataTransfer.setData("application/x-projectmemo-source", option.key); event.dataTransfer.setData("text/plain", option.key); event.dataTransfer.effectAllowed = "copyMove"; }}
          onDragEnd={() => setDragging(false)}>
          <div className={styles.sourceTop}><span><FileText size={15} aria-hidden />{sourceName(source)}</span><time dateTime={source.observedAt || undefined}>{sourceTime(source)}</time></div>
          <p>{source.text.trim().slice(0, 96) || "这条记录没有可读正文，请打开原文核对。"}</p>
          <div className={styles.sourceFoot}><button type="button" disabled={busy || uncertain} onClick={event => read(source, event.currentTarget)}>打开原文</button>
            <button type="button" aria-pressed={selected} disabled={done || busy || uncertain} onClick={() => setChoice(option.key, !selected)}>
              {selected ? <><Check size={14} aria-hidden />已选</> : "选择这条"}</button></div>
        </article>;
      })}</div>
      {!cards.length && <p className={styles.blocked}>这版稿的来源许可或版本已变化，暂不能出题。</p>}
      {done && verdict && <section className={styles.verdict} data-tone={verdict.tone} aria-label="核对结果">
        <span className={styles.verdictIcon}>{verdict.tone === "match" ? <CheckCircle2 size={20} aria-hidden /> : <ShieldQuestion size={20} aria-hidden />}</span>
        <div><h3>{verdict.title}</h3><p className={styles.verdictDetail}>{verdict.detail}</p><p>{verdict.note}</p></div>
      </section>}
      {session.handoffSourceId ? <HandoffReceipt session={session} latestOutput={latestOutput} phase={phase} phaseLabel={phaseLabel} onOpenRevision={onOpenRevision} /> :
        done ? <div className={styles.doneBar}><p><strong>引用关系已对上，内容仍待核验。</strong>交回只会形成待核对反馈，不会自动改稿。</p>
          <button type="button" className={styles.primary} disabled={busy || uncertain} onClick={handoff}>{busy ? <><Loader2 size={15} className={styles.spin} aria-hidden />交回中…</> : "把缺口交回改稿"}<ArrowRight size={15} aria-hidden /></button></div> : null}
    </div>
    <div className={styles.readerColumn} ref={readerColumn} tabIndex={-1} role="region" aria-label="出处">{reader ? <SourceReader source={reader} excerpt={question.excerpt} onClose={close} /> :
      <div className={styles.readerEmpty}><BookOpen size={19} aria-hidden /><h3>原文阅读</h3><p>打开一张来源卡，查看原文里的相关段落。</p></div>}</div>
  </div>;
}

function MentorView({ session, sources, output, busy, uncertain, drafts, setDraft, evidence, setEvidence, openSource, readerKey, setReaderKey, answer, handoff, latestOutput, phase, phaseLabel, onOpenRevision, celebrate }: {
  session: ChallengeSession; sources: WorkbenchSource[]; output: WorkbenchOutput | null; busy: boolean; uncertain: boolean;
  drafts: Record<string, string>; setDraft: (key: string, value: string) => void; evidence: Record<string, string | undefined>; setEvidence: (key: string, value: string | undefined) => void;
  openSource: (source: WorkbenchSource) => void; readerKey: string | null; setReaderKey: (key: string | null) => void;
  answer: () => void; handoff: () => void; latestOutput: WorkbenchOutput | null; phase: string; phaseLabel: string;
  onOpenRevision: (revision: number) => void; celebrate: boolean;
}) {
  const [notebook, setNotebook] = useState<"findings" | "source">("findings");
  const question = session.questions[session.answers.length];
  const done = session.status === "COMPLETED";
  const reader = readerKey && session.sourceKeys.includes(readerKey) ? sources.find(source => source.key === readerKey) : undefined;
  const activeNotebook = notebook === "source" && reader ? "source" : "findings";
  const sourceByKey = new Map(sources.map(source => [source.key, source]));
  const draftText = drafts[question?.key ?? ""] ?? "";
  const bound = question ? evidence[question.key] : undefined;
  const pose = celebrate ? "success" : session.handoffSourceId ? "handoff" : activeNotebook === "source" ? "inspect" : "thinking";
  const hint = done ? "这里留下了你刚才指出的缺口，交回后可以跟进新稿。" : "如果没有足够的材料，可以把这处标为待确认。";
  const preview = session.questions.map((item, index) => {
    const saved = session.answers[index];
    return saved ? mentorFinding(item, saved, index) : null;
  }).filter((item): item is NonNullable<typeof item> => !!item);

  if (!question && !done) return <div className={styles.summary}><p>本轮题面已撤下，请核对当前版本与来源许可。</p></div>;
  return <>
    <StepTrail index={done ? REHEARSAL_STEPS.length : session.answers.length} />
    <div className={styles.mentorLayout} data-done={done}>
      <aside className={styles.draftPane} aria-label="原稿预览">
        <div className={styles.paneHead}><span><FileText size={14} aria-hidden />原稿 · 第 {session.revision} 版</span><time>{output ? evidenceTime(output.createdAt) : ""}</time></div>
        <div className={styles.draftBody}>{output?.blocks.slice(0, 4).map(block => {
          const active = question && (block.text.includes(question.excerpt.slice(0, 18)) || question.excerpt.includes(block.text.slice(0, 18)));
          return <p key={block.blockId} data-active={active}>{block.text}</p>;
        }) ?? <p>当前稿不可读，请返回成果核对。</p>}</div>
        {sources.length > 0 && <button type="button" className={styles.paneLink} disabled={busy || uncertain}
          onClick={() => { const source = sources[0]; openSource(source); setReaderKey(source.key); setNotebook("source"); }}><BookOpen size={14} aria-hidden />打开原记录</button>}
      </aside>
      <div className={styles.rehearsal}>
        {question && <div className={styles.rehearsalTop}>
          <div className={styles.questionBubble}><span>{rehearsalStep(question, session.answers.length).label}</span>
            <h3>{question.title}</h3><p>{question.excerpt}</p></div>
          <BookmarkSpirit pose={pose} size={96} hint={hint} quiet={notebook === "source"} />
        </div>}
        {question ? <form className={styles.reply} onSubmit={event => { event.preventDefault(); if (draftText.trim()) answer(); }}>
          <label htmlFor={"rehearsal-" + question.key}>本轮核查意见</label>
          <textarea id={"rehearsal-" + question.key} rows={4} maxLength={1200} value={draftText} disabled={busy || uncertain}
            placeholder="写下你能确认的事实、边界，或说明这处还不知道。" onChange={event => setDraft(question.key, event.target.value)} />
          <div className={styles.bindRow}><span>关联一条原证据<small>可选</small></span>
            <div className={styles.bindChips}><button type="button" aria-pressed={!bound} disabled={busy || uncertain} onClick={() => setEvidence(question.key, undefined)}>不关联</button>
              {session.sourceKeys.map(key => { const source = sourceByKey.get(key); return source ? <button type="button" key={key} aria-pressed={bound === key} disabled={busy || uncertain}
                onClick={() => setEvidence(question.key, key)}>{sourceName(source)}</button> : null; })}</div></div>
          <div className={styles.replyFoot}><button type="button" className={styles.quick} disabled={busy || uncertain}
            onClick={() => setDraft(question.key, "这处我还不知道，需要项目负责人确认。") }>这处我还不知道</button>
            <button type="submit" className={styles.primary} disabled={busy || uncertain || !draftText.trim()}>{busy ? <><Loader2 size={15} className={styles.spin} aria-hidden />保存中…</> : "回答并继续"}<ArrowRight size={15} aria-hidden /></button></div>
          <p className={styles.counter}>第 {session.answers.length + 1} / {session.questions.length} 轮 · 回答不会自动改变项目事实</p>
        </form> : <div className={styles.preview}>
          <div className={styles.previewHead}><div><p className={styles.eyebrow}>待核对</p><h3>{preview.length} 条改稿意见已整理</h3></div>
            <BookmarkSpirit pose={pose} size={76} hint={hint} /></div>
          <div className={styles.previewRows}>{preview.map(item => <div key={item.questionKey} className={styles.previewRow}>
            <span className={styles.previewStep}>{item.stepLabel}</span>
            <div><span className={styles.basisTag}>{item.basisLabel}</span><p>{item.basis}</p></div>
            <div><span className={styles.suggestTag}>建议</span><p>{item.suggestion}</p></div>
          </div>)}</div>
          <p className={styles.previewFoot}>建议来自你的回答，不会自动变成本轮结论；交回后由原委托决定如何改稿。</p>
          {session.handoffSourceId ? <HandoffReceipt session={session} latestOutput={latestOutput} phase={phase} phaseLabel={phaseLabel} onOpenRevision={onOpenRevision} /> :
            <button type="button" className={styles.primary} disabled={busy || uncertain} onClick={handoff}>{busy ? <><Loader2 size={15} className={styles.spin} aria-hidden />交回中…</> : "交回原委托"}<Send size={15} aria-hidden /></button>}
        </div>}
      </div>
      {(!done || activeNotebook === "source") && <aside className={styles.notebook} aria-label="本轮发现">
        <div className={styles.paneHead}><span>{activeNotebook === "source" ? "原文阅读" : "本轮发现"}</span>
          {activeNotebook === "source" && <button type="button" className={styles.paneSwitch} onClick={() => setNotebook("findings")}>回到发现</button>}</div>
        {activeNotebook === "source" && reader ? <SourceReader source={reader} excerpt={question?.excerpt ?? session.questions[0]?.excerpt ?? ""} onClose={() => setNotebook("findings")} /> :
          <>{preview.length ? <ul className={styles.findings}>{preview.map((item, index) => <li key={item.questionKey}>
            <span className={styles.findingIndex}>{index + 1}</span><div><p>{item.suggestion}</p><small>{item.stepLabel}{item.evidenceKey && sourceByKey.get(item.evidenceKey) ? " · 已引用 " + sourceName(sourceByKey.get(item.evidenceKey)!) : " · 未绑定来源"}</small></div>
            {item.evidenceKey && sourceByKey.get(item.evidenceKey) && <button type="button" aria-label="打开这条发现的来源" disabled={busy || uncertain}
              onClick={() => { const source = sourceByKey.get(item.evidenceKey!)!; openSource(source); setReaderKey(source.key); setNotebook("source"); }}><BookOpen size={14} aria-hidden /></button>}
          </li>)}</ul> : <div className={styles.findingsEmpty}><ShieldQuestion size={20} aria-hidden /><p>回答第一轮后，这里会逐条整理待核对缺口。</p></div>}
        </>}
      </aside>}
    </div>
  </>;
}

function MetricView({ session, sources, busy, uncertain, choices, setChoice, handoff, latestOutput, phase, phaseLabel, onOpenRevision, celebrate }: {
  session: ChallengeSession; sources: WorkbenchSource[]; busy: boolean; uncertain: boolean; choices: string[]; setChoice: (key: string, selected: boolean) => void;
  handoff: () => void; latestOutput: WorkbenchOutput | null; phase: string; phaseLabel: string; onOpenRevision: (revision: number) => void; celebrate: boolean;
}) {
  const question = session.questions[0]; const done = session.status === "COMPLETED"; const answer = session.answers[0];
  if (!question) return <div className={styles.summary}><p>本轮题面已撤下，请核对当前版本与来源许可。</p></div>;
  return <div className={styles.metricLayout}>
    <div className={styles.metricMain}><p className={styles.eyebrow}>指标可比性 · 第 {session.revision} 版</p><h2>这两条记录，能直接比较吗？</h2>
      <pre className={styles.metricExcerpt}>{question.excerpt}</pre>
      <fieldset className={styles.metricOptions}><legend>选择一项条件判断</legend>{question.options.map(option => <label key={option.key}>
        <input type="radio" name="metric" checked={choices.includes(option.key)} disabled={done || busy || uncertain} onChange={() => setChoice(option.key, true)} />{option.label}</label>)}</fieldset>
      {done && answer && <section className={styles.verdict} data-tone={answer.verdict === "LINK_MATCH" ? "match" : "review"} aria-label="核对结果">
        <span className={styles.verdictIcon}>{answer.verdict === "LINK_MATCH" ? <CheckCircle2 size={20} aria-hidden /> : <ShieldQuestion size={20} aria-hidden />}</span>
        <div><h3>{answer.verdict === "LINK_MATCH" ? "判断与已提供的指标条件一致" : "判断与记录条件有差异"}</h3><p>这只核对可比性条件，不代表实验结果已被独立验证。</p></div></section>}
      {session.handoffSourceId ? <HandoffReceipt session={session} latestOutput={latestOutput} phase={phase} phaseLabel={phaseLabel} onOpenRevision={onOpenRevision} /> :
        done ? <div className={styles.doneBar}><p>把口径疑问交回原委托，保留未知条件。</p><button type="button" className={styles.primary} disabled={busy || uncertain} onClick={handoff}>交回核查请求<ArrowRight size={15} aria-hidden /></button></div> : null}
    </div>
    <aside className={styles.metricSide}><BookmarkSpirit pose={celebrate ? "success" : done ? "thinking" : "inspect"} size={170} hint="判断来自记录条件；不要用当前时间补缺失的时间。" />
      <div className={styles.metricSources}><span>本题来自这些记录</span>{sources.slice(0, 4).map(source => <div key={source.key}><FileText size={14} aria-hidden /><span>{sourceName(source)}</span><time>{sourceTime(source)}</time></div>)}</div>
      </aside>
  </div>;
}

export function OutcomeChallenges({ missionId, outputId, outputs, latestOutput, kind, sources, phase, phaseLabel, onKind, onHandoff, onOpenRevision }: Props) {
  const base = "/api/missions/" + encodeURIComponent(missionId) + "/challenges";
  const [session, setSession] = useState<ChallengeSession | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [choices, setChoices] = useState<Record<string, string[]>>({});
  const [evidence, setEvidence] = useState<Record<string, string | undefined>>({});
  const [readerKey, setReaderKey] = useState<string | null>(null);
  const [readerClosed, setReaderClosed] = useState(false);
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState("");
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const firstOpened = session?.openedSourceKeys[0] ?? null;
  const activeReaderKey = readerKey ?? (readerClosed ? null : firstOpened);
  const openReader = (key: string) => { setReaderClosed(false); setReaderKey(key); };
  const closeReader = () => { setReaderClosed(true); setReaderKey(null); };
  const pending = useRef<Pending | null>(null); const mutationEpoch = useRef(0); const reported = useRef(false); const previousHandoff = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    const read = async () => {
      if (pending.current) return;
      const epoch = mutationEpoch.current;
      try {
        const response = await fetch(base, { cache: "no-store" }), value = await response.json();
        if (!active || epoch !== mutationEpoch.current) return;
        if (!response.ok) {
          if ([401, 403, 404].includes(response.status)) setSession(null);
          throw new Error(value.error?.message ?? "挑战读取失败，可刷新重试");
        }
        setSession(value.session);
        if (!reported.current && value.session?.status === "ACTIVE") { reported.current = true; onKind(value.session.kind); }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "挑战暂时无法读取"); }
    };
    void read(); const interval = setInterval(() => void read(), 5000);
    return () => { active = false; clearInterval(interval); };
  }, [base, outputId, onKind]);
  useEffect(() => {
    const at = session?.handoffAt ?? null;
    if (at && at !== previousHandoff.current) { previousHandoff.current = at; setCelebrate(true); const timer = setTimeout(() => setCelebrate(false), 2400); return () => clearTimeout(timer); }
    if (!at) previousHandoff.current = null;
  }, [session?.handoffAt]);
  async function send(body: Record<string, unknown>, starting = false) {
    if (busy || (pending.current && Object.keys(body).length)) return;
    mutationEpoch.current++;
    pending.current ??= { url: starting ? base : base + "/" + session!.id, body: { ...body, requestId: crypto.randomUUID() } };
    setBusy(true); setUncertain(true); setError("");
    const request = pending.current;
    try {
      const response = await fetch(request.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request.body) });
      const value = await response.json();
      if (!response.ok) {
        if (response.status < 500 && response.status !== 408) {
          pending.current = null; setUncertain(false);
          const fresh = await fetch(base, { cache: "no-store" });
          if (fresh.ok) setSession((await fresh.json()).session); else setSession(null);
        }
        throw new Error(value.error?.message ?? "提交尚未确认，请重试原请求");
      }
      pending.current = null; setUncertain(false); setSession(value.session);
      if (request.body.action === "DELETE_ATTEMPT" || request.url === base) {
        setDrafts({}); setChoices({}); setEvidence({}); setDeleteArmed(false);
        setReaderKey(null); setReaderClosed(false);
      }
      if (request.body.action === "HANDOFF") void Promise.resolve(onHandoff()).catch(() => setError("交回已保存；工作台尚未刷新，可稍后重新读取。"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "提交尚未确认，请重试原请求"); }
    finally { setBusy(false); }
  }
  const retry = () => void send({});
  const start = (value: ChallengeKind) => void send({ kind: value, outputId }, true);
  const answered = session?.answers[0];
  const originalOutput = outputs.find(output => output.id === session?.outputId) ?? null;
  // 刷新后从服务端已保存的回答恢复选择，避免“已核对”却没有已选来源的错位。
  const selected = choices[session?.questions[0]?.key ?? ""] ?? answered?.selected ?? [];
  const setChoice = (key: string, value: boolean) => {
    setChoices(current => {
      const question = session?.questions[0]?.key; if (!question) return current;
      const previous = current[question] ?? [];
      if (key === "NO_REFERENCE") return { ...current, [question]: value ? ["NO_REFERENCE"] : [] };
      const withoutNoRef = previous.filter(item => item !== "NO_REFERENCE");
      return { ...current, [question]: value ? [...new Set([...withoutNoRef, key])] : withoutNoRef.filter(item => item !== key) };
    });
  };
  const clearChoices = () => setChoices(current => ({ ...current, [session?.questions[0]?.key ?? ""]: [] }));
  const openSource = (source: WorkbenchSource) => {
    openReader(source.key);
    if (session?.openedSourceKeys.includes(source.key)) return;
    void send({ action: "OPEN_SOURCE", sourceKey: source.key });
  };
  const verify = () => { const question = session?.questions[0]; if (!question || !selected.length) return; void send({ action: "ANSWER", questionKey: question.key, selected }); };
  const answer = () => {
    const question = session?.questions[session.answers.length]; if (!question) return;
    const text = (drafts[question.key] ?? "").trim(); if (!text) return;
    void send({ action: "ANSWER", questionKey: question.key, text, evidenceKeys: evidence[question.key] ? [evidence[question.key]] : [] });
  };
  const handoff = () => void send({ action: "HANDOFF" });
  const stop = () => void send({ action: "STOP" });
  const remove = () => { if (!deleteArmed) { setDeleteArmed(true); return; } void send({ action: "DELETE_ATTEMPT" }); };
  const deleteLabel = deleteArmed ? "确认删除回答" : "删除本轮回答";
  const retryNote = <RetryNote uncertain={uncertain} busy={busy} error={error} onRetry={retry} />;

  if (!session) return <Launch kind={kind} outputId={outputId} busy={busy} uncertain={uncertain} error={error} onStart={start} onRetry={retry} onKind={onKind} />;
  if (session.status === "ACTIVE" && session.kind !== kind) return <div className={styles.lockNote}>
    <ShieldQuestion size={22} aria-hidden /><div><h3>有一轮{session.kind === "EVIDENCE" ? "证据侦探" : session.kind === "REHEARSAL" ? "交付彩排" : "指标核对"}还没结束</h3>
      <p>同一份成果同时只保留一轮核查。先继续原轮次，或退出后再开新玩法。</p></div>
    <div><button type="button" className={styles.primary} onClick={() => onKind(session.kind)}>继续这一轮</button>
      <button type="button" className={styles.secondary} disabled={busy || uncertain} onClick={stop}>退出本轮</button>{retryNote}</div></div>;
  if (session.kind !== kind) return <Launch kind={kind} outputId={outputId} busy={busy} uncertain={uncertain} error={error} onStart={start} onRetry={retry} onKind={onKind} />;
  if (session.status === "STALE" && session.handoffSourceId) return <div className={styles.console}>
    <div className={styles.stale}><CheckCircle2 size={22} aria-hidden /><div><h3>{latestOutput && latestOutput.revision > session.revision ? "本轮已交回，原稿已有新版本" : "本轮已交回，后续资料有变化"}</h3>
      <p>核查反馈仍保留在原记录中；本轮题面已撤下，旧版本继续可读。</p>
      <p className={styles.staleNote}>{session.reason ?? "稿件或来源已变化。"}</p></div>
      <div><button type="button" className={styles.secondary} disabled={busy || uncertain || !outputId} onClick={() => start(session.kind)}>从当前版本重新开始</button>
        <button type="button" className={styles.secondary} disabled={busy || uncertain} onClick={remove}>{deleteLabel}</button>{retryNote}</div></div>
    <HandoffReceipt session={session} latestOutput={latestOutput} phase={phase} phaseLabel={phaseLabel} onOpenRevision={onOpenRevision} />
  </div>;
  if (session.status === "STALE") return <div className={styles.stale}>
    <AlertTriangle size={22} aria-hidden /><div><h3>本轮已撤下</h3><p>{session.reason ?? "稿件或来源已变化，请从当前版本重新开始。"}</p>
      <p className={styles.staleNote}>已输入的文字与选择仍保留在本地；重新开始会生成一轮新题。</p></div>
    <div><button type="button" className={styles.primary} disabled={busy || uncertain || !outputId} onClick={() => start(session.kind)}>从当前版本重新开始</button>
      <button type="button" className={styles.secondary} disabled={busy || uncertain} onClick={remove}>{deleteLabel}</button>{retryNote}</div></div>;
  if (session.status === "STOPPED") return <div className={styles.stale}>
    <CheckCircle2 size={22} aria-hidden /><div><h3>本轮已退出</h3><p>原委托继续保留；这轮回答仍可按保留规则删除。</p></div>
    <div><button type="button" className={styles.primary} disabled={busy || uncertain || !outputId} onClick={() => start(session.kind)}>再开一轮</button>
      {!!session.answers.length && <button type="button" className={styles.secondary} disabled={busy || uncertain} onClick={remove}>{deleteLabel}</button>}{retryNote}</div></div>;

  return <div className={styles.console} data-kind={session.kind}>
    <div className={styles.consoleHead}><div><p className={styles.eyebrow}>{challengeKindLabel(session.kind)} · 第 {session.revision} 版</p>
      <h2>{session.kind === "EVIDENCE" ? "给这句话，找回原记录" : session.kind === "REHEARSAL" ? "把这版稿，讲清楚" : "两条记录，能不能直接比？"}</h2></div>
      <div className={styles.consoleActions}>{session.status === "COMPLETED" && <span className={styles.stageMark}>已完成</span>}
        {session.handoffSourceId && <button type="button" className={styles.secondary} disabled={busy || uncertain || !outputId} onClick={() => start(session.kind)}>再开一轮</button>}
        {session.status === "ACTIVE" && <button type="button" className={styles.secondary} disabled={busy || uncertain} onClick={stop}>退出本轮</button>}</div></div>
    {session.kind === "EVIDENCE" && <EvidenceView session={session} sources={sources} busy={busy} uncertain={uncertain} readerKey={activeReaderKey} closeReader={closeReader}
      choices={selected} setChoice={setChoice} clearChoices={clearChoices} openSource={openSource} handoff={handoff}
      latestOutput={latestOutput} phase={phase} phaseLabel={phaseLabel} onOpenRevision={onOpenRevision} celebrate={celebrate} />}
    {session.kind === "REHEARSAL" && <MentorView session={session} sources={sources} output={originalOutput} busy={busy} uncertain={uncertain}
      drafts={drafts} setDraft={(key, value) => setDrafts(current => ({ ...current, [key]: value }))} evidence={evidence}
      setEvidence={(key, value) => setEvidence(current => ({ ...current, [key]: value }))} openSource={openSource}
      readerKey={readerKey} setReaderKey={setReaderKey} answer={answer} handoff={handoff} latestOutput={latestOutput} phase={phase}
      phaseLabel={phaseLabel} onOpenRevision={onOpenRevision} celebrate={celebrate} />}
    {session.kind === "METRIC" && <MetricView session={session} sources={sources} busy={busy} uncertain={uncertain} choices={selected}
      setChoice={(key, value) => setChoices(current => ({ ...current, [session.questions[0]?.key ?? ""]: value ? [key] : [] }))}
      handoff={handoff} latestOutput={latestOutput} phase={phase} phaseLabel={phaseLabel} onOpenRevision={onOpenRevision} celebrate={celebrate} />}
    {session.kind === "EVIDENCE" && <div className={styles.verifyBar}><div><strong>{selected.length ? "已选 " + selected.length + " 条" : "还没有选择引用"}</strong>
      <span>{session.status === "COMPLETED" ? "本轮已核对；内容仍待核验。" : "核对只比较引用关系，不在前端判定答案。"}</span></div>
      <div><button type="button" className={styles.quietAction} disabled={busy || uncertain} onClick={remove}>{deleteArmed ? "确认删除回答" : "删除本轮回答"}</button>
        {session.status === "ACTIVE" && <button type="button" className={styles.primary} disabled={busy || uncertain || !selected.length} onClick={verify}>
          {busy ? <><Loader2 size={15} className={styles.spin} aria-hidden />核对中…</> : <><Check size={15} aria-hidden />核对引用</>}</button>}</div></div>}
    {session.kind !== "EVIDENCE" && <div className={styles.roundTools}>
      <button type="button" className={styles.quietAction} disabled={busy || uncertain} onClick={remove}>{deleteLabel}</button></div>}
    {error && <p role="alert" className={styles.error}><AlertTriangle size={15} aria-hidden />{error}</p>}
    {uncertain && !busy && <button type="button" className={styles.retry} onClick={retry}><RotateCcw size={14} aria-hidden />重试原请求</button>}
  </div>;
}
