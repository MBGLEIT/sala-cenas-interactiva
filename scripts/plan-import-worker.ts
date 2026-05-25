import { loadEnvConfig } from "@next/env";
import type { PlanImportWorkerResult } from "../src/lib/plan-import-worker-service";

loadEnvConfig(process.cwd());

function readFlag(name: string) {
  return process.argv.includes(name);
}

function readNumberArg(prefix: string, fallback: number) {
  const raw = process.argv.find((value) => value.startsWith(`${prefix}=`));
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw.slice(prefix.length + 1));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function logResult(result: PlanImportWorkerResult) {
  const now = new Date().toISOString();

  if (result.status === "idle") {
    console.info(`[${now}] worker idle: no hay jobs pendientes`);
    return;
  }

  if (result.status === "completed") {
    console.info(
      `[${now}] worker completed ${result.traceId}: ${result.mesaIds.length} mesas, ${result.chairsCreated} sillas`,
    );
    return;
  }

  if (result.status === "cancelled") {
    console.warn(`[${now}] worker cancelled ${result.traceId}: ${result.message}`);
    return;
  }

  console.error(
    `[${now}] worker failed ${result.traceId} (${result.statusCode}): ${result.message}`,
  );
}

async function main() {
  const workerService = await import("../src/lib/plan-import-worker-service");
  const { processNextPlanImportJob, runPlanImportWorkerLoop } = workerService;
  const once = readFlag("--once");
  const dryRun = readFlag("--dry-run");
  const pollMs = Number(
    process.env.PLAN_IMPORT_WORKER_POLL_MS && Number(process.env.PLAN_IMPORT_WORKER_POLL_MS) > 0
      ? process.env.PLAN_IMPORT_WORKER_POLL_MS
      : 5000,
  );
  const argPollMs = readNumberArg("--poll-ms", pollMs);
  const maxJobs = once ? 1 : readNumberArg("--max-jobs", Number.POSITIVE_INFINITY);

  const controller = new AbortController();
  const stop = () => {
    controller.abort();
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  if (dryRun) {
    console.info(
      `[${new Date().toISOString()}] worker dry-run OK: entorno cargado y servicio listo`,
    );
    return;
  }

  if (once) {
    const result = await processNextPlanImportJob();
    logResult(result);
    return;
  }

  console.info(
    `[${new Date().toISOString()}] worker iniciado: poll=${argPollMs}ms`,
  );

  await runPlanImportWorkerLoop({
    pollMs: argPollMs,
    maxJobs,
    signal: controller.signal,
    onTick: async (result) => {
      logResult(result);
    },
  });

  console.info(`[${new Date().toISOString()}] worker detenido`);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
