import { NextResponse } from "next/server";

import { isAdminAuthenticated } from "@/lib/admin-auth";
import { adminUpdateEventoSchema } from "@/lib/schemas";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  if (!isAdminAuthenticated()) {
    return NextResponse.json(
      { error: "No tienes acceso al panel admin." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsedBody = adminUpdateEventoSchema.safeParse(body);

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Los datos del evento no son validos.",
        details: parsedBody.error.flatten(),
      },
      { status: 400 },
    );
  }

  const { eventoId, nombre, fecha } = parsedBody.data;

  const { error } = await supabaseAdmin
    .from("eventos")
    .update({
      nombre,
      fecha,
    })
    .eq("id", eventoId);

  if (error) {
    return NextResponse.json(
      { error: "No se pudo actualizar el evento." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    message: "Evento actualizado correctamente.",
  });
}
