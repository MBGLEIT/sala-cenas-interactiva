import { NextResponse } from "next/server";

import { isAdminAuthenticated } from "@/lib/admin-auth";
import { adminUpdateSillaSchema } from "@/lib/schemas";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  if (!isAdminAuthenticated()) {
    return NextResponse.json(
      { error: "No tienes acceso al panel admin." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsedBody = adminUpdateSillaSchema.safeParse(body);

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Los datos de la silla no son validos.",
        details: parsedBody.error.flatten(),
      },
      { status: 400 },
    );
  }

  const { sillaId, mesaId, numero } = parsedBody.data;

  const { error } = await supabaseAdmin
    .from("sillas")
    .update({
      mesa_id: mesaId,
      numero,
    })
    .eq("id", sillaId);

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Ya existe una silla con ese numero en la mesa." },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: "No se pudo actualizar la silla." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    message: "Silla actualizada correctamente.",
  });
}
