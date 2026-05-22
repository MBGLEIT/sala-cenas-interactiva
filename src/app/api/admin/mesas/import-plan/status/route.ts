import { NextResponse } from "next/server";

import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getPlanImportTraceSnapshot } from "@/lib/plan-import-runtime";
import {
  isRunningOnVercel,
  PLAN_IMPORT_VERCEL_UNAVAILABLE_MESSAGE,
} from "@/lib/runtime-env";
import { adminImportPlanTraceSchema } from "@/lib/schemas";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isAdminAuthenticated()) {
    return NextResponse.json({ error: "No tienes acceso al panel admin." }, { status: 401 });
  }

  if (isRunningOnVercel()) {
    return NextResponse.json(
      { error: PLAN_IMPORT_VERCEL_UNAVAILABLE_MESSAGE, unsupported: true },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(request.url);
  const parsed = adminImportPlanTraceSchema.safeParse({
    traceId: searchParams.get("traceId") ?? "",
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "La traza de importacion no es valida." }, { status: 400 });
  }

  const trace = getPlanImportTraceSnapshot(parsed.data.traceId);

  if (!trace) {
    return NextResponse.json({ error: "No se encontro esa importacion." }, { status: 404 });
  }

  return NextResponse.json(trace);
}
