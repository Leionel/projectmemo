// P3-A/P3-B 生产验收 runner（无凭据：用户名/密码经环境变量 PM_USER/PM_PASS 传入，
// accessToken 只存在于本次进程内存，绝不写入任何文件）。
// 用法：node runner.mjs <phase>  phase ∈ a | b-create | b-adopt | b-idem | b-revoke
// 证据 JSON 保存到本目录；state.json 只保存非敏感 id。
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.PM_BASE ?? "https://project.luojiatutor.xyz";
const STATE_PATH = join(HERE, "state.json");

const state = existsSync(STATE_PATH) ? JSON.parse(readFileSync(STATE_PATH, "utf8")) : {};
function saveState() { writeFileSync(STATE_PATH, JSON.stringify(state, null, 2)); }

function save(name, entry) {
  writeFileSync(join(HERE, name), JSON.stringify(entry, null, 2));
  const brief = typeof entry.body === "object" && entry.body !== null
    ? Object.keys(entry.body).join(",")
    : String(entry.body).slice(0, 120);
  console.log(`[${entry.status}] ${name} :: ${brief}`);
}

async function fetchWithRetry(url, options, attempts = 4) {
  for (let i = 1; ; i += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      const cause = error?.cause?.code ?? error?.code ?? error?.message;
      if (i >= attempts || !/UND_ERR_CONNECT_TIMEOUT|ECONNRESET|ETIMEDOUT/i.test(String(cause))) throw error;
      console.log(`fetch retry ${i}/${attempts} (${cause})`);
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
}

async function api(name, method, path, body, { auth = true } = {}) {
  const headers = { "content-type": "application/json" };
  if (auth && state.token) headers.authorization = `Bearer ${state.token}`;
  const response = await fetchWithRetry(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text.slice(0, 2000); }
  const entry = {
    at: new Date().toISOString(),
    request: { method, path, body: body ?? null, authorized: auth && Boolean(state.token) },
    status: response.status,
    body: parsed,
  };
  save(name, entry);
  return entry;
}

async function login() {
  const response = await fetchWithRetry(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: process.env.PM_USER, password: process.env.PM_PASS }),
  });
  if (response.status !== 200) throw new Error(`login failed: ${response.status}`);
  const data = await response.json();
  state.token = data.accessToken; // 仅进程内存
  state.user = data.user;
  saveState();
  return data;
}

const rid = () => randomUUID();

// ---------- Phase A：P3-A 只读冒烟 ----------
async function phaseA() {
  await login();
  const projects = await api("a1-projects.json", "GET", "/api/projects");
  const list = Array.isArray(projects.body) ? projects.body : projects.body?.projects ?? [];
  state.demoProjects = list.map((p) => ({ id: p.id, title: p.title }));
  saveState();

  const first = list[0];
  if (!first) throw new Error("演示账号没有项目");
  state.firstProjectId = first.id;
  await api("a2-experiences-first-project.json", "GET", `/api/projects/${first.id}/experiences`);

  // A3：missions 体验块。先查第一个项目，没有 mission 再查其余项目。
  let mission = null;
  for (const p of list) {
    const missions = await api(`a3-missions-${p.id}.json`, "GET", `/api/missions?projectId=${p.id}`);
    const ml = Array.isArray(missions.body) ? missions.body : missions.body?.missions ?? missions.body?.items ?? [];
    if (ml.length > 0) { mission = ml[0]; state.missionProjectId = p.id; break; }
  }
  if (mission) {
    state.missionId = mission.id;
    await api("a3-mission-detail.json", "GET", `/api/missions/${mission.id}`);
  } else {
    save("a3-mission-detail.json", { at: new Date().toISOString(), note: "演示账号两个项目均无 mission，A3 不适用", status: null, body: null });
  }

  // A4：未认证 401 + 不存在经验 404
  await api("a4-unauth-experiences.json", "GET", `/api/projects/${first.id}/experiences`, undefined, { auth: false });
  await api("a4-experience-nonexistent.json", "POST", `/api/projects/${first.id}/experiences/nonexistent-id`, { action: "ACTIVATE", requestId: rid() });
}

// ---------- Phase B：建演示项目 + 连接 + 二刷 ----------
async function phaseBCreate() {
  await login();
  let pid = state.pid;
  if (!pid) {
    const created = await api("b0-project-create.json", "POST", "/api/projects", {
      title: "洛加数学技能仓库跟踪",
      description: "跟踪洛加数学技能仓库的提交动态，用于验收仓库信号感知与采纳链路。",
      goal: "验证仓库信号感知、采纳与撤销链路在生产可用",
      scenario: "COMPETITION",
    });
    pid = created.body?.project?.id ?? created.body?.id;
    if (!pid) throw new Error("项目创建失败");
    state.pid = pid;
    saveState();
  }

  const conn = await api("b1-connection-create.json", "POST", `/api/projects/${pid}/repo-signals`, {
    repo: "Leionel/luojia-math-tutor-skill", ref: "main", requestId: rid(),
  });
  state.cid = conn.body?.connection?.id;
  saveState();

  await api("b2-signals-list.json", "GET", `/api/projects/${pid}/repo-signals`);
  await api("b3-refresh-second.json", "POST", `/api/projects/${pid}/repo-signals/connections/${state.cid}`, {
    action: "REFRESH", requestId: rid(),
  });
}

// ---------- Phase B：行动 + 采纳 ----------
async function phaseBAdopt() {
  await login();
  const { pid } = state;
  const action = await api("b4-action-create.json", "POST", `/api/projects/${pid}/actions`, {
    title: "复核仓库信号采纳演示行动", isSimulated: false,
  });
  state.actionId = action.body?.action?.id ?? action.body?.id;
  state.actionStatusAfterCreate = action.body?.status;
  saveState();

  const before = await api("b4-project-before-adopt.json", "GET", `/api/projects/${pid}`);
  state.captureCountBefore = before.body?._count?.captures;
  saveState();

  // 取一条候选信号
  const list = await api("b4-signal-pick.json", "GET", `/api/projects/${pid}/repo-signals`);
  const candidate = (list.body?.signals ?? []).find((s) => s.status === "CANDIDATE");
  if (!candidate) throw new Error("没有候选信号可采纳");
  state.sid = candidate.id;
  state.candidateSignals = (list.body?.signals ?? []).filter((s) => s.status === "CANDIDATE").map((s) => ({ id: s.id, sha: s.sha }));
  saveState();

  await api("b4-signal-adopt.json", "POST", `/api/projects/${pid}/repo-signals/signals/${state.sid}`, {
    action: "ADOPT", actionId: state.actionId, requestId: rid(),
  });
  await api("b4-actions-after-adopt.json", "GET", `/api/projects/${pid}/actions`);
  await api("b4-project-after-adopt.json", "GET", `/api/projects/${pid}`);
}

// ---------- Phase B：幂等 + 错误路径 ----------
async function phaseBIdem() {
  await login();
  const { pid, sid } = state;
  await api("b5-adopt-repeat.json", "POST", `/api/projects/${pid}/repo-signals/signals/${sid}`, {
    action: "ADOPT", actionId: state.actionId, requestId: rid(),
  });
  await api("b5-project-after-repeat.json", "GET", `/api/projects/${pid}`);

  const other = (state.candidateSignals ?? []).find((s) => s.id !== sid);
  if (!other) throw new Error("没有第二条候选信号做错误路径抽查");
  state.sid2 = other.id;
  saveState();

  await api("b6-adopt-badaction.json", "POST", `/api/projects/${pid}/repo-signals/signals/${state.sid2}`, {
    action: "ADOPT", actionId: "nonexistent-action-id", requestId: rid(),
  });
  await api("b6-dismiss.json", "POST", `/api/projects/${pid}/repo-signals/signals/${state.sid2}`, {
    action: "DISMISS", requestId: rid(),
  });
  await api("b6-project-after-dismiss.json", "GET", `/api/projects/${pid}`);
}

// ---------- Phase B：第二个连接撤销测试 ----------
async function phaseBRevoke() {
  await login();
  const { pid } = state;
  const conn2 = await api("b7-conn2-create.json", "POST", `/api/projects/${pid}/repo-signals`, {
    repo: "Leionel/projectmemo", ref: "master", requestId: rid(),
  });
  state.cid2 = conn2.body?.connection?.id;
  saveState();

  await api("b7-revoke.json", "POST", `/api/projects/${pid}/repo-signals/connections/${state.cid2}`, {
    action: "REVOKE", reason: "验收撤销测试", requestId: rid(),
  });
  await api("b7-refresh-revoked.json", "POST", `/api/projects/${pid}/repo-signals/connections/${state.cid2}`, {
    action: "REFRESH", requestId: rid(),
  });
  await api("b7-list-after-revoke.json", "GET", `/api/projects/${pid}/repo-signals`);
}

// ---------- Phase B：补测带 actionId 的采纳关联 ----------
async function phaseBLink() {
  await login();
  const { pid, actionId } = state;
  if (!actionId) throw new Error("state.actionId 缺失");
  const before = await api("b4b-project-before-link.json", "GET", `/api/projects/${pid}`);
  const list = await api("b4b-signal-pick.json", "GET", `/api/projects/${pid}/repo-signals`);
  const candidate = (list.body?.signals ?? []).find((s) => s.status === "CANDIDATE");
  if (!candidate) throw new Error("没有候选信号可做关联采纳");
  state.sidLinked = candidate.id;
  saveState();
  await api("b4b-signal-adopt-with-action.json", "POST", `/api/projects/${pid}/repo-signals/signals/${state.sidLinked}`, {
    action: "ADOPT", actionId, requestId: rid(),
  });
  await api("b4b-actions-after-link.json", "GET", `/api/projects/${pid}/actions`);
  await api("b4b-project-after-link.json", "GET", `/api/projects/${pid}`);
  console.log(`captures ${before.body?.project?._count?.captures} -> link adopt done`);
}

// ---------- Phase B：干净候选信号上的错误路径补测 ----------
async function phaseB6Retry() {
  await login();
  const { pid } = state;
  const before = await api("b6b-project-before.json", "GET", `/api/projects/${pid}`);
  const list = await api("b6b-signal-pick.json", "GET", `/api/projects/${pid}/repo-signals`);
  const taken = new Set([state.sid, state.sidLinked, state.sid2].filter(Boolean));
  const candidate = (list.body?.signals ?? []).find((s) => s.status === "CANDIDATE" && !taken.has(s.id));
  if (!candidate) throw new Error("没有剩余候选信号做错误路径补测");
  state.sidErr = candidate.id;
  saveState();

  await api("b6b-adopt-badaction.json", "POST", `/api/projects/${pid}/repo-signals/signals/${state.sidErr}`, {
    action: "ADOPT", actionId: "nonexistent-action-id", requestId: rid(),
  });
  await api("b6b-dismiss.json", "POST", `/api/projects/${pid}/repo-signals/signals/${state.sidErr}`, {
    action: "DISMISS", requestId: rid(),
  });
  await api("b6b-project-after-dismiss.json", "GET", `/api/projects/${pid}`);
  console.log(`captures before dismiss: ${before.body?.project?._count?.captures}`);
}

const phase = process.argv[2];
const phases = { a: phaseA, "b-create": phaseBCreate, "b-adopt": phaseBAdopt, "b-link": phaseBLink, "b-idem": phaseBIdem, "b6-retry": phaseB6Retry, "b-revoke": phaseBRevoke };
if (!phases[phase]) {
  console.error("usage: node runner.mjs <a|b-create|b-adopt|b-idem|b-revoke>");
  process.exit(1);
}
try {
  await phases[phase]();
} finally {
  delete state.token; // 结束即清
  saveState();
}
console.log(`phase ${phase} done`);
