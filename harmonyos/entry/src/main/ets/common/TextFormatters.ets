/**
 * 忆程 ProjectMemo 语义与文本本地化转换工具
 * 规约：面向最终用户的 UI 严禁直接输出内部枚举与未加工英文字段
 */

export class TextFormatters {
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
    return map[type] ?? '知识记忆';
  }

  /**
   * 场景类型映射为中文
   */
  static scenarioToChinese(scenario: string): string {
    const map: Record<string, string> = {
      'COMPETITION': '学术备赛',
      'RESEARCH': '学术课题',
      'COURSE_DESIGN': '课程设计',
      'HACKATHON': '创客黑客松'
    };
    return map[scenario] ?? '项目档案';
  }
}
