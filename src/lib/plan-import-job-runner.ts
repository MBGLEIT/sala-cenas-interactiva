import {
  buildPlanImportImageSha256,
  downloadPlanImportFile,
  getPlanImportJobByTraceId,
  updatePlanImportJob,
  upsertPlanImportSample,
  uploadPlanImportSampleFile,
} from "@/lib/plan-import-cloud";
import {
  getValidatedPlanLearningContext,
} from "@/lib/plan-import-feedback";
import {
  importTablesFromPlanFile,
  type ImportedPlanTable,
  type PlanImportHints,
} from "@/lib/plan-import";
import {
  appendPlanImportTraceLog,
  assertPlanImportNotCancelledAsync,
  beginPlanImportTrace,
  clearPlanImportAbortController,
  clearPlanImportCreatedMesas,
  markPlanImportTraceStatus,
  PlanImportCancelledError,
  registerPlanImportAbortController,
  registerPlanImportCreatedMesas,
} from "@/lib/plan-import-runtime";
import { supabaseAdmin } from "@/lib/supabase-admin";

type PlanImportJobRunnerResult = {
  importedTables: ImportedPlanTable[];
  eventoNombre: string | null;
  mesaIds: string[];
  chairsCreated: number;
};

export class PlanImportJobRunnerError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "PlanImportJobRunnerError";
  }
}

function inferClusterCount(values: number[], tolerance = 120) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  let clusters = 1;
  let anchor = sorted[0];

  for (let index = 1; index < sorted.length; index += 1) {
    if (Math.abs(sorted[index] - anchor) > tolerance) {
      clusters += 1;
      anchor = sorted[index];
    }
  }

  return clusters;
}

function getImportedPlanStats(tables: ImportedPlanTable[]) {
  return {
    tableCount: tables.length,
    chairTotal: tables.reduce((sum, table) => sum + table.chairCount, 0),
    rowCount: inferClusterCount(tables.map((table) => table.posY)),
    columnCount: inferClusterCount(tables.map((table) => table.posX)),
  };
}

function logJob(traceId: string, level: "info" | "warn" | "error", stage: string, details?: Record<string, unknown>) {
  const label = `[plan-import-worker:${traceId}] ${stage}`;
  if (level === "error") {
    console.error(label, details);
  } else if (level === "warn") {
    console.warn(label, details);
  } else {
    console.info(label, details);
  }
  appendPlanImportTraceLog(traceId, level, `worker.${stage}`, details);
}

export async function executePlanImportJobFromStorage(traceId: string): Promise<PlanImportJobRunnerResult> {
  beginPlanImportTrace(traceId);
  registerPlanImportAbortController(traceId);

  try {
    const job = await getPlanImportJobByTraceId(traceId);
    if (!job) {
      throw new PlanImportJobRunnerError("No se encontro el job de importacion.", 404);
    }

    if (!job.file_path) {
      throw new PlanImportJobRunnerError("El job no tiene imagen asociada en storage.", 400);
    }

    const fileBytes = await downloadPlanImportFile(job.file_path);
    const file = new File([fileBytes], job.file_name, {
      type: job.file_mime_type || "application/octet-stream",
    });

    await updatePlanImportJob(traceId, {
      status: "running",
      summary: "Worker procesando importacion del plano.",
      started_at: new Date().toISOString(),
      processor_version: "storage-worker-v1",
    });

    const { data: mesasExistentes, error: mesasExistentesError } = await supabaseAdmin
      .from("mesas")
      .select("numero")
      .eq("evento_id", job.evento_id);

    const { data: eventoData } = await supabaseAdmin
      .from("eventos")
      .select("nombre")
      .eq("id", job.evento_id)
      .maybeSingle();

    if (mesasExistentesError) {
      logJob(traceId, "error", "existing_tables.failed", { message: mesasExistentesError.message });
      throw new PlanImportJobRunnerError("No se pudieron revisar las mesas existentes del evento.", 500);
    }

    const existingNumbers = new Set((mesasExistentes ?? []).map((mesa) => mesa.numero));
    const hints = (job.hints ?? {}) as PlanImportHints;
    const importHints: PlanImportHints = {
      expectedTableCount: hints.expectedTableCount,
      expectedRowCount: hints.expectedRowCount,
      expectedColumnCount: hints.expectedColumnCount,
      expectedChairTotal: hints.expectedChairTotal,
      eventName: eventoData?.nombre ?? hints.eventName,
    };
    const learningContext = await getValidatedPlanLearningContext(importHints);
    if (learningContext) {
      importHints.learningContext = learningContext;
    }

    let importedTables: ImportedPlanTable[];

    try {
      importedTables = await importTablesFromPlanFile(
        file,
        mesasExistentes?.length ?? 0,
        importHints,
        { traceId },
      );
    } catch (error) {
      if (error instanceof PlanImportCancelledError) {
        markPlanImportTraceStatus(traceId, "cancelled", "Importacion cancelada.");
        await updatePlanImportJob(traceId, {
          status: "cancelled",
          summary: "Importacion cancelada.",
          finished_at: new Date().toISOString(),
        });
        throw error;
      }

      logJob(traceId, "error", "import.failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      throw new PlanImportJobRunnerError(
        "No se ha podido interpretar esa imagen. Intenta usar una captura clara donde se lean bien las etiquetas M:x y S:x.",
        400,
      );
    }

    await assertPlanImportNotCancelledAsync(traceId);

    const importStats = getImportedPlanStats(importedTables);
    const validationErrors: string[] = [];

    if (
      typeof importHints.expectedTableCount === "number" &&
      importStats.tableCount !== importHints.expectedTableCount
    ) {
      validationErrors.push(
        `mesas detectadas ${importStats.tableCount} de ${importHints.expectedTableCount} esperadas`,
      );
    }

    if (
      typeof importHints.expectedChairTotal === "number" &&
      importStats.chairTotal !== importHints.expectedChairTotal
    ) {
      validationErrors.push(
        `sillas detectadas ${importStats.chairTotal} de ${importHints.expectedChairTotal} esperadas`,
      );
    }

    if (
      typeof importHints.expectedRowCount === "number" &&
      importStats.rowCount !== importHints.expectedRowCount
    ) {
      validationErrors.push(
        `filas detectadas ${importStats.rowCount} de ${importHints.expectedRowCount} esperadas`,
      );
    }

    if (
      typeof importHints.expectedColumnCount === "number" &&
      importStats.columnCount !== importHints.expectedColumnCount
    ) {
      validationErrors.push(
        `columnas detectadas ${importStats.columnCount} de ${importHints.expectedColumnCount} esperadas`,
      );
    }

    if (validationErrors.length > 0) {
      logJob(traceId, "warn", "import.validation_failed", { validationErrors, importStats });
      throw new PlanImportJobRunnerError(
        `La importacion no cuadra con los datos esperados: ${validationErrors.join(", ")}.`,
        422,
      );
    }

    if (importedTables.length === 0) {
      throw new PlanImportJobRunnerError(
        "No se han encontrado mesas legibles en ese archivo.",
        400,
      );
    }

    if (importedTables.some((table) => existingNumbers.has(table.numero))) {
      throw new PlanImportJobRunnerError(
        "El plano incluye numeros de mesa que ya existen en este evento.",
        409,
      );
    }

    const importedNumberSet = new Set<number>();
    const duplicatedImportedNumbers = importedTables
      .map((table) => table.numero)
      .filter((numero) => {
        if (importedNumberSet.has(numero)) {
          return true;
        }
        importedNumberSet.add(numero);
        return false;
      });

    if (duplicatedImportedNumbers.length > 0) {
      throw new PlanImportJobRunnerError(
        "La imagen ha generado numeros de mesa duplicados.",
        409,
      );
    }

    const mesasPayload = importedTables.map((table) => ({
      evento_id: job.evento_id,
      numero: table.numero,
      pos_x: table.posX,
      pos_y: table.posY,
    }));

    const { data: mesasCreadas, error: mesasError } = await supabaseAdmin
      .from("mesas")
      .insert(mesasPayload)
      .select("id, numero")
      .order("numero", { ascending: true });

    if (mesasError || !mesasCreadas) {
      throw new PlanImportJobRunnerError("No se pudieron crear las mesas del plano.", 500);
    }

    registerPlanImportCreatedMesas(
      traceId,
      job.evento_id,
      mesasCreadas.map((mesa) => mesa.id),
    );

    const mesaIdByNumero = new Map(mesasCreadas.map((mesa) => [mesa.numero, mesa.id]));
    const chairsPayload = importedTables.flatMap((table) =>
      Array.from({ length: table.chairCount }, (_, index) => ({
        mesa_id: mesaIdByNumero.get(table.numero),
        numero: index + 1,
      })),
    );

    await assertPlanImportNotCancelledAsync(traceId);

    const { error: chairsError } = await supabaseAdmin.from("sillas").insert(chairsPayload);

    if (chairsError) {
      await supabaseAdmin.from("mesas").delete().in("id", mesasCreadas.map((mesa) => mesa.id));
      clearPlanImportCreatedMesas(traceId);
      throw new PlanImportJobRunnerError(
        "Se crearon las mesas, pero no se pudieron crear sus sillas.",
        500,
      );
    }

    await assertPlanImportNotCancelledAsync(traceId);

    await updatePlanImportJob(traceId, {
      status: "review_pending",
      imported_tables: importedTables,
      created_mesa_ids: mesasCreadas.map((mesa) => mesa.id),
      event_name: eventoData?.nombre ?? null,
      summary: `Importacion completada con ${importedTables.length} mesas y ${chairsPayload.length} sillas.`,
      finished_at: new Date().toISOString(),
    });

    const stagedSampleImagePath = await uploadPlanImportSampleFile(
      traceId,
      job.file_name,
      job.file_mime_type || "application/octet-stream",
      fileBytes,
    ).catch(() => null);

    await upsertPlanImportSample({
      jobId: job.id,
      traceId,
      eventoId: job.evento_id,
      status: "staged",
      eventName: eventoData?.nombre ?? null,
      fileName: job.file_name,
      imagePath: stagedSampleImagePath,
      imageSha256: buildPlanImportImageSha256(fileBytes),
      hints: importHints,
      importedTables,
    }).catch(() => null);

    return {
      importedTables,
      eventoNombre: eventoData?.nombre ?? null,
      mesaIds: mesasCreadas.map((mesa) => mesa.id),
      chairsCreated: chairsPayload.length,
    };
  } finally {
    clearPlanImportAbortController(traceId);
  }
}
