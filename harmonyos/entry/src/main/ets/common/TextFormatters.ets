/**
 * 忆程 ProjectMemo 语义与文本本地化转换工具
 * 规约：面向最终用户的 UI 严禁直接输出内部枚举与未加工英文字段
 */

export class TextFormatters {
  /**
   * 判断一段文本是否明显包含历史编码/录入损坏。
   * 单个问号可能是正常标点，因此只拦截连续多个问号或 Unicode 替换字符。
   */
  static isUnreadableText(value: string): boolean {
    // 服务端可选字段可能是 null（模型声明为 string | undefined），这里兜底避免崩溃。
    if (!value) {
      return false;
    }
    if (value.includes('\uFFFD')) {
      return true;
    }
    const questionMatches = value.match(/\?/g);
    if (questionMatches === null || questionMatches.length < 3) {
      return false;
    }
    const cjkMatches = value.match(/[\u3400-\u9FFF]/g);
    return cjkMatches === null || questionMatches.length > cjkMatches.length;
  }

  /**
   * 面向用户展示文本时，不能把损坏的原始字符串伪装成正常内容。
   */
  static readableText(value: string, fallback: string = '这条记录文本无法读取，请重新录入。'): string {
    if (!value) {
      return '';
    }
    return TextFormatters.isUnreadableText(value) ? fallback : value;
  }

  /**
   * 规范化标题和摘要，专门用于判断是否存在重复展示。
   * 不改写原始数据，只减少移动端上的重复信息。
   */
  static normalizeText(value: string): string {
    return value.trim().replace(/\s+/g, ' ').replace(/[。．.]+$/g, '');
  }

  static shouldShowSummary(title: string, summary: string): boolean {
    const normalizedSummary = TextFormatters.normalizeText(summary);
    if (normalizedSummary === '') {
      return false;
    }
    return TextFormatters.normalizeText(title) !== normalizedSummary;
  }

  /**
   * 标记标题、摘要或原始采集文本损坏的记忆，供列表降级展示。
   */
  static isDamagedMemory(title: string, summary: string, rawText: string = ''): boolean {
    return TextFormatters.isUnreadableText(title) ||
      TextFormatters.isUnreadableText(summary) ||
      TextFormatters.isUnreadableText(rawText);
  }

  /**
   * 对成果 Markdown 做逐行保护，保留列表结构并替换不可读的历史记录行。
   */
  static readableMarkdown(value: string): string {
    const lines = value.split('\n');
    const result: string[] = [];
    let changed = false;
    for (const line of lines) {
      if (!TextFormatters.isUnreadableText(line)) {
        result.push(line);
        continue;
      }
      const marker = line.match(/^\s*(?:[-*•]\s+|\d+\.\s+|>\s*)/);
      const prefix = marker === null ? '' : marker[0];
      result.push(`${prefix}历史记录文本无法读取，请重新录入。`);
      changed = true;
    }
    return changed ? result.join('\n') : value;
  }

  /**
   * 触发规则 / 干预触发类型翻译
   */
  static triggerTypeToChinese(triggerType: string): string {
    const map: Record<string, string> = {
      'MATERIAL_GAP': '作品材料缺口',
      'EXPERIMENT_GAP': '实验验证缺口',
      'DELIVERABLE_GAP': '交付物证据缺口',
      'STALE_PROGRESS': '进展停滞风险',
      'PROJECT_STALE': '进展停滞风险',
      'CLOSE_TO_DEADLINE': '临近截止风险',
      'DEADLINE_NEAR': '临近截止风险',
      'RISK_UNHANDLED': '未处理风险',
      'RISK_CLUSTER': '多重风险聚集',
      'requirement_without_competition_outline': '已有参赛要求，但尚未形成作品说明',
      'experiment_log_missing': '尚未沉淀关键对照实验数据',
      'action_unclosed': '存在未闭环的待办行动',
      'deadline_nearing': '临近项目截止日期'
    };
    return map[triggerType] ?? (triggerType ? triggerType.replace(/_/g, ' ') : '主动提醒');
  }

  /**
   * 规则描述 / 事实规则翻译
   */
  static ruleDescriptionToChinese(rule: string): string {
    if (!rule) {
      return '基于项目事实与过程要求触发判断';
    }
    if (rule.includes('requirement_without_competition_outline') || rule.includes('MATERIAL_GAP')) {
      return '系统已记录参赛要求，但当前尚未生成对应作品说明大纲。';
    }
    if (rule.includes('EXPERIMENT_GAP') || rule.includes('experiment')) {
      return '系统检测到核心方法论已有设计，但尚未形成完整消融或对比实验证据。';
    }
    if (rule.includes('STALE_PROGRESS') || rule.includes('stale')) {
      return '连续超过 72 小时无新实验或记忆沉淀，建议推进下一步。';
    }
    if (rule.includes('CLOSE_TO_DEADLINE') || rule.includes('deadline')) {
      return '项目截止日期临近，核心交付物仍需闭环验证。';
    }
    return rule;
  }

  /**
   * 优先级映射为中文
   */
  static priorityToChinese(priority: number | string | undefined): string {
    const p = typeof priority === 'string' ? parseInt(priority.replace('P', ''), 10) : priority;
    if (p === 1) return '极高优先级';
    if (p === 2) return '高优先级';
    if (p === 3) return '中优先级';
    if (p === 4) return '普通优先级';
    if (p === 5) return '低优先级';
    return '普通优先级';
  }

  /**
   * 严重度映射为中文
   */
  static severityToChinese(severity: number): string {
    if (severity >= 4) return '高风险';
    if (severity >= 2) return '中优先级';
    return '低优先级';
  }

  /** 状态快照里的风险严重度：HIGH/MEDIUM/LOW 只留在数据与调试层 */
  static riskSeverityToChinese(severity: string): string {
    const map: Record<string, string> = {
      'HIGH': '高',
      'MEDIUM': '中',
      'LOW': '低'
    };
    return map[severity] ?? '待确认';
  }

  /**
   * 状态映射为中文
   */
  static statusToChinese(status: string): string {
    const map: Record<string, string> = {
      'TODO': '待开始',
      'DOING': '进行中',
      'DONE': '已完成',
      'OPEN': '待处理',
      'PENDING': '待处理',
      'ACCEPTED': '已采纳',
      'SNOOZED': '稍后提醒',
      'DISMISSED': '已忽略',
      'RESOLVED': '已解决',
      'COMPLETED': '已完成'
    };
    return map[status] ?? status;
  }

  /**
   * 成果类型映射为中文
   */
  static artifactTypeToChinese(type: string): string {
    const map: Record<string, string> = {
      'competition_outline': '作品说明大纲',
      'defense_ppt': '答辩 PPT 提纲',
      'weekly_report': '项目阶段周报',
      'readme': 'README 文档',
      'resume_description': '项目经历总结',
      'next_week_plan': '下阶段工作规划'
    };
    return map[type] ?? '交付成果';
  }

  /**
   * 记忆卡片类型映射为中文
   */
  static memoryTypeToChinese(type: string): string {
    const map: Record<string, string> = {
      'paper_note': '论文笔记',
      'experiment_log': '实验记录',
      'reflection': '阶段复盘',
      'meeting_note': '会议纪要',
      'code_issue': '代码问题',
      'requirement': '参赛要求',
      'pdf_attachment': 'PDF 附件',
      'image_attachment': '图片附件',
      'material_requirement': '参赛要求',
      'risk_alert': '项目风险'
    };
    return map[type] ?? '记忆';
  }

  /**
   * 准备项的用户可见名称。
   *
   * 不再随场景改写：`dashboard.readiness.items` 对所有场景都是同样六项应用内信号，
   * 写成「研究进展 67%」或「备赛准备度」都会让人以为这是对项目本身的评分。
   * 参数保留是为了让调用方继续显式传入场景，便于将来服务端按场景区分口径。
   */
  static projectProgressLabel(_scenario: string): string {
    return '项目内准备项';
  }

  /**
   * 项目内准备项的计算口径。
   *
   * 六项全部来自服务端 `dashboard.readiness.items`，这里只解释「怎样才算已形成」，
   * 不参与计数。这六项是应用内信号（记忆、行动回执、成果草稿是否存在），
   * 不核验可安装 HAP、作品说明 PDF 或演示 MP4，因此不能读作复赛提交已通过验收。
   */
  static readinessCriterion(key: string): string {
    const map: Record<string, string> = {
      'requirement': '存在「参赛要求」类型的项目记忆',
      'experiment': '存在「实验记录」类型的项目记忆',
      'closed_loop': '有已完成行动，且完成回执已回写为结果记忆',
      'competition_outline': '存在作品说明大纲成果（可能仍是草稿）',
      'defense_ppt': '存在答辩 PPT 提纲成果（可能仍是草稿）',
      'readme': '存在 README 草稿成果'
    };
    return map[key] ?? '服务端未提供这一项的计算口径';
  }

  /** 成果类三项即使存在也可能只是草稿，措辞必须区分 */
  static readinessStateLabel(key: string, complete: boolean): string {
    if (!complete) {
      return '待形成';
    }
    if (key === 'competition_outline' || key === 'defense_ppt' || key === 'readme') {
      return '草稿已形成';
    }
    return '已形成';
  }

  /**
   * 状态未知项的前台文案。
   *
   * 服务端 `project.stage` 未知项原文是「系统尚未记录用户确认的项目阶段」，但项目场景
   * 在创建时就由用户选定，继续写「项目阶段待确认」会与已标注的场景自相矛盾；真正尚未
   * 确认的是本阶段检查点版本。App 内也没有「确认项目阶段」的设置项，因此把建议动作
   * 指向确实存在的阶段检查点，而不是指向一个点不到的入口。
   */
  static stateUnknownText(predicate: string, fallback: string): string {
    if (predicate === 'project.stage') {
      return '本阶段检查点尚未确认';
    }
    return fallback;
  }

  static stateUnknownAction(predicate: string, fallback: string): string {
    if (predicate === 'project.stage') {
      return '整理并确认这一阶段的检查点';
    }
    return fallback;
  }

  /** 状态变化类型的中文读法：英文枚举只留在数据与调试层 */
  static stateDiffKindToChinese(kind: string): string {
    const map: Record<string, string> = {
      'ADDED': '新增',
      'CHANGED': '变化',
      'RESOLVED': '已解决',
      'REGRESSED': '回退',
      'UNCERTAIN': '待确认'
    };
    return map[kind] ?? '其他变化';
  }

  /** 证据实体类型的中文读法 */
  static evidenceKindToChinese(kind: string): string {
    const map: Record<string, string> = {
      'card': '记忆',
      'action': '行动',
      'deliverable': '交付物',
      'attachment': '附件'
    };
    return map[kind] ?? '项目记录';
  }

  /**
   * 依据行：只有确实存在来源时才说「来源可查看」。
   * 没有来源计数时写「依据待查看」，绝不默认「来源已校对」——来源存在也只说明可追溯，
   * 不等于结论已被证实。
   */
  static evidenceCountLine(factCount: number, cardCount: number): string {
    const total = factCount + cardCount;
    if (total <= 0) {
      return '依据待查看';
    }
    return `依据 ${total} 条 · 来源可查看`;
  }

  /**
   * 场景类型映射为中文
   */
  static scenarioToChinese(scenario: string): string {
    const map: Record<string, string> = {
      'COMPETITION': '学术备赛',
      'RESEARCH': '学术课题',
      'COURSE_DESIGN': '课程设计',
      'INNOVATION': '创新项目',
      'LAB_TASK': '实验任务',
      'HACKATHON': '创客黑客松'
    };
    return map[scenario] ?? '项目档案';
  }
}
