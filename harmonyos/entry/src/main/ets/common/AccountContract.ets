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
