import { ApiError } from '../models/Project';

// 与 Backend（lib/validation/schemas.ts、prisma/schema.prisma）保持一致的
// 请求体结构、状态枚举与 HTTP 状态码判定。纯逻辑，不依赖 @ohos.net.http，
// 可在本地单元测试中直接验证。

export class InterventionAcceptBody {
  status: string = 'ACCEPTED';
  actionIndex: number = 0;
}
export class InterventionSnoozeBody {
  status: string = 'SNOOZED';
  snoozedUntil: string = '';
}

export class InterventionDismissBody {
  status: string = 'DISMISSED';
  dismissReason: string = '';
}

export class ActionCompleteBody {
  status: string = 'DONE';
  resultText: string = '';
  /** 完成时如何处理已存在的未来设备日历提醒：KEEP | REMOVE；不传表示不问 */
  reminderDisposition?: string;
  /** 设备标识：提醒回执按设备归属，缺少时服务端不会处理提醒 */
  deviceKey?: string;
}

export class ActionUpdateStatusBody {
  status: string = '';
}

export class CaptureRequestBody {
  rawText: string = '';
  sourceType: string = 'manual';
}

export function buildAcceptBody(actionIndex: number): InterventionAcceptBody {
  const body: InterventionAcceptBody = new InterventionAcceptBody();
  body.actionIndex = actionIndex;
  return body;
}

export function buildSnoozeBody(snoozedUntil: string): InterventionSnoozeBody {
  const body: InterventionSnoozeBody = new InterventionSnoozeBody();
  body.snoozedUntil = snoozedUntil;
  return body;
}

export function buildDismissBody(dismissReason: string): InterventionDismissBody {
  const body: InterventionDismissBody = new InterventionDismissBody();
  body.dismissReason = dismissReason;
  return body;
}

export function buildActionCompleteBody(resultText: string, disposition?: string, deviceKey?: string): ActionCompleteBody {
  const body: ActionCompleteBody = new ActionCompleteBody();
  body.resultText = resultText;
  if (disposition !== undefined && disposition !== '') {
    body.reminderDisposition = disposition;
  }
  if (deviceKey !== undefined && deviceKey !== '') {
    body.deviceKey = deviceKey;
  }
  return body;
}

export function buildActionStatusBody(status: string): ActionUpdateStatusBody {
  const body: ActionUpdateStatusBody = new ActionUpdateStatusBody();
  body.status = status;
  return body;
}

export function buildCaptureBody(rawText: string): CaptureRequestBody {
  const body: CaptureRequestBody = new CaptureRequestBody();
  body.rawText = rawText;
  return body;
}

// 与 prisma/schema.prisma 枚举一致
export const ACTION_STATUSES: string[] = ['TODO', 'DOING', 'DONE', 'CANCELLED'];
export const INTERVENTION_STATUSES: string[] = ['OPEN', 'ACCEPTED', 'SNOOZED', 'DISMISSED', 'RESOLVED'];
export const INTERVENTION_TRIGGERS: string[] =
  ['DEADLINE_NEAR', 'RISK_UNHANDLED', 'PROJECT_STALE', 'EXPERIMENT_GAP', 'MATERIAL_GAP', 'DELIVERABLE_GAP'];

export function isValidActionStatus(status: string): boolean {
  return ACTION_STATUSES.includes(status);
}

export function isValidInterventionStatus(status: string): boolean {
  return INTERVENTION_STATUSES.includes(status);
}

export function isValidInterventionTrigger(trigger: string): boolean {
  return INTERVENTION_TRIGGERS.includes(trigger);
}

// GET 只接受 200；POST/PATCH 接受 200/201。
// 204 No Content（PATCH 空响应）不算 JSON 成功，由 isNoContent 单独判定。
export function isSuccessCode(method: string, code: number): boolean {
  if (code === 200) {
    return true;
  }
  if (code === 201 && (method === 'POST' || method === 'PATCH')) {
    return true;
  }
  return false;
}

export function isNoContent(code: number): boolean {
  return code === 204;
}

// 把 Backend 的 { error: { code, message } } 映射为 ApiError；
// 解析失败或缺少字段时回退 HTTP_ERROR + "HTTP <状态码>"。
export function parseApiError(errBody: string, statusCode: number): ApiError {
  let code: string = 'HTTP_ERROR';
  let message: string = `HTTP ${statusCode}`;
  try {
    const parsed: Record<string, Object> = JSON.parse(errBody) as Record<string, Object>;
    const errorValue: Object | undefined = parsed['error'];
    if (errorValue !== undefined && errorValue !== null) {
      const errorObj: Record<string, string> = errorValue as Record<string, string>;
      code = errorObj['code'] ?? 'HTTP_ERROR';
      message = errorObj['message'] ?? message;
    }
  } catch (_e) {
    // 响应体不是 JSON 时保留默认映射
  }
  return new ApiError(code, message, statusCode);
}

// --- 认证契约辅助 ---

export class LoginRequestBody {
  username: string = '';
  password: string = '';
  client: string = 'harmony';
}

export function buildLoginBody(username: string, password: string, client: string = 'harmony'): LoginRequestBody {
  const body = new LoginRequestBody();
  body.username = username.trim();
  body.password = password;
  body.client = client;
  return body;
}

export function buildAuthorizationHeader(token: string): string {
  if (!token || token.trim().length === 0) {
    return '';
  }
  return `Bearer ${token.trim()}`;
}

export function isTokenExpired(expiresAt: string, nowMs?: number): boolean {
  if (!expiresAt || expiresAt.trim().length === 0) {
    return false;
  }
  const exp = Date.parse(expiresAt);
  if (Number.isNaN(exp)) {
    return false;
  }
  const current = nowMs !== undefined ? nowMs : Date.now();
  return current >= exp;
}

export function classifyHttpError(statusCode: number): string {
  if (statusCode === 401) {
    return 'UNAUTHORIZED';
  }
  if (statusCode === 403) {
    return 'FORBIDDEN';
  }
  if (statusCode === 404) {
    return 'NOT_FOUND';
  }
  if (statusCode === 408) {
    return 'REQUEST_TIMEOUT';
  }
  if (statusCode === 429) {
    return 'RATE_LIMITED';
  }
  if (statusCode >= 500) {
    return 'SERVER_ERROR';
  }
  return 'HTTP_ERROR';
}
