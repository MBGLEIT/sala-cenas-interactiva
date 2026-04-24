import { NextResponse } from "next/server";

import { isAdminAuthenticated } from "@/lib/admin-auth";
import { adminDeleteEventoSchema } from "@/lib/schemas";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  if (!isAdminAuthenticated()) {
    return NextResponse.json(
      { error: "No tienes acceso al panel admin." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsedBody = adminDeleteEventoSchema.safeParse(body);

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "No se ha indicado un evento valido.",
        details: parsedBody.error.flatten(),
      },
      { status: 400 },
    );
  }

  const { error } = await supabaseAdmin
    .from("eventos")
    .delete()
    .eq("id", parsedBody.data.eventoId);

  if (error) {
    return NextResponse.json(
      { error: "No se pudo eliminar el evento." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    message: "Evento eliminado correctamente.",
  });
}
