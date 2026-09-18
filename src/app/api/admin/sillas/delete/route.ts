import { NextResponse } from "next/server";

import { logAdminAction } from "@/lib/admin-audit";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { adminDeleteSillaSchema } from "@/lib/schemas";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  if (!isAdminAuthenticated()) {
    return NextResponse.json(
      { error: "No tienes acceso al panel admin." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsedBody = adminDeleteSillaSchema.safeParse(body);

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "No se ha indicado una silla valida.",
        details: parsedBody.error.flatten(),
      },
      { status: 400 },
    );
  }

  const { error } = await supabaseAdmin
    .from("sillas")
    .delete()
    .eq("id", parsedBody.data.sillaId);

  if (error) {
    return NextResponse.json(
      { error: "No se pudo eliminar la silla." },
      { status: 500 },
    );
  }

  await logAdminAction({
    action: "chair.delete",
    targetType: "silla",
    targetId: parsedBody.data.sillaId,
  });

  return NextResponse.json({
    message: "Silla eliminada correctamente.",
  });
}
