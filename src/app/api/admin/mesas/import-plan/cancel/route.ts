import { NextResponse } from "next/server";

import { isAdminAuthenticated } from "@/lib/admin-auth";
import {
  appendPlanImportTraceLog,
  beginPlanImportTrace,
  clearPlanImportCreatedMesas,
  getPlanImportTraceSnapshot,
  markPlanImportTraceStatus,
  requestPlanImportCancellation,
} from "@/lib/plan-import-runtime";
import {
  getPlanImportJobByTraceId,
  updatePlanImportJob,
  updatePlanImportSampleByTraceId,
} from "@/lib/plan-import-cloud";
import { adminImportPlanTraceSchema } from "@/lib/schemas";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAdminAuthenticated()) {
    return NextResponse.json({ error: "No tienes acceso al panel admin." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = adminImportPlanTraceSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "La cancelacion de la importacion no es valida." },
      { status: 400 },
    );
  }

  const trace = getPlanImportTraceSnapshot(parsed.data.traceId);
  const cloudJob = await getPlanImportJobByTraceId(parsed.data.traceId).catch(() => null);

  if (!trace && !cloudJob) {
    beginPlanImportTrace(parsed.data.traceId);
    requestPlanImportCancellation(parsed.data.traceId);
    markPlanImportTraceStatus(
      parsed.data.traceId,
      "cancel_requested",
      "Cancelacion solicitada antes de que la importacion empezase a procesarse.",
    );

    return NextResponse.json({
      message:
        "Cancelacion solicitada. Si la importacion arranca, se detendra antes de guardar cambios.",
    });
  }

  requestPlanImportCancellation(parsed.data.traceId);
  await updatePlanImportJob(parsed.data.traceId, {
    status: "cancel_requested",
    summary: "Cancelacion solicitada.",
  }).catch(() => null);

  const createdMesaIds = trace?.createdMesaIds?.length
    ? trace.createdMesaIds
    : cloudJob?.created_mesa_ids?.length
      ? cloudJob.created_mesa_ids
      : [];

  if (createdMesaIds.length > 0) {
    const { error } = await supabaseAdmin
      .from("mesas")
      .delete()
      .in("id", createdMesaIds);

    if (error) {
      appendPlanImportTraceLog(parsed.data.traceId, "error", "route.cancel.cleanup_failed", {
        message: error.message,
      });
      return NextResponse.json(
        {
          error:
            "La cancelacion se ha solicitado, pero no se pudieron borrar las mesas creadas por esta importacion.",
        },
        { status: 500 },
      );
    }

    clearPlanImportCreatedMesas(parsed.data.traceId);
    await updatePlanImportJob(parsed.data.traceId, {
      created_mesa_ids: [],
    }).catch(() => null);
    appendPlanImportTraceLog(parsed.data.traceId, "warn", "route.cancel.cleanup_completed", {
      deletedTables: createdMesaIds.length,
    });
  }

  markPlanImportTraceStatus(
    parsed.data.traceId,
    "cancelled",
    "Importacion cancelada y cambios de esa importacion eliminados.",
  );
  await updatePlanImportJob(parsed.data.traceId, {
    status: "cancelled",
    summary: "Importacion cancelada y cambios de esa importacion eliminados.",
    finished_at: new Date().toISOString(),
  }).catch(() => null);
  await updatePlanImportSampleByTraceId(parsed.data.traceId, {
    status: "deleted",
  }).catch(() => null);

  return NextResponse.json({
    message: "Importacion cancelada y cambios de esa importacion eliminados.",
  });
}
