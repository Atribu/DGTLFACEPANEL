import { runDueRecurrences } from "./recurrences";
import { generateDueNotifications } from "./notifications";

type Result = Awaited<ReturnType<typeof runDueRecurrences>> & { ranAt: string };
const state = globalThis as typeof globalThis & {
  dgtlMaintenance?: {
    pending?: Promise<Result>;
    lastRun: number;
    result?: Result;
  };
};

/** Coalesce requests in this server; database occurrence keys also protect multiple workers. */
export async function runMaintenance(
  force = false,
): Promise<Result | undefined> {
  const current = (state.dgtlMaintenance ??= { lastRun: 0 });
  if (current.pending) return current.pending;
  if (!force && Date.now() - current.lastRun < 60_000) return current.result;
  const pending = (async () => {
    const recurrence = await runDueRecurrences();
    await generateDueNotifications();
    const result = { ...recurrence, ranAt: new Date().toISOString() };
    current.lastRun = Date.now();
    current.result = result;
    return result;
  })();
  current.pending = pending;
  try {
    return await pending;
  } finally {
    if (current.pending === pending) current.pending = undefined;
  }
}
