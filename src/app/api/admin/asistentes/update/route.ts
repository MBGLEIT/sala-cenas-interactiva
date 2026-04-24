import { NextResponse } from "next/server";

import { isAdminAuthenticated } from "@/lib/admin-auth";
import { adminUpdateAsistenteSchema } from "@/lib/schemas";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  if (!isAdminAuthenticated()) {
    return NextResponse.json(
      { error: "No tienes acceso al panel admin." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsedBody = adminUpdateAsistenteSchema.safeParse(body);

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Los datos del asistente no son validos.",
        details: parsedBody.error.flatten(),
      },
      { status: 400 },
    );
  }

  const { asistenteId, nombre, identificador } = parsedBody.data;

  const { error } = await supabaseAdmin
    .from("asistentes")
    .update({
      nombre,
      identificador: identificador.toUpperCase(),
    })
    .eq("id", asistenteId);

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Ya existe un asistente con ese identificador." },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: "No se pudo actualizar el asistente." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    message: "Asistente actualizado correctamente.",
  });
}
