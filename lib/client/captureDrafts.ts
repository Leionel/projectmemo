const prefix = "projectmemo:capture:";
const ownerKey = "projectmemo:capture-owner";
const changed = "projectmemo:capture-owner-changed";
let memoryOwner = "";
let generation = 0;

export function captureDraftKey(ownerId: string, projectId: string, scope = "") {
  return `${prefix}v2:${encodeURIComponent(ownerId)}:${encodeURIComponent(projectId)}:${encodeURIComponent(scope)}`;
}
export function captureOwner() {
  try { return window.localStorage.getItem(ownerKey) ?? ""; } catch { return memoryOwner; }
}
export function captureGeneration() { return generation; }
export function clearCaptureDrafts() {
  generation++;
  memoryOwner = "";
  try {
    for (const key of Object.keys(window.localStorage)) if (key.startsWith(prefix)) window.localStorage.removeItem(key);
    window.localStorage.removeItem(ownerKey);
  } catch { /* 存储不可用时仅保留当前组件内存状态。 */ }
  window.dispatchEvent(new Event(changed));
}
export function bindCaptureDraftOwner(ownerId: string) {
  const previous = captureOwner();
  if (previous === ownerId) { memoryOwner = ownerId; return; }
  // 无 owner 的旧草稿无法安全归属，不迁移给当前登录者。
  if (previous !== ownerId) clearCaptureDrafts();
  memoryOwner = ownerId;
  try { window.localStorage.setItem(ownerKey, ownerId); } catch { /* 内存降级 */ }
  window.dispatchEvent(new Event(changed));
}
export function onCaptureOwnerChange(listener: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === null || event.key === ownerKey) { generation++; listener(); } };
  window.addEventListener(changed, listener);
  window.addEventListener("storage", storage);
  return () => { window.removeEventListener(changed, listener); window.removeEventListener("storage", storage); };
}
export function writeCaptureDraft(key: string, ownerId: string, value: unknown) {
  if (captureOwner() !== ownerId) return;
  try { if (value) window.localStorage.setItem(key, JSON.stringify(value)); else window.localStorage.removeItem(key); } catch { /* 不把本机存储失败当作业务保存失败。 */ }
}
