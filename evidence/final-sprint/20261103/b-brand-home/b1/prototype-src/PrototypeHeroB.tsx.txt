'use client';

import { useState } from 'react';
import { ArrowDown, ArrowRight, ChevronDown, FileText } from 'lucide-react';
import { exampleProject } from './homeExample';
import styles from './prototype.module.css';

export function PrototypeHeroB() {
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const source = exampleProject.sources.find((item) => item.id === activeSource);

  return (
    <section className={styles.hero} aria-labelledby="proto-b-heading">
      <div className={styles.copy}>
        <p className={styles.positioning}>
          <span>面向大学生的</span>
          <strong>个人项目 Agent</strong>
        </p>
        <h1 id="proto-b-heading" className={styles.headline}>
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

        <div className={styles.lensBody}>
          <ol className={styles.chain}>
            <li className={styles.chainStep}>
              <span className={styles.stepMark} aria-hidden="true">
                01
              </span>
              <p className={styles.stepLabel}>来源</p>
              <p className={styles.stepTitle}>
                比赛材料要求有演示材料，任务安排写明“还没有完整 Demo”。
              </p>
              <div className={styles.chipRow}>
                {exampleProject.sources.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={styles.evidenceChip}
                    aria-expanded={activeSource === item.id}
                    aria-controls={`proto-b-source-${item.id}`}
                    onClick={() =>
                      setActiveSource((current) => (current === item.id ? null : item.id))
                    }
                  >
                    {item.title}
                    <ChevronDown
                      size={14}
                      aria-hidden="true"
                      className={styles.chevron}
                      data-open={activeSource === item.id}
                    />
                  </button>
                ))}
              </div>
              {source ? (
                <div className={styles.sourcePanel} id={`proto-b-source-${source.id}`}>
                  <p className={styles.sourceMeta}>{source.meta}</p>
                  <q>{source.detail}</q>
                  <p className={styles.sourceNote}>
                    原文来自内置示例素材，不读取你的项目。
                  </p>
                </div>
              ) : null}
            </li>

            <li className={styles.chainStep} data-emphasis="true">
              <span className={styles.stepMark} aria-hidden="true">
                02
              </span>
              <p className={styles.stepLabel}>变化</p>
              <p className={styles.stepTitle}>
                核对当前记录：{exampleProject.missing.title}缺失。
              </p>
              <p className={styles.stepNote}>{exampleProject.missing.detail}</p>
            </li>

            <li className={styles.chainStep}>
              <span className={styles.stepMark} aria-hidden="true">
                03
              </span>
              <p className={styles.stepLabel}>判断改变</p>
              <div className={styles.judgment}>
                <p className={styles.oldJudgment}>
                  <span>原来</span>先按比赛材料写汇报草稿
                </p>
                <p className={styles.newJudgment}>
                  <span>现在</span>先补演示结果，再写汇报
                </p>
              </div>
            </li>

            <li className={styles.chainStep}>
              <span className={styles.stepMark} aria-hidden="true">
                04
              </span>
              <p className={styles.stepLabel}>等你</p>
              <p className={styles.stepTitle}>{exampleProject.pending.title}</p>
              <p className={styles.stepNote}>
                任务、3 条来源和原判断都保留，确认后从原委托继续。
              </p>
            </li>
          </ol>

          <div className={styles.lensActions}>
            <a className={styles.cardLink} href="#experience">
              <FileText size={15} aria-hidden="true" />
              回到原委托
              <ArrowRight size={15} aria-hidden="true" />
            </a>
          </div>
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
