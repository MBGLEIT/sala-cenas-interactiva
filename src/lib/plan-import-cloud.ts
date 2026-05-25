import { createHash } from "node:crypto";

import type {
  ImportedPlanTable,
  PlanImportHints,
} from "@/lib/plan-import";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type PlanImportJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancel_requested"
  | "cancelled"
  | "review_pending";

export type PlanImportLogLevel = "info" | "warn" | "error";

export type PlanImportJobRow = {
  id: string;
  trace_id: string;
  evento_id: string;
  status: PlanImportJobStatus;
  runtime_mode: "local" | "vercel" | "worker";
  file_name: string;
  file_path: string | null;
  file_mime_type: string | null;
  file_size: number | null;
  event_name: string | null;
  hints: PlanImportHints | Record<string, unknown>;
  imported_tables: ImportedPlanTable[] | null;
  summary: string | null;
  error_message: string | null;
  created_mesa_ids: string[] | null;
  processor_version: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
};

type PlanImportSampleStatus = "staged" | "validated" | "dismissed" | "deleted";

export type PlanImportSampleRow = {
  id: string;
  job_id: string | null;
  trace_id: string;
  evento_id: string;
  status: PlanImportSampleStatus;
  event_name: string | null;
  file_name: string;
  image_path: string | null;
  image_sha256: string | null;
  sample_signature: string | null;
  hints: PlanImportHints | Record<string, unknown>;
  imported_tables: ImportedPlanTable[];
  staged_at: string;
  validated_at: string | null;
  updated_at: string;
};

type CreatePlanImportJobInput = {
  traceId: string;
  eventoId: string;
  fileName: string;
  fileMimeType?: string | null;
  fileSize?: number | null;
  eventName?: string | null;
  filePath?: string | null;
  hints?: PlanImportHints;
  runtimeMode?: "local" | "vercel" | "worker";
  status?: PlanImportJobStatus;
};

const PLAN_IMPORT_BUCKET = "plan-imports";

export function getPlanImportStoragePath(traceId: string, fileName: string) {
  const safeName = fileName.replace(/[^\w.\-]+/g, "-");
  return `jobs/${traceId}/${safeName}`;
}

export function getPlanImportSampleStoragePath(traceId: string, fileName: string) {
  const safeName = fileName.replace(/[^\w.\-]+/g, "-");
  return `samples/${traceId}/${safeName}`;
}

export async function ensurePlanImportJob(input: CreatePlanImportJobInput) {
  const payload = {
    trace_id: input.traceId,
    evento_id: input.eventoId,
    file_name: input.fileName,
    file_mime_type: input.fileMimeType ?? null,
    file_size: input.fileSize ?? null,
    file_path: input.filePath ?? null,
    event_name: input.eventName ?? null,
    hints: input.hints ?? {},
    runtime_mode: input.runtimeMode ?? "local",
    status: input.status ?? "pending",
  };

  const { data, error } = await supabaseAdmin
    .from("plan_import_jobs")
    .upsert(payload, { onConflict: "trace_id" })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`No se pudo crear el job de importacion: ${error?.message ?? "sin datos"}`);
  }

  return data as PlanImportJobRow;
}

export async function getPlanImportJobByTraceId(traceId: string) {
  const { data, error } = await supabaseAdmin
    .from("plan_import_jobs")
    .select("*")
    .eq("trace_id", traceId)
    .maybeSingle();

  if (error) {
    throw new Error(`No se pudo cargar el job de importacion: ${error.message}`);
  }

  return (data ?? null) as PlanImportJobRow | null;
}

export async function claimNextPlanImportJob(workerMode: "worker" | "local" = "worker") {
  const { data, error } = await supabaseAdmin.rpc("claim_next_plan_import_job", {
    worker_mode: workerMode,
  });

  if (error) {
    throw new Error(`No se pudo reclamar el siguiente job pendiente: ${error.message}`);
  }

  return (data ?? null) as PlanImportJobRow | null;
}

export async function updatePlanImportJob(
  traceId: string,
  patch: Partial<{
    status: PlanImportJobStatus;
    summary: string | null;
    error_message: string | null;
    imported_tables: ImportedPlanTable[] | null;
    created_mesa_ids: string[] | null;
    event_name: string | null;
    file_path: string | null;
    started_at: string | null;
    finished_at: string | null;
    processor_version: string | null;
  }>,
) {
  const nextPatch: Record<string, unknown> = {
    ...patch,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from("plan_import_jobs")
    .update(nextPatch)
    .eq("trace_id", traceId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`No se pudo actualizar el job de importacion: ${error?.message ?? "sin datos"}`);
  }

  return data as PlanImportJobRow;
}

export async function appendPlanImportJobLog(
  traceId: string,
  level: PlanImportLogLevel,
  stage: string,
  details?: Record<string, unknown>,
) {
  const job = await getPlanImportJobByTraceId(traceId);
  if (!job) {
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from("plan_import_logs")
    .insert({
      job_id: job.id,
      trace_id: traceId,
      level,
      stage,
      details: details ?? null,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`No se pudo escribir el log del importador: ${error.message}`);
  }

  return data;
}

export async function listPlanImportJobLogs(traceId: string) {
  const { data, error } = await supabaseAdmin
    .from("plan_import_logs")
    .select("*")
    .eq("trace_id", traceId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`No se pudieron leer los logs del importador: ${error.message}`);
  }

  return data ?? [];
}

export async function uploadPlanImportFile(
  traceId: string,
  fileName: string,
  mimeType: string,
  bytes: Uint8Array,
) {
  const filePath = getPlanImportStoragePath(traceId, fileName);
  const { error } = await supabaseAdmin.storage
    .from(PLAN_IMPORT_BUCKET)
    .upload(filePath, bytes, {
      contentType: mimeType,
      upsert: true,
    });

  if (error) {
    throw new Error(`No se pudo subir la imagen del plano: ${error.message}`);
  }

  return filePath;
}

export async function uploadPlanImportSampleFile(
  traceId: string,
  fileName: string,
  mimeType: string,
  bytes: Uint8Array,
) {
  const filePath = getPlanImportSampleStoragePath(traceId, fileName);
  const { error } = await supabaseAdmin.storage
    .from(PLAN_IMPORT_BUCKET)
    .upload(filePath, bytes, {
      contentType: mimeType,
      upsert: true,
    });

  if (error) {
    throw new Error(`No se pudo subir la imagen validada del plano: ${error.message}`);
  }

  return filePath;
}

export async function downloadPlanImportFile(filePath: string) {
  const { data, error } = await supabaseAdmin.storage
    .from(PLAN_IMPORT_BUCKET)
    .download(filePath);

  if (error || !data) {
    throw new Error(`No se pudo descargar la imagen del plano: ${error?.message ?? "sin datos"}`);
  }

  return new Uint8Array(await data.arrayBuffer());
}

export async function upsertPlanImportSample(input: {
  jobId?: string | null;
  traceId: string;
  eventoId: string;
  status: PlanImportSampleStatus;
  eventName?: string | null;
  fileName: string;
  imagePath?: string | null;
  imageSha256?: string | null;
  sampleSignature?: string | null;
  hints?: PlanImportHints;
  importedTables: ImportedPlanTable[];
  validatedAt?: string | null;
}) {
  const payload = {
    job_id: input.jobId ?? null,
    trace_id: input.traceId,
    evento_id: input.eventoId,
    status: input.status,
    event_name: input.eventName ?? null,
    file_name: input.fileName,
    image_path: input.imagePath ?? null,
    image_sha256: input.imageSha256 ?? null,
    sample_signature: input.sampleSignature ?? null,
    hints: input.hints ?? {},
    imported_tables: input.importedTables,
    validated_at: input.validatedAt ?? null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from("plan_import_samples")
    .upsert(payload, { onConflict: "trace_id" })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`No se pudo guardar la muestra del importador: ${error?.message ?? "sin datos"}`);
  }

  return data as PlanImportSampleRow;
}

export async function getPlanImportSampleByTraceId(traceId: string) {
  const { data, error } = await supabaseAdmin
    .from("plan_import_samples")
    .select("*")
    .eq("trace_id", traceId)
    .maybeSingle();

  if (error) {
    throw new Error(`No se pudo cargar la muestra del importador: ${error.message}`);
  }

  return (data ?? null) as PlanImportSampleRow | null;
}

export async function updatePlanImportSampleByTraceId(
  traceId: string,
  patch: Partial<{
    status: PlanImportSampleStatus;
    validated_at: string | null;
    updated_at: string;
  }>,
) {
  const payload: Record<string, unknown> = {
    ...patch,
    updated_at: patch.updated_at ?? new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from("plan_import_samples")
    .update(payload)
    .eq("trace_id", traceId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`No se pudo actualizar la muestra del importador: ${error.message}`);
  }

  return (data ?? null) as PlanImportSampleRow | null;
}

export async function listValidatedPlanImportSamples() {
  const { data, error } = await supabaseAdmin
    .from("plan_import_samples")
    .select("*")
    .eq("status", "validated")
    .order("validated_at", { ascending: false });

  if (error) {
    throw new Error(`No se pudieron leer las muestras validadas: ${error.message}`);
  }

  return (data ?? []) as PlanImportSampleRow[];
}

export function buildPlanImportImageSha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
