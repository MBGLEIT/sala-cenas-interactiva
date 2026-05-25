import { NextResponse } from "next/server";

import { isAdminAuthenticated } from "@/lib/admin-auth";
import {
  cleanupImportedPlanSample,
  confirmImportedPlanSample,
} from "@/lib/plan-import-feedback";
import {
  updatePlanImportJob,
  updatePlanImportSampleByTraceId,
} from "@/lib/plan-import-cloud";
import { adminImportPlanReviewSchema } from "@/lib/schemas";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAdminAuthenticated()) {
    return NextResponse.json({ error: "No tienes acceso al panel admin." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = adminImportPlanReviewSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "La revision del plano no es valida." },
      { status: 400 },
    );
  }

  const { action, traceId, mesaIds } = parsed.data;

  try {
    if (action === "confirm") {
      await confirmImportedPlanSample(traceId);
      await updatePlanImportSampleByTraceId(traceId, {
        status: "validated",
        validated_at: new Date().toISOString(),
      }).catch(() => null);
      await updatePlanImportJob(traceId, {
        status: "completed",
        summary: "Plano validado y guardado como ejemplo correcto.",
        finished_at: new Date().toISOString(),
      }).catch(() => null);
      return NextResponse.json({ message: "Plano validado y guardado como ejemplo correcto." });
    }

    if (action === "dismiss") {
      await cleanupImportedPlanSample(traceId);
      await updatePlanImportSampleByTraceId(traceId, {
        status: "dismissed",
      }).catch(() => null);
      await updatePlanImportJob(traceId, {
        status: "completed",
        summary: "Revision cerrada. El plano se mantiene tal cual.",
      }).catch(() => null);
      return NextResponse.json({ message: "Revision cerrada. El plano se mantiene tal cual." });
    }

    if (mesaIds.length > 0) {
      const { error } = await supabaseAdmin.from("mesas").delete().in("id", mesaIds);

      if (error) {
        return NextResponse.json(
          { error: "No se pudieron borrar las mesas importadas." },
          { status: 500 },
        );
      }
    }

    await cleanupImportedPlanSample(traceId);
    await updatePlanImportSampleByTraceId(traceId, {
      status: "deleted",
    }).catch(() => null);
    await updatePlanImportJob(traceId, {
      status: "cancelled",
      summary: "Plano importado eliminado correctamente.",
      finished_at: new Date().toISOString(),
    }).catch(() => null);
    return NextResponse.json({ message: "Plano importado eliminado correctamente." });
  } catch {
    return NextResponse.json(
      { error: "No se pudo completar la revision del plano." },
      { status: 500 },
    );
  }
}
