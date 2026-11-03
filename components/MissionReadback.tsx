"use client";
import { useEffect, useRef, useState } from "react";
import type { MissionReadTarget } from "@/lib/mission/navigation";
import type { MissionReadback as Data } from "@/lib/mission/readback";
import { failedReadState, type ReadState } from "@/lib/client/readState";
import { MissionWorkPacket } from "./MissionWorkPacket";
import { MissionResultReceipts } from "./MissionResultReceipts";
export function MissionReadback({
  missionId,
  target = {},
  missionVersion,
  refreshKey = 0,
}: {
  missionId: string;
  target?: MissionReadTarget;
  missionVersion?: number;
  refreshKey?: number;
}) {
  const [data, setData] = useState<Data | null>(null),
    [state, setState] = useState<ReadState>("unavailable"),
    [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [observedKey, setObservedKey] = useState("");
  const generation = useRef(0),
    hasData = useRef(false);
  const query = Object.entries(target)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(
      ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
    )
    .join("&");
  useEffect(() => {
    const request = ++generation.current;
    let cancelled = false;
    void fetch(`/api/missions/${missionId}/readback?${query}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    })
      .then(async (r) => {
        const body = await r.json();
        if (cancelled || request !== generation.current) return;
        if (!r.ok)
          throw Object.assign(
            new Error(body.error?.message ?? "读回暂不可用"),
            { status: r.status },
          );
        const readback = body.readback as Data | undefined;
        if (!readback || typeof readback !== "object")
          throw Object.assign(new Error("读回暂不可用"), { status: 0 });
        hasData.current = true;
        setObservedKey(`${missionId}?${query}`);
        setData(readback);
        setState("fresh");
        setError("");
      })
      .catch((e) => {
        if (cancelled || request !== generation.current) return;
        const status = e.status ?? 0;
        setState(failedReadState(hasData.current, status));
        if ([401, 403, 404].includes(status)) {
          hasData.current = false;
          setData(null);
          setObservedKey("");
        }
        setError(
          status === 409
            ? `${e.message ?? "读取期间来源或权限发生变化"}；已保留上次读取结果，请重新核对后再操作，不会自动沿用旧资格。`
            : (e.message ?? "读回失败"),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [missionId, query, reload, missionVersion, refreshKey]);
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) setReload((v) => v + 1);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  const current = data !== null && observedKey === `${missionId}?${query}`;
  return (
    <section
      aria-label="原任务当前工作包与完成回执"
      className="mt-3 rounded-lg border border-[var(--rule)] p-3 text-xs"
    >
      <button
        type="button"
        className="workspace-tool focus-ring"
        onClick={() => setReload((v) => v + 1)}
      >
        重新读取状态与回执
      </button>
      {data &&
        missionVersion !== undefined &&
        data.missionVersion < missionVersion && (
          <p role="status">
            委托版本已变化，正在重新读取回执；以下为上次结果。
          </p>
        )}
      {error && (
        <p role="status">
          {error}
          {state === "lastKnown"
            ? "；以下为上次读取的历史结果，请刷新后再操作。"
            : ""}
        </p>
      )}
      {current && (
        <MissionWorkPacket
          readback={data}
          packet={data.workPacket}
          missionId={missionId}
          onReload={() => setReload((v) => v + 1)}
          disabled={state !== "fresh"}
        />
      )}
      {current && <MissionResultReceipts data={data} />}
    </section>
  );
}
