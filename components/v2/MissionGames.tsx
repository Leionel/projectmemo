"use client";
import { ArrowLeft, FileSearch, LineChart, MessagesSquare, Users } from "lucide-react";
import { BookmarkSpiritAvatar } from "@/components/mascot/BookmarkSpirit";
import { evidenceTime } from "@/lib/client/sourceDisplay";
import type { ChallengeKind } from "@/lib/types/challenge";
import type { WorkbenchSnapshot, WorkbenchOutput } from "@/lib/types/workbench";
import { OutcomeChallenges } from "./OutcomeChallenges";
import { ProjectSprint } from "./ProjectSprint";
import styles from "./MissionGames.module.css";

type GameTab = "EVIDENCE" | "REHEARSAL" | "SPRINT" | "METRIC";
type Props = {
  missionId: string; snapshot: WorkbenchSnapshot; output: WorkbenchOutput | null; latestOutput: WorkbenchOutput | null;
  tab: GameTab; onTab: (tab: GameTab) => void; onExit: () => void; onHandoff: () => void | Promise<void>;
  onOpenRevision: (revision: number) => void; onPauseMission: () => Promise<void>;
  onDirective: (text: string) => Promise<{ applied: boolean; objective: string; message: string }>;
};
const ENTRIES: Array<{ key: GameTab; label: string; icon: typeof FileSearch }> = [
  { key: "EVIDENCE", label: "证据侦探", icon: FileSearch },
  { key: "REHEARSAL", label: "交付彩排", icon: MessagesSquare },
  { key: "SPRINT", label: "双人冲刺", icon: Users },
];

export function MissionGames({ missionId, snapshot, output, latestOutput, tab, onTab, onExit, onHandoff, onOpenRevision, onPauseMission, onDirective }: Props) {
  const version = latestOutput ? "第 " + latestOutput.revision + " 版 · " + evidenceTime(latestOutput.createdAt, true) : "尚无成果版本";
  return <section className={styles.shell} aria-label="成果玩法工作区">
    <aside className={styles.rail}>
      <div className={styles.brand}><BookmarkSpiritAvatar size={42} /><div><strong>书签精灵</strong><span>同一份成果，换一种核对</span></div></div>
      <nav aria-label="玩法切换">
        {ENTRIES.map(entry => { const Icon = entry.icon; return <button type="button" key={entry.key} aria-current={tab === entry.key ? "page" : undefined}
          onClick={() => onTab(entry.key)}><Icon size={17} aria-hidden />{entry.label}</button>; })}
        <span className={styles.railDivider}>另一种核对</span>
        <button type="button" aria-current={tab === "METRIC" ? "page" : undefined} onClick={() => onTab("METRIC")}><LineChart size={17} aria-hidden />指标可比性</button>
      </nav>
      <div className={styles.railFoot}><button type="button" onClick={onExit}><ArrowLeft size={16} aria-hidden />返回成果</button>
        <span>{version}</span></div>
    </aside>
    <div className={styles.stage}>
      <div className={styles.context}><span title={snapshot.goal}>{snapshot.projectTitle}<i>/</i>{snapshot.goal}</span><span className={styles.state}>{snapshot.reason}</span></div>
      {tab === "SPRINT" ? <ProjectSprint missionId={missionId} snapshot={snapshot} onOpenRevision={onOpenRevision}
        onPauseMission={onPauseMission} onDirective={onDirective} /> :
        <OutcomeChallenges missionId={missionId} outputId={output?.id} output={output} latestOutput={latestOutput}
          kind={tab as ChallengeKind} sources={snapshot.sources} phase={snapshot.phase} phaseLabel={snapshot.reason}
          onKind={onTab} onHandoff={onHandoff} onOpenRevision={onOpenRevision} />}
    </div>
  </section>;
}

export type { GameTab };
