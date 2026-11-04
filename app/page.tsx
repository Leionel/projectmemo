import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  Laptop,
  Smartphone,
} from "lucide-react";
import { getSessionUser } from "@/lib/auth/serverSession";
import { HomeJourney } from "@/components/HomeJourney";
import { DemoVideoPlayer } from "@/components/home/DemoVideoPlayer";
import { HomeResumeCard } from "@/components/home/HomeResumeCard";
import { HomeMotion } from "@/components/home/HomeMotion";
import { exampleProject } from "@/components/home/homeExample";
import styles from "./home.module.css";

export const metadata: Metadata = {
  title: "忆程 ProjectMemo｜人可以下线，项目别掉线。",
  description:
    "面向大学生的个人项目 Agent。目标、材料和判断依据留在原处；回来时先看原委托做到哪、依据是什么、现在等你决定什么。公开示例可在本页亲手走一遍。",
};

const GITHUB_URL = "https://github.com/Leionel/projectmemo";

const DEMO_VIDEO_URL =
  "https://www.bilibili.com/video/BV1Qaxb6PE7G?vd_source=eaf1b5590706fdf5d967f5f1d697db8b";

const continuitySteps = [
  {
    label: "来源",
    title: "3 条来源保留原文",
    text: "比赛材料、任务安排、老师建议，随时可以回到原文核对。",
  },
  {
    label: "变化",
    title: "发现一处没有回执",
    text: "演示流程是否跑通，现有材料无法确认。",
    state: "waiting" as const,
  },
  {
    label: "判断改变",
    title: "先补演示结果，再写汇报",
    text: "原来：先按比赛材料写汇报草稿。",
    state: "waiting" as const,
    emphasis: true,
  },
  {
    label: "等你",
    title: "补充结果，或审阅提案",
    text: "原任务、来源和草稿都保留，不另建一个新任务。",
    state: "waiting" as const,
  },
];

const scenarios = [
  { title: "竞赛备赛", text: "实验记录、报名要求和答辩材料放在同一个项目里，整理汇报时能回看来源。", tags: ["实验记录", "报名要求", "答辩材料"] },
  { title: "科研训练", text: "方案为什么改过、结论用了哪些实验记录、哪些问题还没有依据，都查得清。", tags: ["方案变更", "结论依据", "未决问题"] },
  { title: "课程设计", text: "需求、问题和修改过程都保留下来，完成一项行动后，结果接回项目历史。", tags: ["需求", "修改过程", "完成回执"] },
];

export default async function Home() {
  const user = await getSessionUser();
  const workspaceHref = user ? "/focus" : "/login?from=%2Ffocus";
  const workspaceLabel = user ? "回到我的工作台" : "进入工作台";

  return (
    <main id="main-content" className={styles.home} tabIndex={-1}>
      <div className={styles.scrollProgress} data-scroll-progress aria-hidden="true" />
      <section
        id="home-heading"
        className={styles.hero}
        aria-labelledby="hero-title"
        data-hero
      >
        <div className={styles.heroInner}>
          <div className={styles.heroCopy} data-hero-copy>
            <p className={styles.positioning}>
              <span>面向大学生的</span>
              <strong>个人项目 Agent</strong>
            </p>
            <h1 id="hero-title" className={styles.headline}>
              人可以下线，
              <span>项目别掉线。</span>
            </h1>
            <p className={styles.heroSub}>
              关掉页面，目标、材料和判断依据都留在原处。回来时先看原委托做到哪、依据是什么，再决定下一步。
            </p>
            <div className={styles.heroActions}>
              <Link className={styles.ctaPrimary} href={workspaceHref}>
                {workspaceLabel}
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <a className={styles.ctaSecondary} href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                在 GitHub 查看源码
                <ArrowUpRight size={16} aria-hidden="true" />
              </a>
            </div>
            <p className={styles.heroNote}>
              Web 工作台 · 鸿蒙客户端 · 同一个项目后端
            </p>
          </div>
          <HomeResumeCard />
        </div>
      </section>

      <section
        id="flow"
        className={styles.section}
        aria-labelledby="continuity-title"
      >
        <div className={styles.shell}>
          <header className={styles.sectionHead}>
            <h2 id="continuity-title">
              新情况出现时，
              <br className={styles.mobileBreak} />
              它带着出处回来。
            </h2>
            <p className={styles.sectionIntro}>
              同一个委托里，来源、判断和等你决定的那一步都留在原处。
            </p>
          </header>

          <div className={styles.railFrame} data-rail>
            <ol className={styles.rail}>
              {continuitySteps.map((step) => (
                <li
                  className={styles.railStep}
                  key={step.label}
                  data-rail-step
                  data-state={step.state}
                  data-emphasis={step.emphasis ? "true" : undefined}
                >
                  <p className={styles.railLabel}>{step.label}</p>
                  <h3>{step.title}</h3>
                  <p className={styles.railText}>{step.text}</p>
                </li>
              ))}
            </ol>
            <span className={styles.railProgress} aria-hidden="true" />
          </div>

          <div className={styles.railFoot}>
            <details className={styles.conditions}>
              <summary>什么情况下才会自动接续？</summary>
              <p>
                实际执行需要启用委托功能、配置模型并授权使用相关资料。默认由你确认继续；后台自动接续还需要运行
                Worker、单独授权，并满足结构化材料等条件。自动接续只做读取与分析，创建行动仍由你确认。
              </p>
              <p>
                暂停后不会从头另建任务；继续前，服务端会重新检查授权、预算和材料是否仍然适用。
              </p>
            </details>
            <p className={styles.demoNote}>
              这一段是冻结的示例状态：不连接服务器，也不代表任务此刻正在执行。
            </p>
          </div>
          <a className={styles.flowLink} href="#experience">体验一段项目接续，无需登录<ArrowDown size={15} aria-hidden="true" /></a>
        </div>
      </section>
      <section id="missions" className={`${styles.section} ${styles.sectionTint}`} aria-labelledby="missions-title">
        <div className={`${styles.shell} ${styles.split}`}>
          <header className={styles.splitHead}>
            <h2 id="missions-title">长期委托会保留进度，<br className={styles.mobileBreak} />需要你时停下来。</h2>
            <p className={styles.sectionIntro}>比如“用已有材料整理阶段汇报”。步骤和草稿都在同一份委托里：缺材料就补来源，要批准就先核对提案。</p>
            <p className={styles.sectionIntro}>暂停后不会从头再来。继续之前，服务端会重新检查授权、预算和材料是否仍然适用。</p>
          </header>
          <article className={styles.missionCard} aria-label="公开示例：长期委托">
            <header><h3>整理参赛项目的阶段汇报</h3><span className={styles.missionWaiting}>等待补充材料</span></header>
            <ol className={styles.missionSteps}>
              <li data-state="done"><strong>读取项目记忆</strong><span>已找到参赛要求与任务安排</span></li>
              <li data-state="waiting"><strong>需要补充：{exampleProject.missing.title}</strong><span>{exampleProject.missing.detail}</span></li>
              <li data-state="next"><strong>继续整理汇报草稿</strong><span>补充材料并确认后继续</span></li>
            </ol>
            <div className={styles.missionActions} aria-hidden="true"><span>补充材料</span><span>查看草稿</span></div>
          </article>
        </div>
      </section>

      <section
        id="experience"
        className={`${styles.section} ${styles.sectionTint}`}
        aria-labelledby="experience-title"
      >
        <div className={styles.shell}>
          <header className={`${styles.sectionHead} ${styles.experienceHead}`}>
            <h2 id="experience-title">
              同一份素材，
              <br className={styles.mobileBreak} />
              走一遍接续。
            </h2>
            <p className={styles.sectionIntro}>
              从原始记录到模拟回执：先看依据，再确认行动。所有操作只影响本页。
            </p>
          </header>
          <HomeJourney />
        </div>
      </section>

      <section
        id="moments"
        className={styles.section}
        aria-labelledby="moments-title"
      >
        <div className={styles.shell}>
          <header className={styles.sectionHead}>
            <h2 id="moments-title">竞赛、科研、课程设计。</h2>
          </header>
          <ul className={styles.scenarioList}>
            {scenarios.map((scenario) => (
              <li key={scenario.title}>
                <h3>{scenario.title}</h3>
                <p>{scenario.text}</p>
                <p className={styles.scenarioTags}>{scenario.tags.map(tag => <span key={tag}>{tag}</span>)}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="platform-title">
        <div className={`${styles.shell} ${styles.split}`}>
          <header className={styles.splitHead}>
            <h2 id="platform-title">
              电脑上看依据，
              <br className={styles.mobileBreak} />
              手机上回应。
            </h2>
            <p className={styles.sectionIntro}>
              Web 工作台与鸿蒙客户端连到同一服务。同一个项目、同一条任务，换设备后仍从原位置继续。
            </p>
            <p className={styles.caption}>
              界面示意 · 实际可用范围取决于部署与授权
            </p>
          </header>
          <div className={styles.pathList}>
            <p className={styles.taskIdentity}>
              <span>同一任务</span>
              整理阶段汇报
              <span aria-hidden="true">·</span>
              公开示例
            </p>
            <div className={styles.pathGroup}>
              <div className={styles.pathTitle}>
                <Laptop size={18} aria-hidden="true" />
                <h3>Web 工作台</h3>
              </div>
              <p className={styles.pathLine}>
                <span>项目</span>
                <ChevronRight size={14} aria-hidden="true" />
                <span>依据与原文</span>
                <ChevronRight size={14} aria-hidden="true" />
                <span>结果写回</span>
              </p>
              <p className={styles.pathNote}>
                在电脑上核对较长材料，处理需要仔细读的那一步。
              </p>
            </div>
            <div className={styles.pathGroup}>
              <div className={styles.pathTitle}>
                <Smartphone size={18} aria-hidden="true" />
                <h3>鸿蒙客户端</h3>
              </div>
              <p className={styles.pathLine}>
                <span>项目</span>
                <ChevronRight size={14} aria-hidden="true" />
                <span>等待提醒</span>
                <ChevronRight size={14} aria-hidden="true" />
                <span>回应原委托</span>
              </p>
              <p className={styles.pathNote}>
                在手机上完成一次简短回应，回到电脑继续。
              </p>
            </div>
          </div>
          <figure className={styles.platformShot}>
            <figcaption><span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" />project.luojiatutor.xyz</figcaption>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/home/workspace-desktop.jpg" alt="忆程 Web 工作台：项目焦点与长期委托（公开示例截图）" width={1280} height={760} loading="lazy" />
          </figure>
        </div>
      </section>

      <section
        id="demo"
        className={styles.section}
        aria-labelledby="demo-title"
      >
        <div className={`${styles.shell} ${styles.demoSplit}`}>
          <header className={styles.splitHead}>
            <h2 id="demo-title">
              看一遍决赛演示。
            </h2>
            <p className={styles.sectionIntro}>
              2026 C4-AI 决赛演示视频。默认只显示本地画面；点击后在本页加载
              Bilibili 官方播放器，也可以在新窗口打开。
            </p>
          </header>
          <DemoVideoPlayer />
        </div>
      </section>
      <section className={styles.principles} aria-label="使用原则">
        <div className={styles.shell}>
          <ul>
            <li><h3>来源可以回看</h3><p>判断链接到原始记录和附件原件。</p></li>
            <li><h3>缺口会标出来</h3><p>没有依据的内容不写成结论，未知不当作否定。</p></li>
            <li><h3>重要操作先确认</h3><p>建议和提案经你确认后，才会改动项目。</p></li>
          </ul>
        </div>
      </section>

      <section className={styles.closing} aria-labelledby="closing-title">
        <div className={`${styles.shell} ${styles.closingInner}`}>
          <div>
            <h2 id="closing-title">
              让你的下一段长期项目，接得上。
            </h2>
            <p>从自己的项目开始。已有账号可以直接进入工作台。</p>
          </div>
          <div className={styles.closingActions}>
            <Link href={workspaceHref} className={styles.closingCta}>
              {workspaceLabel}
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
            {!user && <Link href="/login" className={styles.closingLink}>登录</Link>}
          </div>
          <a className={styles.githubCard} href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            <strong>Leionel/projectmemo</strong>
            <span>面向项目式学习的智能记忆与主动复盘助手，代码在 GitHub 公开。</span>
            <span className={styles.scenarioTags}><span>Next.js</span><span>TypeScript</span><span>Prisma</span><span>HarmonyOS ArkTS</span></span>
            <span className={styles.githubLink}>在 GitHub 查看<ArrowUpRight size={14} aria-hidden="true" /></span>
          </a>
        </div>
      </section>



      <footer className={styles.footer}>
        <div className={`${styles.shell} ${styles.footerInner}`}>
          <Link href="/" className={styles.footerBrand}>
            忆程 ProjectMemo
          </Link>
          <nav aria-label="页脚" className={styles.footerNav}>
            <a href="#experience">公开示例</a>
            <a
              href={DEMO_VIDEO_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="决赛演示（Bilibili，在新窗口打开）"
            >
              决赛演示
              <ArrowUpRight size={12} aria-hidden="true" />
            </a>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub<ArrowUpRight size={12} aria-hidden="true" /></a>
            <a href="#home-heading">回到顶部 ↑</a>
          </nav>
          <p className={styles.footerMeta}>竞赛 · 科研 · 课程项目</p>
        </div>
      </footer>
      <HomeMotion />
    </main>
  );
}
