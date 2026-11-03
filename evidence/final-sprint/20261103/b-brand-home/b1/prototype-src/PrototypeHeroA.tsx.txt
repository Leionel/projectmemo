'use client';

import { useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ChevronDown, FileText } from 'lucide-react';
import { exampleProject } from './homeExample';
import styles from './prototype.module.css';

const stages = [
  { id: 'away', label: '离开时' },
  { id: 'during', label: '期间' },
  { id: 'back', label: '回来后' },
] as const;

type StageId = (typeof stages)[number]['id'];
type Question = '原委托' | '依据' | '变化' | '等你';
type Row = {
  label: Question;
  value: string;
  meta?: string;
  tone?: 'waiting';
};

const rowsByStage: Record<StageId, Row[]> = {
  away: [
    {
      label: '原委托',
      value: exampleProject.goal,
      meta: '目标由你确认，之后可以随时暂停',
    },
    {
      label: '依据',
      value: '比赛材料、任务安排、老师建议',
      meta: '3 条来源已保存',
    },
    {
      label: '变化',
      value: '刚确认目标，还没有新的核对',
      meta: '关掉页面不会丢掉这条委托',
    },
    { label: '等你', value: '暂不需要操作，下次回来从这里继续' },
  ],
  during: [
    { label: '原委托', value: exampleProject.goal, meta: '任务身份不变' },
    {
      label: '依据',
      value: '已读 3 条来源，只读取你确认过的材料',
      meta: '冻结的示例状态，不连接服务器',
    },
    {
      label: '变化',
      value: '发现缺口：演示流程还没有完成回执',
      meta: '缺口不会因为页面刷新被当成已完成',
      tone: 'waiting',
    },
    { label: '等你', value: '回来后处理；期间不改变项目内容' },
  ],
  back: [
    { label: '原委托', value: exampleProject.goal, meta: '任务与草稿都留在原处' },
    {
      label: '依据',
      value: '比赛材料、任务安排、老师建议',
      meta: '3 条来源可以回看原文',
    },
    {
      label: '变化',
      value: '演示流程缺少完成回执',
      meta: '原建议“先写汇报草稿”需要你确认是否仍然成立',
      tone: 'waiting',
    },
    {
      label: '等你',
      value: exampleProject.pending.title,
      tone: 'waiting',
    },
  ],
};

export function PrototypeHeroA() {
  const [stage, setStage] = useState<StageId>('back');
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);

  function selectStage(next: StageId, index: number) {
    setStage(next);
    tabs.current[index]?.focus();
  }

  function handleTabKey(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? stages.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + stages.length) % stages.length;
    selectStage(stages[next].id, next);
  }

  return (
    <section className={styles.hero} aria-labelledby="proto-a-heading">
      <div className={styles.copy}>
        <p className={styles.positioning}>
          <span>面向大学生的</span>
          <strong>个人项目 Agent</strong>
        </p>
        <h1 id="proto-a-heading" className={styles.headline}>
          人可以下线，
          <span>项目别掉线。</span>
        </h1>
        <p className={styles.sub}>
          关掉页面，目标、材料和判断依据都留在原处。回来时先看原委托做到哪、依据是什么，再决定下一步。
        </p>
        <div className={styles.actions}>
          <a className={styles.primaryBtn} href="#experience">
            体验一段项目接续
            <ArrowDown size={16} aria-hidden="true" />
          </a>
          <a className={styles.secondaryBtn} href="/login?from=%2Ffocus">
            进入工作台
            <ArrowRight size={16} aria-hidden="true" />
          </a>
        </div>
        <p className={styles.mockNote}>{exampleProject.boundary}</p>
      </div>

      <div className={styles.lens}>
        <header className={styles.lensTop}>
          <div className={styles.lensIdentity}>
            <p className={styles.kicker}>{exampleProject.label}</p>
            <h2 className={styles.lensTitle}>
              {exampleProject.project}
              <span>· {exampleProject.mission}</span>
            </h2>
          </div>
          <span className={styles.statusWaiting}>
            <span className={styles.statusDot} aria-hidden="true" />
            等你确认
          </span>
        </header>

        <div className={styles.stageTabs} role="tablist" aria-label="委托阶段">
          {stages.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`proto-a-tab-${item.id}`}
              aria-selected={stage === item.id}
              aria-controls="proto-a-panel"
              tabIndex={stage === item.id ? 0 : -1}
              ref={(node) => {
                tabs.current[index] = node;
              }}
              onClick={() => selectStage(item.id, index)}
              onKeyDown={(event) => handleTabKey(event, index)}
            >
              <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              {item.label}
            </button>
          ))}
        </div>

        <div
          className={styles.lensBody}
          id="proto-a-panel"
          role="tabpanel"
          aria-labelledby={`proto-a-tab-${stage}`}
          tabIndex={0}
        >
          <dl className={styles.questionList}>
            {rowsByStage[stage].map((row) => (
              <div className={styles.question} key={row.label} data-tone={row.tone}>
                <dt>{row.label}</dt>
                <dd>
                  {row.value}
                  {row.meta ? <span className={styles.questionMeta}>{row.meta}</span> : null}
                </dd>
              </div>
            ))}
          </dl>

          <div className={styles.lensActions}>
            <button
              type="button"
              className={styles.ghostButton}
              aria-expanded={evidenceOpen}
              aria-controls="proto-a-evidence"
              onClick={() => setEvidenceOpen((open) => !open)}
            >
              <FileText size={15} aria-hidden="true" />
              {evidenceOpen ? '收起依据' : '查看依据'}
              <ChevronDown
                size={15}
                aria-hidden="true"
                className={styles.chevron}
                data-open={evidenceOpen}
              />
            </button>
            <a className={styles.cardLink} href="#experience">
              回到原委托
              <ArrowRight size={15} aria-hidden="true" />
            </a>
          </div>

          {evidenceOpen ? (
            <div className={styles.evidencePanel} id="proto-a-evidence">
              <p className={styles.evidenceIntro}>
                以下原文来自内置示例素材，不读取你的项目。
              </p>
              <ul className={styles.sourceList}>
                {exampleProject.sources.map((source) => (
                  <li key={source.id}>
                    <p className={styles.sourceName}>
                      {source.title}
                      <span>{source.meta}</span>
                    </p>
                    <q>{source.detail}</q>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <footer className={styles.lensFoot}>
          与下方五步示例使用同一份素材
          <span aria-hidden="true">·</span>
          本页交互不调用模型
        </footer>
      </div>
    </section>
  );
}

export function PrototypeAnchor({ variant }: { variant: 'a' | 'b' }) {
  return (
    <section id="experience" className={styles.anchorPlaceholder} aria-label="五步示例位置说明">
      <p>
        原型 {variant.toUpperCase()} 只比较 Hero。生产首页的五步示例仍在原位置，主 CTA
        的落点与生产一致。
      </p>
    </section>
  );
}
