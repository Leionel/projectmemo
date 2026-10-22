import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowRight, BookOpen, Check, ChevronRight, FileText, Fingerprint, Laptop, Smartphone, GitBranch, Waypoints } from "lucide-react";
import { getSessionUser } from "@/lib/auth/serverSession";
import { HomeJourney } from "@/components/HomeJourney";
import { HomeMotion } from "@/components/HomeMotion";
import styles from "./home.module.css";

export const metadata: Metadata = {
  title: "忆程 ProjectMemo｜你的个人项目 Agent",
  description: "为大学生的竞赛、科研与课程项目，留住过程、找回依据、看清变化、接续行动。忆程是你的个人项目 Agent。",
};

const moments = [
  { scene: "竞赛备赛", title: "从灵感到答辩，每一步都有来路。", text: "把讨论、材料要求和实验结果留在项目里。准备汇报时，沿着来源找回做过的工作。", detail: "参赛要求 → 项目进展 → 汇报草稿" },
  { scene: "科研训练", title: "实验做过很多轮，经验还能接着用。", text: "保留实验记录与方案变化。再看一个结论时，知道它来自哪里，哪些依据还需要补齐。", detail: "论文笔记 → 实验记录 → 阶段复盘" },
  { scene: "课程设计", title: "交付作品，也留下自己的成长。", text: "串起需求、问题与解决过程，把行动结果沉淀为项目记忆，整理出属于你的项目总结。", detail: "任务拆解 → 行动回执 → 项目总结" },
];

export default async function Home() {
  const user = await getSessionUser();
  const startHref = user ? "/focus" : "/login?from=%2Ffocus";
  return (
    <main id="main-content" className={styles.home}>
      <HomeMotion>
      <section className={styles.hero} aria-labelledby="home-heading">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}><span /> 忆程，你的个人项目 Agent</p>
          <h1 id="home-heading"><span className={styles.headlineChinese}>你的个人项目</span><span className={styles.agentWord}>Agent<span>。</span></span></h1>
          <p className={styles.lead}>记得来路，接得上下一步。</p>
          <p className={styles.intro}>离开项目一阵子，再回来，也知道自己做到了哪、接下来该做什么。从一条笔记、一次实验到一份成果，让自己的积累持续向前。</p>
          <div className={styles.heroActions}>
            <Link href={startHref} className={styles.primary}>{user ? "回到我的工作台" : "开始我的项目"}<ArrowRight size={18} /></Link>
            <a href="#experience" className={styles.textLink}>看看忆程怎么帮你<ArrowDown size={16} /></a>
          </div>
          <div className={styles.audience}><span>为大学生的长期项目而做</span><span>竞赛 · 科研 · 课程设计</span></div>
        </div>
        <HomeJourney />
      </section>

      <section id="experience" data-reveal className={styles.experience} aria-labelledby="experience-heading">
        <div className={styles.sectionHeading}>
          <p className={styles.kicker}>从“我记过”到“我能继续”</p>
          <h2 id="experience-heading">陪你推进的，<br />是同一个项目。</h2>
          <p>记录散落在不同时间，行动却需要接在一起。<br />让个人 Agent 带着项目的来路，帮你理清现在。</p>
        </div>
        <div className={styles.workflow}>
          {[
            ["留下过程", "笔记、会议、图片与 PDF，都能成为项目的原始材料。", "记录"],
            ["找回依据", "把材料整理为项目记忆，回看结论时能找到原始来源。", "记忆"],
            ["看清变化", "关注期限、风险与停滞；提醒附带原因，供你判断。", "提醒"],
            ["接续行动", "确认下一步，记录完成结果，再沉淀回自己的项目。", "复盘"],
          ].map(([title, text, label], index) => <div key={title} className={styles.workflowItem}>
            <div className={styles.workflowTop}><span>{label}</span>{index < 3 && <ChevronRight size={18} aria-hidden="true" />}</div>
            <h3>{title}</h3><p>{text}</p>
          </div>)}
        </div>
      </section>

      <section data-reveal className={styles.capabilities} aria-labelledby="capabilities-heading">
        <div className={styles.sectionTop}><div><p className={styles.kicker}>记忆在积累，项目在推进</p><h2 id="capabilities-heading">个人 Agent，<br />多走一步的能力。</h2></div><p>记住项目，也关注变化。<br />把一个目标，接到可以继续做的事上。</p></div>
        <div className={styles.capabilityGrid}>
          <article className={styles.missionFeature}>
            <span className={styles.featureIcon}><Waypoints size={23} aria-hidden="true" /></span><p className={styles.featureEyebrow}>LONG-TERM MISSION · 长期委托</p>
            <h3>交代一次目标，<br />带着已有进展继续。</h3><p>让 Agent 围绕你的目标整理材料、形成草稿。缺少依据时提出问题，等待你补充后接续原委托。</p>
            <div className={styles.missionExample}><span>委托示例</span><p>用本项目已有材料，整理一份带来源的阶段汇报。</p><div><span><Check size={12} />读取项目记忆</span><span><Check size={12} />整理已有进展</span><span className={styles.waitingStep}>待补充实验结果</span></div></div>
            <span className={styles.featureFootnote}>重要操作，仍由你确认。</span>
          </article>
          <article className={styles.sourceFeature}>
            <span className={styles.featureIcon}><GitBranch size={23} aria-hidden="true" /></span><p className={styles.featureEyebrow}>TRACEABLE MEMORY · 来源追溯</p>
            <h3>一份成果，<br />找得到它的来路。</h3><p>保留原始记录与附件，把成果里的已知事实和缺失依据分别说清楚。</p>
            <div className={styles.sourceDiagram} aria-label="成果可追溯到实验记录、会议纪要和论文笔记"><div><FileText size={17} />阶段汇报草稿</div><span className={styles.branchLine} /><ul><li>实验记录</li><li>会议纪要</li><li>论文笔记</li></ul></div>
          </article>
        </div>
        <div className={styles.changeFeature}><div><p className={styles.featureEyebrow}>PROJECT EVOLUTION · 状态变化</p><h3>项目变了什么，回头就看得清。</h3><p>把新增事实、方案调整与待确认变化放在一起，保留项目走过的轨迹。</p></div><div className={styles.changeExample}><span>原方案</span><span>设备限制有变化</span><ArrowRight size={18} aria-hidden="true" /><strong>待你确认调整</strong></div></div>
      </section>

      <section id="moments" data-reveal className={styles.moments} aria-labelledby="moments-heading">
        <div className={styles.sectionTop}><div><p className={styles.kicker}>你的目标，有自己的节奏</p><h2 id="moments-heading">把每一程，留给下一程。</h2></div><p>一个人也会经历很多阶段。<br />让过去的积累，成为下一次出发的依据。</p></div>
        <div className={styles.momentGrid}>{moments.map(moment => <article key={moment.scene}>
          <p className={styles.sceneLabel}>{moment.scene}</p><h3>{moment.title}</h3><p>{moment.text}</p><div className={styles.momentDetail}>{moment.detail}</div>
        </article>)}</div>
      </section>

      <section id="principles" data-reveal className={styles.principles} aria-labelledby="principles-heading">
        <div><Fingerprint size={28} aria-hidden="true" /><p className={styles.kicker}>个人 Agent，决定权在你</p><h2 id="principles-heading">帮你理清，<br />由你决定。</h2><p>忆程围绕你的项目提供建议，<br />也把依据、缺口和需要确认的事讲清楚。</p></div>
        <ul>
          <li><BookOpen size={20} aria-hidden="true" /><div><h3>结论有来源</h3><p>回到原始记录与附件，核对信息的来路。</p></div></li>
          <li><FileText size={20} aria-hidden="true" /><div><h3>缺口有说明</h3><p>已知事实、缺失依据和成果草稿分别展示。</p></div></li>
          <li><Check size={20} aria-hidden="true" /><div><h3>重要变更由你确认</h3><p>Agent 提议行动，你确认后才应用到项目中。</p></div></li>
        </ul>
      </section>

      <section data-reveal className={styles.platforms} aria-labelledby="platforms-heading">
        <div><p className={styles.kicker}>同一个项目，随时接续</p><h2 id="platforms-heading">电脑上梳理，<br />手机上接着做。</h2><p>Web 与鸿蒙客户端连接同一项目后端。<br />资料、提醒与行动围绕同一份项目记录展开。</p></div>
        <div className={styles.platformList}>
          <div><Laptop size={28} aria-hidden="true" /><div><h3>Web 工作台</h3><p>梳理材料、查看来源、整理成果。</p></div></div>
          <div><Smartphone size={28} aria-hidden="true" /><div><h3>HarmonyOS 客户端</h3><p>记录进展、查看提醒、接续行动。</p></div></div>
        </div>
      </section>

      <section data-reveal className={styles.closing}>
        <p>忆程 ProjectMemo · 你的个人项目 Agent</p><h2>下一步，从你的项目开始。</h2>
        <Link href={startHref} className={styles.primary}>{user ? "回到我的工作台" : "开始我的项目"}<ArrowRight size={18} /></Link>
      </section>
      <footer className={styles.footer}><Link href="/">忆程 ProjectMemo</Link><span>沉淀每一步，推进下一程。</span><a href="#home-heading">回到顶部 ↑</a></footer>
      </HomeMotion>
    </main>
  );
}
