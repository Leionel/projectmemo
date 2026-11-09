const dayFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });

/** 产品按北京时间划分自然日，不随服务器时区或 UTC 日界变化。 */
export function shanghaiDay(at: Date | number = new Date()): string {
  return dayFormat.format(at);
}

/** 用户填写的 YYYY-MM-DD 截止日，指北京时间当天结束。 */
export function endOfShanghaiDay(day: string): Date {
  return new Date(`${day}T23:59:59+08:00`);
}
