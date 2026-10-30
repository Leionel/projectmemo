type Queue = "CONVERSATION" | "MISSION";
export type WorkerCycleState = { first: Queue; nextScanAt: number };
type Operations = {
  scan: Array<{ name: string; run: () => Promise<unknown> }>;
  conversation: () => Promise<boolean>;
  mission: () => Promise<boolean>;
  onError: (name: string, error: unknown) => void;
};
/** Arbitration inside the existing worker. Original database leases still own all execution. */
export async function runWorkerCycle(state: WorkerCycleState, operations: Operations, now = Date.now()) {
  let failures = 0;
  const report = (name: string, error: unknown) => { failures++; operations.onError(name, error); };
  if (now >= state.nextScanAt) {
    state.nextScanAt = now + 15000;
    for (const scan of operations.scan) {
      try { await scan.run(); } catch (error) { report(scan.name, error); }
    }
  }
  const order: Queue[] = state.first === "CONVERSATION" ? ["CONVERSATION", "MISSION"] : ["MISSION", "CONVERSATION"];
  state.first = order[1];
  for (const queue of order) {
    try {
      const ran = await (queue === "CONVERSATION" ? operations.conversation() : operations.mission());
      if (ran) return { ran: true, queue, failures };
    } catch (error) { report(queue, error); }
  }
  return { ran: false, queue: null, failures };
}
