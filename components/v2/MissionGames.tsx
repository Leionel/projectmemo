"use client";
import { ArrowLeft, FileSearch, LineChart, MessagesSquare, Users } from "lucide-react";
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
export const GAME_ENTRIES: ReadonlyArray<{ key: GameTab; label: string; icon: typeof FileSearch }> = [
  { key: "EVIDENCE", label: "证据侦探", icon: FileSearch },
  { key: "REHEARSAL", label: "交付彩排", icon: MessagesSquare },
  { key: "SPRINT", label: "双人冲刺", icon: Users },
];
const TABS = [...GAME_ENTRIES, { key: "METRIC" as const, label: "指标可比性", icon: LineChart }];

export function MissionGames({ missionId, snapshot, output, latestOutput, tab, onTab, onExit, onHandoff, onOpenRevision, onPauseMission, onDirective }: Props) {
  const version = latestOutput ? "最新第 " + latestOutput.revision + " 版" : "尚无成果版本";
  return <section className={styles.shell} aria-label="成果玩法工作区">
    <header className={styles.header}>
      <div className={styles.context}>
        <button type="button" onClick={onExit}><ArrowLeft size={16} aria-hidden />返回成果</button>
        <div className={styles.project}><strong>{snapshot.projectTitle}</strong><span>{snapshot.goal}</span></div>
        <span className={styles.version}>{version}{latestOutput && <time dateTime={latestOutput.createdAt}>{evidenceTime(latestOutput.createdAt, true)}</time>}</span>
      </div>
      <nav className={styles.nav} aria-label="玩法切换">
        {TABS.map(({ key, label, icon: Icon }) =>
          <button type="button" key={key} aria-current={tab === key ? "page" : undefined} onClick={() => onTab(key)}>
            <Icon size={17} aria-hidden />{label}
          </button>)}
      </nav>
    </header>
    <div className={styles.stage}>
      {tab === "SPRINT" ? <ProjectSprint missionId={missionId} snapshot={snapshot} onOpenRevision={onOpenRevision}
        onPauseMission={onPauseMission} onDirective={onDirective} /> :
        <OutcomeChallenges missionId={missionId} outputId={output?.id} outputs={snapshot.outputs} latestOutput={latestOutput}
          kind={tab as ChallengeKind} sources={snapshot.sources} phase={snapshot.phase} phaseLabel={snapshot.reason}
          onKind={onTab} onHandoff={onHandoff} onOpenRevision={onOpenRevision} />}
    </div>
  </section>;
}

export type { GameTab };
