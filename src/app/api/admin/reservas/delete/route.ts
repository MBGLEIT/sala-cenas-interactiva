import { NextResponse } from "next/server";

import { isAdminAuthenticated } from "@/lib/admin-auth";
import { adminDeleteReservaSchema } from "@/lib/schemas";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  if (!isAdminAuthenticated()) {
    return NextResponse.json(
      { error: "No tienes acceso al panel admin." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsedBody = adminDeleteReservaSchema.safeParse(body);

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "La reserva indicada no es valida.",
        details: parsedBody.error.flatten(),
      },
      { status: 400 },
    );
  }

  const { error } = await supabaseAdmin
    .from("reservas")
    .delete()
    .eq("id", parsedBody.data.reservaId);

  if (error) {
    return NextResponse.json(
      { error: "No se pudo deshacer la reserva." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    message: "Reserva eliminada correctamente.",
  });
}
