import { NextResponse } from "next/server";

import { isAdminAuthenticated } from "@/lib/admin-auth";
import { doesTableOverlapProtectedTitle } from "@/lib/room-layout";
import { adminUpdateMesaSchema } from "@/lib/schemas";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  if (!isAdminAuthenticated()) {
    return NextResponse.json(
      { error: "No tienes acceso al panel admin." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsedBody = adminUpdateMesaSchema.safeParse(body);

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Los datos de la mesa no son validos.",
        details: parsedBody.error.flatten(),
      },
      { status: 400 },
    );
  }

  const { mesaId, numero, posX, posY } = parsedBody.data;

  const { data: mesaData, error: mesaLookupError } = await supabaseAdmin
    .from("mesas")
    .select("evento_id")
    .eq("id", mesaId)
    .maybeSingle();

  if (mesaLookupError || !mesaData) {
    return NextResponse.json(
      { error: "No se pudo localizar la mesa que quieres actualizar." },
      { status: 404 },
    );
  }

  const [{ data: eventoData, error: eventoError }, { count: chairCount, error: chairCountError }] =
    await Promise.all([
      supabaseAdmin.from("eventos").select("nombre").eq("id", mesaData.evento_id).maybeSingle(),
      supabaseAdmin
        .from("sillas")
        .select("id", { head: true, count: "exact" })
        .eq("mesa_id", mesaId),
    ]);

  if (eventoError || !eventoData || chairCountError) {
    return NextResponse.json(
      { error: "No se pudo validar la posicion de la mesa." },
      { status: 500 },
    );
  }

  if (
    doesTableOverlapProtectedTitle(
      posX,
      posY,
      chairCount ?? 8,
      eventoData.nombre ?? "EVENTO",
    )
  ) {
    return NextResponse.json(
      { error: "No se puede colocar una mesa dentro de la zona protegida del nombre del evento." },
      { status: 400 },
    );
  }

  const { error } = await supabaseAdmin
    .from("mesas")
    .update({
      numero,
      pos_x: posX,
      pos_y: posY,
    })
    .eq("id", mesaId);

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Ya existe una mesa con ese numero en el evento." },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: "No se pudo actualizar la mesa." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    message: "Mesa actualizada correctamente.",
  });
}
