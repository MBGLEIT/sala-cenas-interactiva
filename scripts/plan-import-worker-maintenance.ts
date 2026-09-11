import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const ACTIVE_JOB_STATUSES = ["pending", "running", "cancel_requested"] as const;

function readFlag(name: string) {
  return process.argv.includes(name);
}

async function cleanActiveJobs() {
  const { supabaseAdmin } = await import("../src/lib/supabase-admin");
  const { data, error } = await supabaseAdmin
    .from("plan_import_jobs")
    .select("trace_id,status,runtime_mode,file_name,created_at")
    .in("status", [...ACTIVE_JOB_STATUSES]);

  if (error) {
    throw new Error(`No se pudo consultar la cola: ${error.message}`);
  }

  const activeJobs = data ?? [];

  if (activeJobs.length === 0) {
    console.info("Cola limpia: no hay jobs activos.");
    return;
  }

  const { data: updatedJobs, error: updateError } = await supabaseAdmin
    .from("plan_import_jobs")
    .update({
      status: "cancelled",
      summary: "Cola limpiada manualmente antes de reiniciar el worker.",
      error_message: null,
      finished_at: new Date().toISOString(),
    })
    .in("status", [...ACTIVE_JOB_STATUSES])
    .select("trace_id,status,file_name");

  if (updateError) {
    throw new Error(`No se pudo limpiar la cola: ${updateError.message}`);
  }

  console.info(`Cola limpiada: ${updatedJobs?.length ?? 0} job(s) cancelado(s).`);
  for (const job of activeJobs) {
    console.info(`- ${job.trace_id} | ${job.status} | ${job.file_name}`);
  }
}

async function main() {
  if (readFlag("--clean-active")) {
    await cleanActiveJobs();
    return;
  }

  console.info("Uso: tsx scripts/plan-import-worker-maintenance.ts --clean-active");
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
});
