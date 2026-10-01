import { maintenanceSecret } from "../lib/server/maintenance-secret";

const once = process.argv.includes("--once");
const origin = new URL(
  process.env.MAINTENANCE_ORIGIN ||
    process.env.APP_ORIGIN ||
    "http://127.0.0.1:3000",
);
if (
  !["http:", "https:"].includes(origin.protocol) ||
  origin.username ||
  origin.password
)
  throw new Error(
    "MAINTENANCE_ORIGIN must be an HTTP(S) origin without credentials.",
  );
if (
  origin.protocol === "http:" &&
  !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
)
  throw new Error("Remote maintenance endpoints require HTTPS.");
const endpoint = new URL("/api/internal/maintenance", origin);
const controller = new AbortController();
let timer: ReturnType<typeof setTimeout> | undefined;
let failed = false;
let stopped = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stopped = true;
    controller.abort();
    if (timer) clearTimeout(timer);
  });

async function tick() {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      headers: { Authorization: `Bearer ${await maintenanceSecret()}` },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(55_000)]),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { result } = await response.json();
    if (once || failed || result?.created > 0)
      console.log(
        `[worker] Completed; generated tasks: ${result?.created ?? 0}.`,
      );
    failed = false;
  } catch (error) {
    if (stopped) return;
    if (!failed || once)
      console.error(
        "[worker] Scheduled work could not run. Check server availability and JOBS_SECRET.",
      );
    failed = true;
    if (once) process.exitCode = 1;
  }
  if (!once && !stopped) timer = setTimeout(() => void tick(), 60_000);
}

if (!once && Number(process.env.WORKER_START_DELAY_MS) > 0)
  timer = setTimeout(
    () => void tick(),
    Math.min(Number(process.env.WORKER_START_DELAY_MS), 60_000),
  );
else void tick();
