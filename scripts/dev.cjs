const { spawn } = require("node:child_process");
const path = require("node:path");
const preload = path.join(__dirname, "dev-runtime.cjs");
const args = process.argv.slice(2);
const portIndex = args.findIndex((arg) => arg === "--port" || arg === "-p");
const port =
  (portIndex >= 0 && args[portIndex + 1]) ||
  args.find((arg) => arg.startsWith("--port="))?.slice(7) ||
  process.env.PORT ||
  "3000";
if (portIndex < 0 && !args.some((arg) => arg.startsWith("--port=")))
  args.push("--port", port);
const child = spawn(
  process.execPath,
  [
    require.resolve("next/dist/bin/next"),
    "dev",
    "--hostname",
    "127.0.0.1",
    ...args,
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_OPTIONS:
        `${process.env.NODE_OPTIONS || ""} --require ${JSON.stringify(preload)}`.trim(),
    },
  },
);
const worker = spawn(
  process.execPath,
  [
    "--env-file-if-exists=.env.local",
    "--import",
    "tsx",
    path.join(__dirname, "worker.ts"),
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "development",
      MAINTENANCE_ORIGIN: `http://127.0.0.1:${port}`,
      WORKER_START_DELAY_MS: "5000",
    },
  },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    worker.kill(signal);
    child.kill(signal);
  });
worker.on("error", (error) => console.error("[worker]", error.message));
child.on("error", (error) => {
  worker.kill();
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  worker.kill();
  process.exitCode = code ?? 0;
});
