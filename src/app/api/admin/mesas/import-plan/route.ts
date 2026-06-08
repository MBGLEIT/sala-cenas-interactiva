import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import {
  getValidatedPlanLearningContext,
  stageImportedPlanSample,
} from "@/lib/plan-import-feedback";
import {
  buildPlanImportImageSha256,
  ensurePlanImportJob,
  upsertPlanImportSample,
  updatePlanImportJob,
  uploadPlanImportFile,
  uploadPlanImportSampleFile,
} from "@/lib/plan-import-cloud";
import { importTablesFromPlanFile, type PlanImportHints, type ImportedPlanTable } from "@/lib/plan-import";
import {
  getPlanImportMode,
  isRunningOnVercel,
  PLAN_IMPORT_FILE_SIZE_MESSAGE,
  PLAN_IMPORT_SAFE_FILE_SIZE_BYTES,
  shouldQueuePlanImportOnVercel,
} from "@/lib/runtime-env";
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
import { adminImportPlanSchema } from "@/lib/schemas";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 300;

function parseOptionalPositiveInt(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
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

function routeLog(
  traceId: string,
  level: "info" | "warn" | "error",
  stage: string,
  details?: Record<string, unknown>,
) {
  const label = `[plan-import-route:${traceId}] ${stage}`;

  if (level === "warn") {
    if (details) {
      console.warn(label, details);
    } else {
      console.warn(label);
    }
  } else if (level === "error") {
    if (details) {
      console.error(label, details);
    } else {
      console.error(label);
    }
  } else if (details) {
    console.info(label, details);
  } else {
    console.info(label);
  }

  appendPlanImportTraceLog(traceId, level, `route.${stage}`, details);
}

export async function POST(request: Request) {
  const initialFormData = await request.formData().catch(() => null);
  const requestedTraceId = initialFormData?.get("clientTraceId");
  const traceId =
    typeof requestedTraceId === "string" && requestedTraceId.trim().length >= 4
      ? requestedTraceId.trim().slice(0, 100)
      : crypto.randomUUID().slice(0, 8);
  beginPlanImportTrace(traceId);
  registerPlanImportAbortController(traceId);
  routeLog(traceId, "info", "request.started");
  const planImportMode = getPlanImportMode();
  const queueOnVercel = shouldQueuePlanImportOnVercel();

  try {

  if (!isAdminAuthenticated()) {
    routeLog(traceId, "warn", "request.unauthorized");
    markPlanImportTraceStatus(traceId, "failed", "No autorizado.");
    return NextResponse.json(
      { error: "No tienes acceso al panel admin.", traceId },
      { status: 401 },
    );
  }

  const formData = initialFormData;
  const eventoId = formData?.get("eventoId");
  const file = formData?.get("file");
  const expectedTableCount = parseOptionalPositiveInt(formData?.get("expectedTableCount") ?? null);
  const expectedRowCount = parseOptionalPositiveInt(formData?.get("expectedRowCount") ?? null);
  const expectedColumnCount = parseOptionalPositiveInt(formData?.get("expectedColumnCount") ?? null);
  const expectedChairTotal = parseOptionalPositiveInt(formData?.get("expectedChairTotal") ?? null);
  const clientTraceId = typeof formData?.get("clientTraceId") === "string" ? String(formData?.get("clientTraceId")) : undefined;

  const parsedBody = adminImportPlanSchema.safeParse({
    eventoId: typeof eventoId === "string" ? eventoId : "",
    expectedTableCount,
    expectedRowCount,
    expectedColumnCount,
    expectedChairTotal,
    clientTraceId,
  });

  if (!parsedBody.success) {
    routeLog(traceId, "warn", "request.invalid_event");
    markPlanImportTraceStatus(traceId, "failed", "Solicitud invalida.");
    return NextResponse.json(
      { error: "Falta el evento al que quieres cargar el plano.", traceId },
      { status: 400 },
    );
  }

  if (!(file instanceof File) || file.size === 0) {
    routeLog(traceId, "warn", "request.missing_file");
    markPlanImportTraceStatus(traceId, "failed", "Falta el archivo del plano.");
    return NextResponse.json(
      { error: "Debes subir un archivo con el plano de sala.", traceId },
      { status: 400 },
    );
  }

  if (file.size > PLAN_IMPORT_SAFE_FILE_SIZE_BYTES) {
    routeLog(traceId, "warn", "request.file_too_large", {
      fileName: file.name,
      fileSize: file.size,
      maxBytes: PLAN_IMPORT_SAFE_FILE_SIZE_BYTES,
    });
    markPlanImportTraceStatus(traceId, "failed", PLAN_IMPORT_FILE_SIZE_MESSAGE);
    clearPlanImportAbortController(traceId);
    return NextResponse.json(
      {
        error: PLAN_IMPORT_FILE_SIZE_MESSAGE,
        traceId,
      },
      { status: 413 },
    );
  }

  if (!file.type.toLowerCase().startsWith("image/")) {
    routeLog(traceId, "warn", "request.invalid_file_type", {
      fileName: file.name,
      fileType: file.type,
    });
    markPlanImportTraceStatus(traceId, "failed", "Tipo de archivo no valido.");
    return NextResponse.json(
      {
        error:
          "El importador de planos solo admite imagenes por ahora. Usa PNG, JPG, JPEG o WEBP.",
        traceId,
      },
      { status: 400 },
    );
  }

  routeLog(traceId, "info", "request.validated", {
    eventoId: parsedBody.data.eventoId,
    fileName: file.name,
    fileType: file.type,
    fileSize: file.size,
    hints: {
      expectedTableCount: parsedBody.data.expectedTableCount ?? null,
      expectedRowCount: parsedBody.data.expectedRowCount ?? null,
      expectedColumnCount: parsedBody.data.expectedColumnCount ?? null,
      expectedChairTotal: parsedBody.data.expectedChairTotal ?? null,
    },
  });

  const uploadBytes = new Uint8Array(await file.arrayBuffer());
  const uploadedFilePath = await uploadPlanImportFile(
    traceId,
    file.name,
    file.type || "application/octet-stream",
    uploadBytes,
  ).catch((error) => {
    routeLog(traceId, "warn", "request.cloud_upload_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  });

  await ensurePlanImportJob({
    traceId,
    eventoId: parsedBody.data.eventoId,
    fileName: file.name,
    fileMimeType: file.type || "application/octet-stream",
    fileSize: file.size,
    eventName: null,
    filePath: uploadedFilePath,
    hints: {
      expectedTableCount: parsedBody.data.expectedTableCount,
      expectedRowCount: parsedBody.data.expectedRowCount,
      expectedColumnCount: parsedBody.data.expectedColumnCount,
      expectedChairTotal: parsedBody.data.expectedChairTotal,
    },
    runtimeMode: isRunningOnVercel() ? "vercel" : "local",
    status: queueOnVercel ? "pending" : "running",
  }).catch((error) => {
    routeLog(traceId, "warn", "request.cloud_job_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  });

  const { data: mesasExistentes, error: mesasExistentesError } = await supabaseAdmin
    .from("mesas")
    .select("numero")
    .eq("evento_id", parsedBody.data.eventoId);

  const { data: eventoData } = await supabaseAdmin
    .from("eventos")
    .select("nombre")
    .eq("id", parsedBody.data.eventoId)
    .maybeSingle();

  if (mesasExistentesError) {
    routeLog(traceId, "error", "existing_tables.failed", { message: mesasExistentesError.message });
    markPlanImportTraceStatus(traceId, "failed", "No se pudieron revisar las mesas existentes.");
    return NextResponse.json(
      { error: "No se pudieron revisar las mesas existentes del evento.", traceId },
      { status: 500 },
    );
  }

  const existingNumbers = new Set((mesasExistentes ?? []).map((mesa) => mesa.numero));
  routeLog(traceId, "info", "existing_tables.loaded", {
    count: existingNumbers.size,
  });
  await updatePlanImportJob(traceId, {
    event_name: eventoData?.nombre ?? null,
    summary: queueOnVercel
      ? "Plano recibido y encolado para procesamiento cloud."
      : `Plano recibido y listo para procesarse en modo ${planImportMode}.`,
  }).catch(() => null);

  let importedTables;
  const importHints: PlanImportHints = {
    expectedTableCount: parsedBody.data.expectedTableCount,
    expectedRowCount: parsedBody.data.expectedRowCount,
    expectedColumnCount: parsedBody.data.expectedColumnCount,
    expectedChairTotal: parsedBody.data.expectedChairTotal,
    eventName: eventoData?.nombre ?? undefined,
  };
  const learningContext = await getValidatedPlanLearningContext(importHints);
  if (learningContext) {
    importHints.learningContext = learningContext;
    routeLog(traceId, "info", "learning_context.loaded", {
      length: learningContext.length,
    });
  }

  if (queueOnVercel) {
    routeLog(traceId, "info", "request.queued_for_worker", {
      traceId,
      filePath: uploadedFilePath,
      planImportMode,
    });
    markPlanImportTraceStatus(
      traceId,
      "pending",
      "Plano en cola para el worker de importacion.",
    );
    await updatePlanImportJob(traceId, {
      status: "pending",
      summary: "Plano en cola para el worker de importacion.",
    }).catch(() => null);
    clearPlanImportAbortController(traceId);
    return NextResponse.json(
      {
        message:
          "Plano recibido correctamente. La importacion se ha puesto en cola y empezara en cuanto el worker lo reclame.",
        traceId,
        queued: true,
        mode: planImportMode,
      },
      { status: 202 },
    );
  }

  try {
    await updatePlanImportJob(traceId, {
      started_at: new Date().toISOString(),
      summary: `Procesando importacion del plano en modo ${planImportMode}.`,
      processor_version: queueOnVercel ? "worker-importer-v1" : `direct-${planImportMode}-importer-v1`,
      status: "running",
    }).catch(() => null);
    importedTables = await importTablesFromPlanFile(
      file,
      mesasExistentes?.length ?? 0,
      importHints,
      { traceId },
    );
  } catch (error) {
    if (error instanceof PlanImportCancelledError) {
      routeLog(traceId, "warn", "request.cancelled");
      markPlanImportTraceStatus(traceId, "cancelled", "Importacion cancelada.");
      return NextResponse.json(
        {
          error: "La importacion del plano fue cancelada.",
          traceId,
          cancelled: true,
        },
        { status: 409 },
      );
    }

    routeLog(traceId, "error", "import.failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    markPlanImportTraceStatus(traceId, "failed", "No se pudo interpretar la imagen.");
    return NextResponse.json(
      {
        error:
          "No se ha podido interpretar esa imagen. Intenta usar una captura clara donde se lean bien las etiquetas M:x y S:x.",
        traceId,
      },
      { status: 400 },
    );
  }

  try {
    await assertPlanImportNotCancelledAsync(traceId);
  } catch (error) {
    routeLog(traceId, "warn", "request.cancelled_before_insert");
    markPlanImportTraceStatus(traceId, "cancelled", "Importacion cancelada antes de guardar.");
    return NextResponse.json(
      {
        error: "La importacion del plano fue cancelada antes de guardar los cambios.",
        traceId,
        cancelled: true,
      },
      { status: 409 },
    );
  }

  routeLog(traceId, "info", "import.completed", {
    importedTables: importedTables.length,
    sample: importedTables.slice(0, 5),
  });
  await updatePlanImportJob(traceId, {
    imported_tables: importedTables,
    summary: `Importacion interpretada con ${importedTables.length} mesas antes de insertar.`,
  }).catch(() => null);

  const importStats = getImportedPlanStats(importedTables);
  const validationErrors: string[] = [];

  if (
    typeof parsedBody.data.expectedTableCount === "number" &&
    importStats.tableCount !== parsedBody.data.expectedTableCount
  ) {
    validationErrors.push(
      `mesas detectadas ${importStats.tableCount} de ${parsedBody.data.expectedTableCount} esperadas`,
    );
  }

  if (
    typeof parsedBody.data.expectedChairTotal === "number" &&
    importStats.chairTotal !== parsedBody.data.expectedChairTotal
  ) {
    validationErrors.push(
      `sillas detectadas ${importStats.chairTotal} de ${parsedBody.data.expectedChairTotal} esperadas`,
    );
  }

  if (
    typeof parsedBody.data.expectedRowCount === "number" &&
    importStats.rowCount !== parsedBody.data.expectedRowCount
  ) {
    validationErrors.push(
      `filas detectadas ${importStats.rowCount} de ${parsedBody.data.expectedRowCount} esperadas`,
    );
  }

  if (
    typeof parsedBody.data.expectedColumnCount === "number" &&
    importStats.columnCount !== parsedBody.data.expectedColumnCount
  ) {
    validationErrors.push(
      `columnas detectadas ${importStats.columnCount} de ${parsedBody.data.expectedColumnCount} esperadas`,
    );
  }

  if (validationErrors.length > 0) {
    routeLog(traceId, "warn", "import.validation_failed", {
      validationErrors,
      importStats,
    });
    markPlanImportTraceStatus(traceId, "failed", validationErrors.join(", "));
    return NextResponse.json(
      {
        error: `La importacion no cuadra con los datos esperados: ${validationErrors.join(", ")}.`,
        traceId,
      },
      { status: 422 },
    );
  }

  if (importedTables.length === 0) {
    routeLog(traceId, "warn", "import.empty");
    markPlanImportTraceStatus(traceId, "failed", "No se encontraron mesas.");
    return NextResponse.json(
      {
        error:
          "No se han encontrado mesas legibles en ese archivo. Usa el formato M:x y S:x o un plano donde esos datos se vean con claridad.",
        traceId,
      },
      { status: 400 },
    );
  }

  if (importedTables.some((table) => existingNumbers.has(table.numero))) {
    routeLog(traceId, "warn", "import.conflict_existing_numbers");
    markPlanImportTraceStatus(traceId, "failed", "Hay numeros de mesa en conflicto.");
    return NextResponse.json(
      {
        error:
          "El plano incluye numeros de mesa que ya existen en este evento. Corrigelos o usa otro rango de mesas.",
        traceId,
      },
      { status: 409 },
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
    routeLog(traceId, "warn", "import.conflict_duplicate_numbers", {
      duplicatedImportedNumbers,
    });
    markPlanImportTraceStatus(traceId, "failed", "La imagen genero numeros duplicados.");
    return NextResponse.json(
      {
        error:
          "La imagen ha generado numeros de mesa duplicados. Prueba otra vez con una captura mas clara o ajustamos el lector.",
        traceId,
      },
      { status: 409 },
    );
  }

  try {
    await assertPlanImportNotCancelledAsync(traceId);
  } catch {
    routeLog(traceId, "warn", "request.cancelled_before_tables_insert");
    markPlanImportTraceStatus(traceId, "cancelled", "Importacion cancelada antes de crear mesas.");
    return NextResponse.json(
      {
        error: "La importacion del plano fue cancelada antes de crear las mesas.",
        traceId,
        cancelled: true,
      },
      { status: 409 },
    );
  }

  const mesasPayload = importedTables.map((table) => ({
    evento_id: parsedBody.data.eventoId,
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
    routeLog(traceId, "error", "tables_insert.failed", {
      message: mesasError?.message ?? "Error desconocido al crear mesas.",
    });
    markPlanImportTraceStatus(traceId, "failed", "No se pudieron crear las mesas.");
    return NextResponse.json(
      { error: "No se pudieron crear las mesas del plano.", traceId },
      { status: 500 },
    );
  }

  registerPlanImportCreatedMesas(
    traceId,
    parsedBody.data.eventoId,
    mesasCreadas.map((mesa) => mesa.id),
  );
  routeLog(traceId, "info", "tables_insert.completed", {
    count: mesasCreadas.length,
  });

  const mesaIdByNumero = new Map(mesasCreadas.map((mesa) => [mesa.numero, mesa.id]));

  const chairsPayload = importedTables.flatMap((table) =>
    Array.from({ length: table.chairCount }, (_, index) => ({
      mesa_id: mesaIdByNumero.get(table.numero),
      numero: index + 1,
    })),
  );

  try {
    await assertPlanImportNotCancelledAsync(traceId);
  } catch {
    if (mesasCreadas.length > 0) {
      await supabaseAdmin.from("mesas").delete().in("id", mesasCreadas.map((mesa) => mesa.id));
      clearPlanImportCreatedMesas(traceId);
    }
    routeLog(traceId, "warn", "request.cancelled_before_chairs_insert");
    markPlanImportTraceStatus(traceId, "cancelled", "Importacion cancelada antes de crear sillas.");
    return NextResponse.json(
      {
        error: "La importacion del plano fue cancelada antes de crear las sillas.",
        traceId,
        cancelled: true,
      },
      { status: 409 },
    );
  }

  const { error: chairsError } = await supabaseAdmin.from("sillas").insert(chairsPayload);

  if (chairsError) {
    if (mesasCreadas.length > 0) {
      await supabaseAdmin.from("mesas").delete().in("id", mesasCreadas.map((mesa) => mesa.id));
      clearPlanImportCreatedMesas(traceId);
    }
    routeLog(traceId, "error", "chairs_insert.failed", {
      message: chairsError.message,
    });
    markPlanImportTraceStatus(traceId, "failed", "No se pudieron crear las sillas.");
    return NextResponse.json(
      { error: "Se crearon las mesas, pero no se pudieron crear sus sillas.", traceId },
      { status: 500 },
    );
  }

  try {
    await assertPlanImportNotCancelledAsync(traceId);
  } catch {
    if (mesasCreadas.length > 0) {
      await supabaseAdmin.from("mesas").delete().in("id", mesasCreadas.map((mesa) => mesa.id));
      clearPlanImportCreatedMesas(traceId);
    }
    routeLog(traceId, "warn", "request.cancelled_after_chairs_insert");
    markPlanImportTraceStatus(
      traceId,
      "cancelled",
      "Importacion cancelada y cambios de esa importacion eliminados.",
    );
    return NextResponse.json(
      {
        error: "La importacion del plano fue cancelada y se han eliminado sus cambios.",
        traceId,
        cancelled: true,
      },
      { status: 409 },
    );
  }

  routeLog(traceId, "info", "request.succeeded", {
    tables: importedTables.length,
    chairs: chairsPayload.length,
  });
  markPlanImportTraceStatus(
    traceId,
    "completed",
    `Importacion completada con ${importedTables.length} mesas y ${chairsPayload.length} sillas.`,
  );
  await updatePlanImportJob(traceId, {
    status: "review_pending",
    imported_tables: importedTables,
    created_mesa_ids: mesasCreadas.map((mesa) => mesa.id),
    summary: `Importacion completada con ${importedTables.length} mesas y ${chairsPayload.length} sillas.`,
    finished_at: new Date().toISOString(),
  }).catch(() => null);
  const stagedSampleImagePath = await uploadPlanImportSampleFile(
    traceId,
    file.name,
    file.type || "application/octet-stream",
    uploadBytes,
  ).catch(() => null);
  await upsertPlanImportSample({
    traceId,
    eventoId: parsedBody.data.eventoId,
    status: "staged",
    eventName: eventoData?.nombre ?? null,
    fileName: file.name,
    imagePath: stagedSampleImagePath,
    imageSha256: buildPlanImportImageSha256(uploadBytes),
    hints: importHints,
    importedTables,
  }).catch(() => null);

  void stageImportedPlanSample(
    {
      traceId,
      eventoId: parsedBody.data.eventoId,
      eventName: eventoData?.nombre ?? undefined,
      fileName: file.name,
      hints: importHints,
      importedTables,
    },
    Buffer.from(await file.arrayBuffer()),
  ).catch((error) => {
    console.warn(`[plan-import-route:${traceId}] sample_stage.failed`, error);
  });

  return NextResponse.json({
    message: `Plano cargado correctamente con ${importedTables.length} mesas y ${chairsPayload.length} sillas.`,
    traceId,
    importedTables,
    mesaIds: mesasCreadas.map((mesa) => mesa.id),
    eventoNombre: eventoData?.nombre ?? null,
  });
  } finally {
    clearPlanImportAbortController(traceId);
  }
}
