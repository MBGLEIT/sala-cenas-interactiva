import { NextResponse } from "next/server";

import { logAdminAction } from "@/lib/admin-audit";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { adminCreateSillaSchema } from "@/lib/schemas";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json(
      { error: "No tienes acceso al panel admin." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsedBody = adminCreateSillaSchema.safeParse(body);

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Los datos de la silla no son validos.",
        details: parsedBody.error.flatten(),
      },
      { status: 400 },
    );
  }

  const { mesaId, numero } = parsedBody.data;

  const { data, error } = await supabaseAdmin
    .from("sillas")
    .insert({
      mesa_id: mesaId,
      numero,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Ya existe una silla con ese numero en la mesa." },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: "No se pudo crear la silla." },
      { status: 500 },
    );
  }

  await logAdminAction({
    action: "chair.create",
    targetType: "silla",
    targetId: data.id,
    details: {
      mesaId,
      numero,
    },
  });

  return NextResponse.json({
    message: "Silla creada correctamente.",
  });
}
