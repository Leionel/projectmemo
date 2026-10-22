import Link from "next/link";
import styles from "./ProjectWorkspace.module.css";

export function ProjectStartGuide({projectId,hasRecords,hasCards,missionsEnabled,hasActiveMission,stateEnabled}:{projectId:string;hasRecords:boolean;hasCards:boolean;missionsEnabled:boolean;hasActiveMission:boolean;stateEnabled:boolean}) {
  if (hasActiveMission) return null;
  const base=`/projects/${projectId}`;
  if (hasCards) return <section className={styles.startGuide} aria-label="从资料继续推进"><h3>资料已沉淀，接着做什么？</h3><p>先核对已有记忆和来源，再决定要交给忆程的目标。</p><div className={styles.quickActions}><Link href={stateEnabled?`${base}/health#project-state`:`${base}/knowledge`}>{stateEnabled?"查看当前项目判断":"查看记忆与来源"}</Link>{missionsEnabled&&<Link href={`${base}/missions`}>委托下一个目标</Link>}</div></section>;
  return <details className={styles.secondary}><summary>如何从第一条资料推进项目</summary><ol className={styles.journey}>
    <li><strong>{hasRecords?"资料已记录，核对处理结果":"留下真实资料"}</strong><p>{hasRecords?"原始资料已保存；前往资料页检查处理结果。记录保存不等于已经形成有效结论。":"记录实验、会议要求或项目进展，保留原文。"}</p><Link href={`${base}/records`}>{hasRecords?"查看资料处理结果":"记录或导入资料"}</Link></li>
    <li><strong>核对项目记忆和来源</strong><p>形成知识卡片后查看依据；未知信息保留为缺口。</p><Link href={`${base}/knowledge`}>查看项目记忆</Link></li>
    <li><strong>交给忆程一个目标</strong><p>{missionsEnabled?"选择可编辑的阶段汇报模板；权限由你明确确认。":"长期委托当前未开启，可继续使用资料、问答和行动。"}</p>{missionsEnabled&&<Link href={`${base}/missions`}>填写委托目标</Link>}</li>
  </ol></details>;
}
