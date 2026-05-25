import fs from "node:fs";
import path from "node:path";
import type { ImportedPlanTable } from "@/lib/plan-import";
import {
  appendPlanImportJobLog,
  getPlanImportJobByTraceId,
  updatePlanImportJob,
} from "@/lib/plan-import-cloud";

type PlanImportTraceStatus =
  | "pending"
  | "running"
  | "review_pending"
  | "completed"
  | "failed"
  | "cancel_requested"
  | "cancelled";

export type PlanImportTraceLogEntry = {
  id: string;
  at: string;
  level: "info" | "warn" | "error";
  stage: string;
  details?: Record<string, unknown>;
};

export type PlanImportTraceSnapshot = {
  traceId: string;
  status: PlanImportTraceStatus;
  createdAt: string;
  updatedAt: string;
  cancelRequested: boolean;
  logs: PlanImportTraceLogEntry[];
  summary?: string;
  createdMesaIds?: string[];
  eventoId?: string;
  eventoNombre?: string | null;
  importedTables?: ImportedPlanTable[];
};

type PlanImportTraceRecord = PlanImportTraceSnapshot;

const TRACE_TTL_MS = 1000 * 60 * 60 * 6;
const MAX_TRACE_LOGS = 500;
const traces = new Map<string, PlanImportTraceRecord>();
const abortControllers = new Map<string, AbortController>();
const abortPollers = new Map<string, ReturnType<typeof setInterval>>();
const abortCloudPollInflight = new Set<string>();
const RUNTIME_DIR = path.resolve(process.cwd(), ".plan-import-runtime");
const TRACE_DIR = path.join(RUNTIME_DIR, "traces");

function ensureRuntimeDir() {
  fs.mkdirSync(TRACE_DIR, { recursive: true });
}

function getTraceFilePath(traceId: string) {
  ensureRuntimeDir();
  return path.join(TRACE_DIR, `${traceId}.json`);
}

function readTraceFromDisk(traceId: string) {
  try {
    const filePath = getTraceFilePath(traceId);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as PlanImportTraceRecord;
  } catch {
    return null;
  }
}

function writeTraceToDisk(trace: PlanImportTraceRecord) {
  try {
    fs.writeFileSync(getTraceFilePath(trace.traceId), JSON.stringify(trace, null, 2), "utf8");
  } catch {}
}

function getMutableTrace(traceId: string) {
  const memoryTrace = traces.get(traceId);
  const diskTrace = readTraceFromDisk(traceId);
  if (memoryTrace && diskTrace) {
    const mergedTrace: PlanImportTraceRecord =
      Date.parse(diskTrace.updatedAt) >= Date.parse(memoryTrace.updatedAt)
        ? {
            ...memoryTrace,
            ...diskTrace,
            logs:
              diskTrace.logs.length >= memoryTrace.logs.length
                ? diskTrace.logs
                : memoryTrace.logs,
          }
        : {
            ...diskTrace,
            ...memoryTrace,
            cancelRequested: memoryTrace.cancelRequested || diskTrace.cancelRequested,
            status:
              diskTrace.status === "cancel_requested" || diskTrace.status === "cancelled"
                ? diskTrace.status
                : memoryTrace.status,
            logs:
              memoryTrace.logs.length >= diskTrace.logs.length
                ? memoryTrace.logs
                : diskTrace.logs,
          };

    traces.set(traceId, mergedTrace);
    return mergedTrace;
  }

  if (memoryTrace) {
    return memoryTrace;
  }

  if (diskTrace) {
    traces.set(traceId, diskTrace);
    return diskTrace;
  }

  return null;
}

export class PlanImportCancelledError extends Error {
  constructor(message = "La importacion del plano fue cancelada.") {
    super(message);
    this.name = "PlanImportCancelledError";
  }
}

function pruneExpiredTraces() {
  const now = Date.now();

  for (const [traceId, trace] of traces.entries()) {
    if (now - Date.parse(trace.updatedAt) > TRACE_TTL_MS) {
      traces.delete(traceId);
      abortControllers.delete(traceId);
      const poller = abortPollers.get(traceId);
      if (poller) {
        clearInterval(poller);
        abortPollers.delete(traceId);
      }
    }
  }
}

export function beginPlanImportTrace(traceId: string) {
  pruneExpiredTraces();
  const now = new Date().toISOString();
  const existing = getMutableTrace(traceId);
  const trace = {
    traceId,
    status: existing?.cancelRequested ? "cancel_requested" : "running",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    cancelRequested: existing?.cancelRequested ?? false,
    logs: existing?.logs ?? [],
    createdMesaIds: existing?.createdMesaIds,
    eventoId: existing?.eventoId,
    summary: existing?.summary,
  } satisfies PlanImportTraceRecord;
  traces.set(traceId, trace);
  writeTraceToDisk(trace);
  void updatePlanImportJob(traceId, {
    status: trace.status === "cancel_requested" ? "cancel_requested" : "running",
  }).catch(() => {});
}

export function appendPlanImportTraceLog(
  traceId: string,
  level: "info" | "warn" | "error",
  stage: string,
  details?: Record<string, unknown>,
) {
  const trace = getMutableTrace(traceId);
  if (!trace) {
    return;
  }

  trace.logs.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    level,
    stage,
    details,
  });
  trace.updatedAt = new Date().toISOString();

  if (trace.logs.length > MAX_TRACE_LOGS) {
    trace.logs.splice(0, trace.logs.length - MAX_TRACE_LOGS);
  }

  writeTraceToDisk(trace);
  void appendPlanImportJobLog(traceId, level, stage, details).catch(() => {});
}

export function markPlanImportTraceStatus(
  traceId: string,
  status: PlanImportTraceStatus,
  summary?: string,
) {
  const trace = getMutableTrace(traceId);
  if (!trace) {
    return;
  }

  trace.status = status;
  trace.summary = summary ?? trace.summary;
  trace.updatedAt = new Date().toISOString();
  writeTraceToDisk(trace);
  void updatePlanImportJob(traceId, {
    status,
    summary: trace.summary ?? null,
    finished_at:
      status === "completed" || status === "failed" || status === "cancelled"
        ? trace.updatedAt
        : null,
  }).catch(() => {});
}

export function requestPlanImportCancellation(traceId: string) {
  const trace = getMutableTrace(traceId);
  if (!trace) {
    return false;
  }

  trace.cancelRequested = true;
  trace.status = trace.status === "running" ? "cancel_requested" : trace.status;
  trace.updatedAt = new Date().toISOString();
  abortControllers.get(traceId)?.abort(
    new PlanImportCancelledError("La importacion del plano fue cancelada."),
  );
  writeTraceToDisk(trace);
  void updatePlanImportJob(traceId, {
    status: "cancel_requested",
    summary: trace.summary ?? "Cancelacion solicitada.",
  }).catch(() => {});
  return true;
}

export function registerPlanImportAbortController(traceId: string) {
  const existing = abortControllers.get(traceId);
  if (existing) {
    return existing;
  }

  const controller = new AbortController();
  abortControllers.set(traceId, controller);
  if (!abortPollers.has(traceId)) {
    const poller = setInterval(() => {
      const trace = readTraceFromDisk(traceId);
      if (trace?.cancelRequested) {
        controller.abort(
          new PlanImportCancelledError("La importacion del plano fue cancelada."),
        );
        return;
      }

      if (abortCloudPollInflight.has(traceId)) {
        return;
      }

      abortCloudPollInflight.add(traceId);
      void getPlanImportJobByTraceId(traceId)
        .then((job) => {
          if (job?.status !== "cancel_requested" && job?.status !== "cancelled") {
            return;
          }

          const currentTrace = getMutableTrace(traceId);
          if (currentTrace) {
            currentTrace.cancelRequested = true;
            currentTrace.status = "cancel_requested";
            currentTrace.summary = currentTrace.summary ?? "Cancelacion solicitada.";
            currentTrace.updatedAt = new Date().toISOString();
            writeTraceToDisk(currentTrace);
          }

          controller.abort(
            new PlanImportCancelledError("La importacion del plano fue cancelada."),
          );
        })
        .catch(() => {})
        .finally(() => {
          abortCloudPollInflight.delete(traceId);
        });
    }, 250);
    abortPollers.set(traceId, poller);
  }
  return controller;
}

export function getPlanImportAbortSignal(traceId: string) {
  return abortControllers.get(traceId)?.signal;
}

export function clearPlanImportAbortController(traceId: string) {
  abortControllers.delete(traceId);
  abortCloudPollInflight.delete(traceId);
  const poller = abortPollers.get(traceId);
  if (poller) {
    clearInterval(poller);
    abortPollers.delete(traceId);
  }
}

export function registerPlanImportCreatedMesas(
  traceId: string,
  eventoId: string,
  mesaIds: string[],
) {
  const trace = getMutableTrace(traceId);
  if (!trace) {
    return;
  }

  trace.eventoId = eventoId;
  trace.createdMesaIds = [
    ...new Set([...(trace.createdMesaIds ?? []), ...mesaIds]),
  ];
  trace.updatedAt = new Date().toISOString();
  writeTraceToDisk(trace);
  void updatePlanImportJob(traceId, {
    created_mesa_ids: trace.createdMesaIds,
  }).catch(() => {});
}

export function clearPlanImportCreatedMesas(traceId: string) {
  const trace = getMutableTrace(traceId);
  if (!trace) {
    return;
  }

  trace.createdMesaIds = [];
  trace.updatedAt = new Date().toISOString();
  writeTraceToDisk(trace);
  void updatePlanImportJob(traceId, {
    created_mesa_ids: [],
  }).catch(() => {});
}

export function isPlanImportCancellationRequested(traceId: string) {
  const trace = getMutableTrace(traceId);
  return trace?.cancelRequested ?? false;
}

export function assertPlanImportNotCancelled(traceId: string) {
  if (isPlanImportCancellationRequested(traceId)) {
    throw new PlanImportCancelledError();
  }
}

export async function assertPlanImportNotCancelledAsync(traceId: string) {
  assertPlanImportNotCancelled(traceId);

  const job = await getPlanImportJobByTraceId(traceId).catch(() => null);
  if (job?.status === "cancel_requested" || job?.status === "cancelled") {
    const trace = getMutableTrace(traceId);
    if (trace) {
      trace.cancelRequested = true;
      trace.status = "cancel_requested";
      trace.summary = trace.summary ?? "Cancelacion solicitada.";
      trace.updatedAt = new Date().toISOString();
      writeTraceToDisk(trace);
    }

    throw new PlanImportCancelledError();
  }
}

export function getPlanImportTraceSnapshot(traceId: string) {
  pruneExpiredTraces();
  const trace = getMutableTrace(traceId);
  return trace ? JSON.parse(JSON.stringify(trace)) as PlanImportTraceSnapshot : null;
}

export async function getPlanImportTraceSnapshotCloud(traceId: string) {
  const job = await getPlanImportJobByTraceId(traceId);
  if (!job) {
    return null;
  }

  const { listPlanImportJobLogs } = await import("@/lib/plan-import-cloud");
  const logs = await listPlanImportJobLogs(traceId);

  return {
    traceId: job.trace_id,
    status: job.status,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    cancelRequested: job.status === "cancel_requested" || job.status === "cancelled",
    logs: logs.map((entry) => ({
      id: String(entry.id),
      at: String(entry.created_at),
      level: entry.level,
      stage: entry.stage,
      details:
        entry.details && typeof entry.details === "object"
          ? (entry.details as Record<string, unknown>)
          : undefined,
    })),
    summary: job.summary ?? job.error_message ?? undefined,
    createdMesaIds: job.created_mesa_ids ?? undefined,
    eventoId: job.evento_id,
    eventoNombre: job.event_name ?? null,
    importedTables: Array.isArray(job.imported_tables)
      ? (job.imported_tables as ImportedPlanTable[])
      : undefined,
  } satisfies PlanImportTraceSnapshot;
}
