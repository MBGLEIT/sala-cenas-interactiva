import { NextResponse } from "next/server";

import { isAdminAuthenticated } from "@/lib/admin-auth";
import { adminCreateEventoSchema } from "@/lib/schemas";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  if (!isAdminAuthenticated()) {
    return NextResponse.json(
      { error: "No tienes acceso al panel admin." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsedBody = adminCreateEventoSchema.safeParse(body);

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Los datos del evento no son validos.",
        details: parsedBody.error.flatten(),
      },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("eventos")
    .insert({
      nombre: parsedBody.data.nombre,
      fecha: parsedBody.data.fecha,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json(
      { error: "No se pudo crear el evento." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    message: "Evento creado correctamente.",
    eventoId: data.id,
  });
}
