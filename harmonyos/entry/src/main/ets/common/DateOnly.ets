/** 服务端日期字段使用 YYYY-MM-DD；从滚轮选择的本地年月日生成，避免 UTC 时区偏移。 */
export class DateOnly {
  static format(value: Date): string {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  static selected(value: string): Date {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const year = Number(value.substring(0, 4));
      const month = Number(value.substring(5, 7));
      const day = Number(value.substring(8, 10));
      const selected = new Date(year, month - 1, day);
      if (selected.getFullYear() === year && selected.getMonth() === month - 1 && selected.getDate() === day) {
        return selected;
      }
    }
    return new Date();
  }
}
