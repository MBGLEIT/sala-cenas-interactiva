import { NextResponse } from "next/server";

import { isAdminAuthenticated } from "@/lib/admin-auth";
import { adminCreateMesaSchema } from "@/lib/schemas";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  if (!isAdminAuthenticated()) {
    return NextResponse.json(
      { error: "No tienes acceso al panel admin." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsedBody = adminCreateMesaSchema.safeParse(body);

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Los datos de la mesa no son validos.",
        details: parsedBody.error.flatten(),
      },
      { status: 400 },
    );
  }

  const { eventoId, numero, posX, posY } = parsedBody.data;

  const { error } = await supabaseAdmin.from("mesas").insert({
    evento_id: eventoId,
    numero,
    pos_x: posX,
    pos_y: posY,
  });

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Ya existe una mesa con ese numero en el evento." },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: "No se pudo crear la mesa." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    message: "Mesa creada correctamente.",
  });
}
