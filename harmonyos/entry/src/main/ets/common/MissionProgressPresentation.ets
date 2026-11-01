import { MissionSource, MissionStep } from '../models/Mission';

/**
 * 委托执行结果展示适配层。
 *
 * 服务端把工具结果整体 JSON.stringify 进 source.text（见 lib/mission/tools.ts 的
 * inspect_project / inspect_action），检索项目记忆的 source.id 形如 card:{uuid}。
 * 这里只做展示层转换：已识别且解析成功的结构 → 用户可读摘要；
 * 解析失败、截断或未知形状 → 通用结果视图；原文完整保留在技术诊断里，可复制。
 * 不生成数据里不存在的结论。
 */
export class MissionProgressPresentation {
  private static noisyKey(key: string): boolean {
    const k = key.toLowerCase();
    return k.endsWith('id') || k.endsWith('hash') || k.endsWith('version') || k.endsWith('at') ||
      k.includes('payload') || k.includes('pointer') || k === 'truncated' || k === 'nextcursor';
  }

  private static cap(text: string, limit: number): string {
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean.length > limit ? clean.substring(0, limit) + '…' : clean;
  }

  private static countBy(values: string[]): string {
    const counts: Map<string, number> = new Map();
    for (const v of values) { counts.set(v, (counts.get(v) ?? 0) + 1); }
    const labels: Record<string, string> = { 'DOING': '进行中', 'TODO': '待办', 'DONE': '已完成', 'CANCELLED': '已取消', 'SUCCEEDED': '已执行', 'FAILED': '失败', 'READY': '准备执行', 'UNKNOWN': '结果待核对' };
    const parts: string[] = [];
    counts.forEach((count: number, key: string) => {
      parts.push((labels[key] ?? key) + ' ' + count + ' 项');
    });
    return parts.join(' · ');
  }

  /** 结构化 JSON 的用户可读行；解析失败返回空数组。 */
  private static structuredLines(record: Record<string, Object>): string[] {
    const lines: string[] = [];
    try {
      if (record['project'] !== undefined && typeof record['project'] === 'object') {
        const project = record['project'] as Record<string, Object>;
        if (typeof project['title'] === 'string') { lines.push('项目：' + MissionProgressPresentation.cap(project['title'] as string, 40)); }
        if (typeof project['goal'] === 'string') { lines.push('目标：' + MissionProgressPresentation.cap(project['goal'] as string, 80)); }
      }
      if (record['actions'] !== undefined && record['actions'] !== null) {
        const actions = record['actions'] as Array<Object>;
        const statuses: string[] = [];
        for (const action of actions) {
          const row = action as Record<string, Object>;
          if (typeof row['status'] === 'string') { statuses.push(row['status'] as string); }
        }
        lines.push('行动：' + (statuses.length > 0 ? MissionProgressPresentation.countBy(statuses) : '暂无可推进项'));
      }
      if (record['results'] !== undefined && record['results'] !== null) {
        const rows = record['results'] as Array<Object>;
        const titles: string[] = [];
        for (const row of rows) {
          const item = row as Record<string, Object>;
          if (typeof item['title'] === 'string') { titles.push(MissionProgressPresentation.cap(item['title'] as string, 22)); }
          if (titles.length >= 2) { break; }
        }
        lines.push('找到 ' + rows.length.toString() + ' 条相关记忆' + (titles.length > 0 ? '：' + titles.join('、') : ''));
      }
      if (record['artifacts'] !== undefined && record['artifacts'] !== null) {
        const arts = record['artifacts'] as Array<Object>;
        if (arts.length > 0) { lines.push('相关成果 ' + arts.length.toString() + ' 项'); }
      }
      if (record['coverage'] !== undefined && typeof record['coverage'] === 'object') {
        const coverage = record['coverage'] as Record<string, Object>;
        if (typeof coverage['totalActions'] === 'number') { lines.push('项目内行动共 ' + (coverage['totalActions'] as number).toString() + ' 项'); }
        if (typeof coverage['matchedCards'] === 'number' && typeof coverage['returnedCards'] === 'number') {
          lines.push('匹配记忆 ' + (coverage['matchedCards'] as number).toString() + ' 条，本次返回 ' + (coverage['returnedCards'] as number).toString() + ' 条');
        }
      }
      if (typeof record['title'] === 'string' && lines.length < 3) { lines.push('标题：' + MissionProgressPresentation.cap(record['title'] as string, 60)); }
      if (typeof record['status'] === 'string' && lines.length < 3) {
        const labels: Record<string, string> = { 'DOING': '进行中', 'TODO': '待办', 'DONE': '已完成', 'CANCELLED': '已取消' };
        const status = record['status'] as string;
        lines.push('状态：' + (labels[status] ?? status));
      }
    } catch { return lines; }
    return lines;
  }

  /** 工具结果摘要：已识别结构给要点；文本或未知形状给安全摘述。 */
  static stepSummary(step: MissionStep): string {
    if (step.status !== 'SUCCEEDED') { return ''; }
    const data = step.result?.data;
    if (data === undefined || data === null) { return ''; }
    let record: Record<string, Object> | null = null;
    if (typeof data === 'string') {
      const raw = data as string;
      try {
        const parsed: Object = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null) { record = parsed as Record<string, Object>; }
        else { return MissionProgressPresentation.cap(raw, 120); }
      } catch { return MissionProgressPresentation.cap(raw, 120) + '（文本结果，完整内容见技术诊断）'; }
    } else if (typeof data === 'object') {
      try {
        const arr = data as Array<Object>;
        if (arr.length !== undefined && typeof arr.length === 'number') {
          const titles: string[] = [];
          for (const row of arr) {
            const item = row as Record<string, Object>;
            if (typeof item['title'] === 'string') { titles.push(MissionProgressPresentation.cap(item['title'] as string, 22)); }
            if (titles.length >= 2) { break; }
          }
          return '返回 ' + arr.length.toString() + ' 条记录' + (titles.length > 0 ? '：' + titles.join('、') : '');
        }
      } catch { record = data as Record<string, Object>; }
      record = data as Record<string, Object>;
    }
    if (record === null) { return ''; }
    const lines = MissionProgressPresentation.structuredLines(record);
    if (lines.length > 0) { return lines.join('；'); }
    // 未知形状：取最多 3 个非工程字段的原语值
    const fallback: string[] = [];
    try {
      const keys: string[] = Object.keys(record);
      for (const key of keys) {
        if (MissionProgressPresentation.noisyKey(key)) { continue; }
        const value = record[key];
        if (typeof value === 'string' && (value as string).trim() !== '') { fallback.push(MissionProgressPresentation.cap(value as string, 60)); }
        else if (typeof value === 'number') { fallback.push(key + ' ' + (value as number).toString()); }
        if (fallback.length >= 3) { break; }
      }
    } catch { return '工具已执行；结果结构未识别，可在技术诊断中查看原文。'; }
    return fallback.length > 0 ? fallback.join('；') : '工具已执行；结果结构未识别，可在技术诊断中查看原文。';
  }

  /** 来源的用户可读名称：不展示 project:/card:/action: 等内部 ID。 */
  static sourceTitle(source: MissionSource): string {
    if (source.document !== undefined && source.document.fileName !== '') { return source.document.fileName; }
    if (source.entityType === 'PROJECT') { return '项目状态'; }
    if (source.entityType === 'ACTION') { return '行动记录'; }
    if (source.entityType === 'CARD') { return '项目记忆'; }
    if (source.kind === 'EXTERNAL') { return '公开资料'; }
    return '项目资料';
  }

  /** 来源预览：自然语言原文直接摘要；JSON 文本转结构化要点，失败则不预览。 */
  static sourcePreview(source: MissionSource): string {
    const text = source.text ?? '';
    if (text === '') { return ''; }
    const head = text.trimStart();
    if (head.startsWith('{') || head.startsWith('[')) {
      try {
        const parsed: Object = JSON.parse(head);
        if (typeof parsed === 'object' && parsed !== null) {
          const lines = MissionProgressPresentation.structuredLines(parsed as Record<string, Object>);
          if (lines.length > 0) { return lines.join('；'); }
        }
      } catch { return ''; }
      return '';
    }
    return MissionProgressPresentation.cap(text, 160);
  }

  /** 技术诊断原文：完整 JSON 可复制，用于审计。 */
  static rawDiagnostic(step: MissionStep): string {
    try { return JSON.stringify(step.result); } catch { return ''; }
  }
}
