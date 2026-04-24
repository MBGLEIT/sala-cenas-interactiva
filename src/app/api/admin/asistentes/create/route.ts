import { NextResponse } from "next/server";

import { isAdminAuthenticated } from "@/lib/admin-auth";
import { adminCreateAsistenteSchema } from "@/lib/schemas";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  if (!isAdminAuthenticated()) {
    return NextResponse.json(
      { error: "No tienes acceso al panel admin." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsedBody = adminCreateAsistenteSchema.safeParse(body);

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Los datos del asistente no son validos.",
        details: parsedBody.error.flatten(),
      },
      { status: 400 },
    );
  }

  const { eventoId, nombre, identificador } = parsedBody.data;

  const { error } = await supabaseAdmin.from("asistentes").insert({
    evento_id: eventoId,
    nombre,
    identificador: identificador.toUpperCase(),
  });

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Ya existe un asistente con ese identificador." },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: "No se pudo crear el asistente." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    message: "Asistente creado correctamente.",
  });
}
