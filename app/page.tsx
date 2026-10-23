import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  ChevronRight,
  FileText,
  Laptop,
  Smartphone,
} from "lucide-react";
import { getSessionUser } from "@/lib/auth/serverSession";
import { HomeJourney } from "@/components/HomeJourney";
import styles from "./home.module.css";

export const metadata: Metadata = {
  title: "忆程 ProjectMemo｜个人项目 Agent",
  description:
    "把竞赛、科研与课程项目的记录、来源和行动放在一起。查看已有进展与判断依据，确认下一步，并留下完成回执。",
};

export default async function Home() {
  const user = await getSessionUser();
  const workspaceHref = user ? "/focus" : "/login?from=%2Ffocus";
  const workspaceLabel = user ? "回到我的工作台" : "进入工作台";
  return (
    <main id="main-content" className={styles.home}>
      <section className={styles.hero} aria-labelledby="home-heading">
        <div className={styles.heroCopy}>
          <p className={styles.positioning}>面向大学生的个人项目 Agent</p>
          <h1 id="home-heading">
            项目隔了几天，
            <br />
            <span>再打开也接得上。</span>
          </h1>
          <p className={styles.heroDescription}>
            会议记录、实验结果、方案调整，都留在项目里。先看上次的进展与判断依据，再决定下一步。
          </p>
          <div className={styles.heroActions}>
            <a className={styles.primary} href="#experience">
              体验项目接续
              <ArrowDown size={16} aria-hidden="true" />
            </a>
            <Link className={styles.secondary} href={workspaceHref}>
              {workspaceLabel}
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
          <p className={styles.heroNote}>
            下方示例无需登录。个人项目在工作台中管理。
          </p>
        </div>
        <figure className={styles.heroProduct}>
          <div className={styles.imageToolbar}>
            <span>忆程工作区</span>
            <span>内置示例项目</span>
          </div>
          <picture>
            <source
              media="(max-width: 700px)"
              srcSet="/home/workspace-mobile.jpg"
            />
            <Image
              src="/home/workspace-desktop.jpg"
              alt="忆程实际工作区：项目风险状态、记录依据与下一步入口"
              width={1280}
              height={760}
              sizes="(max-width: 700px) 100vw, 1040px"
              priority
              unoptimized
            />
          </picture>
          <figcaption>实际工作区界面，使用内置示例数据。</figcaption>
        </figure>
      </section>

      <section
        id="experience"
        className={styles.storySection}
        aria-labelledby="story-heading"
      >
        <header className={styles.sectionHeading}>
          <div>
            <p className={styles.sectionLabel}>先用一段项目经历试试看</p>
            <h2 id="story-heading">
              准备参赛作品，
              <br className={styles.mobileBreak} />
              上次做到哪里了？
            </h2>
          </div>
          <p>
            示例取自项目自带的参赛素材。
            <br />
            从原始记录开始，看看依据、建议和完成结果如何关联。
          </p>
        </header>
        <HomeJourney />
      </section>

      <section
        id="missions"
        className={styles.missionSection}
        aria-labelledby="mission-heading"
      >
        <div className={styles.missionCopy}>
          <p className={styles.sectionLabel}>有些目标，需要分几次完成</p>
          <h2 id="mission-heading">
            长期委托会保留进度，
            <br />
            需要你时停下来。
          </h2>
          <p>
            比如“用已有材料整理阶段汇报”。你可以回看执行步骤和草稿；缺材料时补充来源，需要批准时先核对提案。
          </p>
          <p>
            暂停后不会从头另建一个任务。继续前，服务端会重新检查授权、预算和材料是否仍然适用。
          </p>
          <details className={styles.conditions}>
            <summary>哪些条件会影响执行？</summary>
            <p>
              实际执行需要启用委托功能、配置模型并授权使用相关资料。默认由你确认继续；后台自动接续还需要运行
              Worker、单独授权，并满足结构化材料等条件。这里的自动接续仅限读取与分析，创建行动仍需用户确认。
            </p>
          </details>
        </div>
        <div
          className={styles.missionPreview}
          aria-label="长期委托等待补充材料的界面示例"
        >
          <div className={styles.previewLabel}>
            <span>界面示例</span>
            <span className={styles.waitingBadge}>等待补充材料</span>
          </div>
          <h3>整理参赛项目的阶段汇报</h3>
          <p className={styles.previewDescription}>
            已有步骤和草稿保留在同一份委托里。
          </p>
          <ol className={styles.executionList}>
            <li>
              <span className={styles.completedNode}>✓</span>
              <div>
                <strong>读取项目记忆</strong>
                <span>已找到参赛要求与任务安排</span>
              </div>
            </li>
            <li>
              <span className={styles.currentNode}>?</span>
              <div>
                <strong>需要补充：演示流程的实际结果</strong>
                <span>目前没有完成回执，不能确认流程已跑通</span>
              </div>
            </li>
            <li>
              <span className={styles.pendingNode} />
              <div>
                <strong>继续整理汇报草稿</strong>
                <span>补充材料并确认后，再检查是否能够继续</span>
              </div>
            </li>
          </ol>
          <p className={styles.previewFootnote}>
            这是界面说明，未启动委托或执行模型任务。
          </p>
        </div>
      </section>

      <section
        id="moments"
        className={styles.scenarios}
        aria-labelledby="scenarios-heading"
      >
        <div>
          <p className={styles.sectionLabel}>项目里的具体用处</p>
          <h2 id="scenarios-heading">
            竞赛、科研和课程项目，
            <br />
            都有值得保留的过程。
          </h2>
        </div>
        <dl>
          <div>
            <dt>竞赛备赛</dt>
            <dd>
              把实验记录、报名要求和答辩材料放回同一个项目，整理汇报时能回看来源。
            </dd>
          </div>
          <div>
            <dt>科研训练</dt>
            <dd>
              查清方案为什么改过、结论用了哪些实验记录，以及哪些问题还没有依据。
            </dd>
          </div>
          <div>
            <dt>课程设计</dt>
            <dd>
              保留需求、问题和修改过程，完成一项行动后，把结果接回项目历史。
            </dd>
          </div>
        </dl>
      </section>

      <section
        className={styles.platformSection}
        aria-labelledby="platform-heading"
      >
        <div>
          <p className={styles.sectionLabel}>电脑和手机上的同一个项目</p>
          <h2 id="platform-heading">
            资料在电脑上整理，
            <br />
            进展也能在手机上查看。
          </h2>
          <p>
            Web
            与鸿蒙客户端使用同一项目后端。客户端连到同一服务并登录相应账号后，可以接着查看项目资料与行动。
          </p>
        </div>
        <div className={styles.platformPaths}>
          <div>
            <Laptop size={20} aria-hidden="true" />
            <h3>Web 工作台</h3>
            <p>
              项目
              <ChevronRight size={13} />
              记录与资料
              <ChevronRight size={13} />
              查看原件
            </p>
          </div>
          <div>
            <Smartphone size={20} aria-hidden="true" />
            <h3>鸿蒙客户端</h3>
            <p>
              项目
              <ChevronRight size={13} />
              资料
              <ChevronRight size={13} />
              附件原件
            </p>
          </div>
        </div>
      </section>

      <aside
        id="principles"
        className={styles.boundaryNote}
        aria-label="使用边界"
      >
        <FileText size={18} aria-hidden="true" />
        <p>
          来源可以回看；没有依据的内容会标明缺口。建议需要你判断，重要操作在确认后才应用。模型分析和委托执行取决于实际配置。
        </p>
      </aside>
      <section className={styles.closing}>
        <div>
          <h2>从自己的项目开始。</h2>
          <p>已有账号可以直接进入工作台。</p>
        </div>
        <Link href={workspaceHref} className={styles.primary}>
          {workspaceLabel}
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </section>
      <footer className={styles.footer}>
        <Link href="/">忆程 ProjectMemo</Link>
        <span>竞赛 · 科研 · 课程项目</span>
        <a href="#home-heading">回到顶部 ↑</a>
      </footer>
    </main>
  );
}
