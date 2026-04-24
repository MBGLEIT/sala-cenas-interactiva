import { NextResponse } from "next/server";

import { isAdminAuthenticated } from "@/lib/admin-auth";
import { adminDeleteAsistenteSchema } from "@/lib/schemas";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  if (!isAdminAuthenticated()) {
    return NextResponse.json(
      { error: "No tienes acceso al panel admin." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsedBody = adminDeleteAsistenteSchema.safeParse(body);

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "No se ha indicado un asistente valido.",
        details: parsedBody.error.flatten(),
      },
      { status: 400 },
    );
  }

  const { error } = await supabaseAdmin
    .from("asistentes")
    .delete()
    .eq("id", parsedBody.data.asistenteId);

  if (error) {
    return NextResponse.json(
      { error: "No se pudo eliminar el asistente." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    message: "Asistente eliminado correctamente.",
  });
}
