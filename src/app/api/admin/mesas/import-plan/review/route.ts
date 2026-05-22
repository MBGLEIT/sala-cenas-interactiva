import { NextResponse } from "next/server";

import { isAdminAuthenticated } from "@/lib/admin-auth";
import {
  cleanupImportedPlanSample,
  confirmImportedPlanSample,
} from "@/lib/plan-import-feedback";
import {
  isRunningOnVercel,
  PLAN_IMPORT_VERCEL_UNAVAILABLE_MESSAGE,
} from "@/lib/runtime-env";
import { adminImportPlanReviewSchema } from "@/lib/schemas";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAdminAuthenticated()) {
    return NextResponse.json({ error: "No tienes acceso al panel admin." }, { status: 401 });
  }

  if (isRunningOnVercel()) {
    return NextResponse.json(
      { error: PLAN_IMPORT_VERCEL_UNAVAILABLE_MESSAGE, unsupported: true },
      { status: 503 },
    );
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
      return NextResponse.json({ message: "Plano validado y guardado como ejemplo correcto." });
    }

    if (action === "dismiss") {
      await cleanupImportedPlanSample(traceId);
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
    return NextResponse.json({ message: "Plano importado eliminado correctamente." });
  } catch {
    return NextResponse.json(
      { error: "No se pudo completar la revision del plano." },
      { status: 500 },
    );
  }
}
