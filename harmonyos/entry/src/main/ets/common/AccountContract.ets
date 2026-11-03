import { RegisterInput } from '../models/Auth';

export function buildRegisterInput(username: string, email: string, password: string, confirm: string): RegisterInput {
  const input: RegisterInput = new RegisterInput();
  input.username = username.trim().toLowerCase();
  input.email = email.trim().toLowerCase();
  input.password = password;
  input.confirmPassword = confirm;
  return input;
}

export function accountEmailError(email: string): string {
  return email.trim().length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? '' : '请填写有效的邮箱地址';
}

export function registrationError(input: RegisterInput): string {
  if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(input.username)) return '账号需为 3–32 位字母、数字、下划线或短横线，并以字母或数字开头';
  const emailError: string = accountEmailError(input.email);
  if (emailError !== '') return emailError;
  if (input.password.length < 10 || input.password.length > 128 || input.password.trim().length === 0) return '密码需为 10–128 个字符，不能全部为空格';
  if (input.password !== input.confirmPassword) return '两次输入的密码不一致';
  return '';
}

/**
 * 登录标识（用户名或已绑定邮箱）本地预校验。
 * 只检查非空与长度；邮箱形态与大小写规范化由服务端按注册/验证/重置同一规则处理，
 * 客户端不引入 Gmail 去点号、+tag 合并等别名规则。
 */
export function loginIdentifierError(identifier: string): string {
  const trimmed: string = identifier.trim();
  if (trimmed === '') return '请输入用户名或邮箱';
  return trimmed.length <= 254 ? '' : '用户名或邮箱过长';
}

/**
 * 登录错误映射：未验证邮箱、限流、邮件服务不可用与网络失败不能统一显示成“密码错误”。
 * 未知错误保留服务端文案；服务端文案已统一为“账号或密码错误”时不额外泄露账号存在性。
 */
export function loginErrorMessage(code: string, message: string): string {
  if (code === 'AUTH_FAILED') return '账号或密码错误';
  if (code === 'EMAIL_NOT_VERIFIED') return '请先验证注册邮箱；未收到邮件可以重新发送';
  if (code === 'ACCOUNT_MAIL_UNAVAILABLE') return '邮件服务暂时不可用，请稍后再试；已有账号仍可登录';
  if (code === 'LOGIN_RATE_LIMITED') return message !== '' ? message : '连续登录失败次数过多，请稍后再试';
  if (code === 'VALIDATION_ERROR') return message !== '' ? message : '请检查用户名或邮箱后重试';
  return message !== '' ? message : '请求未完成，请检查网络后重试';
}
