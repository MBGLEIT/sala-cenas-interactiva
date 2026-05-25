import {
  claimNextPlanImportJob,
  updatePlanImportJob,
  type PlanImportJobRow,
} from "@/lib/plan-import-cloud";
import {
  executePlanImportJobFromStorage,
  PlanImportJobRunnerError,
} from "@/lib/plan-import-job-runner";

export type PlanImportWorkerResult =
  | {
      status: "idle";
    }
  | {
      status: "completed";
      traceId: string;
      job: PlanImportJobRow;
      eventoId: string;
      eventoNombre: string | null;
      mesaIds: string[];
      chairsCreated: number;
    }
  | {
      status: "cancelled";
      traceId: string;
      job: PlanImportJobRow;
      message: string;
    }
  | {
      status: "failed";
      traceId: string;
      job: PlanImportJobRow;
      message: string;
      statusCode: number;
    };

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Fallo inesperado procesando la importacion.";
}

export async function processNextPlanImportJob(): Promise<PlanImportWorkerResult> {
  const claimedJob = await claimNextPlanImportJob("worker");

  if (!claimedJob) {
    return {
      status: "idle",
    };
  }

  try {
    const result = await executePlanImportJobFromStorage(claimedJob.trace_id);

    return {
      status: "completed",
      traceId: claimedJob.trace_id,
      job: claimedJob,
      eventoId: claimedJob.evento_id,
      eventoNombre: result.eventoNombre,
      mesaIds: result.mesaIds,
      chairsCreated: result.chairsCreated,
    };
  } catch (error) {
    if (error instanceof PlanImportJobRunnerError) {
      await updatePlanImportJob(claimedJob.trace_id, {
        status: "failed",
        summary: error.message,
        error_message: error.message,
        finished_at: new Date().toISOString(),
      }).catch(() => null);

      return {
        status: "failed",
        traceId: claimedJob.trace_id,
        job: claimedJob,
        message: error.message,
        statusCode: error.statusCode,
      };
    }

    if ((error as Error)?.name === "PlanImportCancelledError") {
      const message = "Importacion cancelada por el worker.";
      await updatePlanImportJob(claimedJob.trace_id, {
        status: "cancelled",
        summary: message,
        error_message: null,
        finished_at: new Date().toISOString(),
      }).catch(() => null);

      return {
        status: "cancelled",
        traceId: claimedJob.trace_id,
        job: claimedJob,
        message,
      };
    }

    const message = getErrorMessage(error);
    await updatePlanImportJob(claimedJob.trace_id, {
      status: "failed",
      summary: message,
      error_message: message,
      finished_at: new Date().toISOString(),
    }).catch(() => null);

    return {
      status: "failed",
      traceId: claimedJob.trace_id,
      job: claimedJob,
      message,
      statusCode: 500,
    };
  }
}

export type RunPlanImportWorkerLoopOptions = {
  pollMs?: number;
  maxJobs?: number;
  signal?: AbortSignal;
  onTick?: (result: PlanImportWorkerResult) => void | Promise<void>;
};

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function runPlanImportWorkerLoop(
  options: RunPlanImportWorkerLoopOptions = {},
) {
  const pollMs = Math.max(500, options.pollMs ?? 5000);
  const maxJobs = options.maxJobs ?? Number.POSITIVE_INFINITY;
  let processedJobs = 0;

  while (!options.signal?.aborted && processedJobs < maxJobs) {
    const result = await processNextPlanImportJob();
    await options.onTick?.(result);

    if (result.status === "idle") {
      await wait(pollMs);
      continue;
    }

    processedJobs += 1;
  }
}
