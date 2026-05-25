import { NextResponse } from "next/server";

import { processNextPlanImportJob } from "@/lib/plan-import-worker-service";
import { isRunningOnVercel } from "@/lib/runtime-env";

export const runtime = "nodejs";
export const maxDuration = 300;

function isWorkerAuthorized(request: Request) {
  const configuredToken = process.env.PLAN_IMPORT_WORKER_TOKEN?.trim();
  if (!configuredToken) {
    return false;
  }

  const bearerToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const directToken = request.headers.get("x-plan-import-worker-token")?.trim();

  return bearerToken === configuredToken || directToken === configuredToken;
}

export async function POST(request: Request) {
  if (isRunningOnVercel()) {
    return NextResponse.json(
      {
        error:
          "Este endpoint del worker solo debe ejecutarse en el servicio externo de importacion, no en el despliegue de Vercel.",
      },
      { status: 503 },
    );
  }

  if (!isWorkerAuthorized(request)) {
    return NextResponse.json({ error: "Worker no autorizado." }, { status: 401 });
  }

  const result = await processNextPlanImportJob();

  if (result.status === "idle") {
    return NextResponse.json(
      { message: "No hay importaciones pendientes en este momento." },
      { status: 200 },
    );
  }

  if (result.status === "completed") {
    return NextResponse.json({
      message: "Importacion procesada correctamente por el worker.",
      traceId: result.traceId,
      eventoId: result.eventoId,
      eventoNombre: result.eventoNombre,
      mesaIds: result.mesaIds,
      chairsCreated: result.chairsCreated,
    });
  }

  if (result.status === "cancelled") {
    return NextResponse.json(
      {
        error: result.message,
        traceId: result.traceId,
        cancelled: true,
      },
      { status: 409 },
    );
  }

  return NextResponse.json(
    {
      error: result.message,
      traceId: result.traceId,
    },
    { status: result.statusCode },
  );
}
