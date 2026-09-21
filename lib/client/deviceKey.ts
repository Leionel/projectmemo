"use client";

const STORAGE_KEY = "pm_device_key";

/**
 * 浏览器端设备标识。
 * 提醒回执按设备归属：同一账号在浏览器与鸿蒙客户端上看到的是各自的设备回执。
 * 浏览器无法写入系统日历，因此这里的回执只承载「项目内计划时间」，
 * 设备日历写入由鸿蒙客户端完成。
 */
export function getDeviceKey(): string {
  if (typeof window === "undefined") return "web-unknown";
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing && existing.trim().length > 0) return existing;
    const generated = `web-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    window.localStorage.setItem(STORAGE_KEY, generated);
    return generated;
  } catch {
    return "web-unknown";
  }
}
