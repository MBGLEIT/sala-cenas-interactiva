import { NextResponse } from "next/server";

import { isAdminAuthenticated } from "@/lib/admin-auth";
import { adminDeleteMesaSchema } from "@/lib/schemas";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  if (!isAdminAuthenticated()) {
    return NextResponse.json(
      { error: "No tienes acceso al panel admin." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsedBody = adminDeleteMesaSchema.safeParse(body);

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "No se ha indicado una mesa valida o un evento valido.",
        details: parsedBody.error.flatten(),
      },
      { status: 400 },
    );
  }

  const deleteQuery = supabaseAdmin.from("mesas").delete();
  const { error } =
    "deleteAll" in parsedBody.data
      ? await deleteQuery.eq("evento_id", parsedBody.data.eventoId)
      : await deleteQuery.eq("id", parsedBody.data.mesaId);

  if (error) {
    return NextResponse.json(
      {
        error:
          "deleteAll" in parsedBody.data
            ? "No se pudieron eliminar todas las mesas."
            : "No se pudo eliminar la mesa.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    message:
      "deleteAll" in parsedBody.data
        ? "Todas las mesas se eliminaron correctamente."
        : "Mesa eliminada correctamente.",
  });
}
