import { exampleProject } from "./homeExample";
import styles from "@/app/home.module.css";

/** 首屏接续卡：同一份公开示例，展示“上次停在哪、依据是什么、判断怎么变了”。只是示意，不连接服务端。 */
export function HomeResumeCard() {
  const sources = [...exampleProject.sources].sort((a, b) => a.date.localeCompare(b.date));
  return <div className={styles.resumeStack} data-tilt data-spot data-hero-lens><article className={styles.resumeCard} aria-label="公开示例：回到项目时看到的接续卡">
    <header className={styles.resumeHead}><strong>{exampleProject.project}</strong><span>更新于 2026/10/23</span></header>
    <div className={styles.resumeStop}>
      <p>上次停在</p>
      <div><strong>{exampleProject.missing.title}</strong><span className={styles.resumeWaiting}>待确认</span></div>
    </div>
    <ol className={styles.resumeSources}>
      {sources.map(source => <li key={source.id}><p><strong>{source.title}</strong><time>{source.date}</time></p><span>{source.detail}</span></li>)}
    </ol>
    <div className={styles.resumeChange}>
      <p>判断改变</p>
      <span className={styles.resumeWas}>原来：<s>先按比赛材料写汇报草稿</s></span>
      <strong className={styles.resumeNow}>先补演示结果，再写汇报</strong>
      <span className={styles.resumeRefs}><span>任务安排</span><span>比赛材料</span></span>
    </div>
    <a className={styles.resumeGo} href="#experience">亲手走一遍这段接续</a>
    <p className={styles.resumeNote}>{exampleProject.boundary}</p>
  </article></div>;
}
