import { NextResponse } from "next/server";

import { isAdminAuthenticated } from "@/lib/admin-auth";
import { adminUpsertReservaSchema } from "@/lib/schemas";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  if (!isAdminAuthenticated()) {
    return NextResponse.json(
      { error: "No tienes acceso al panel admin." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsedBody = adminUpsertReservaSchema.safeParse(body);

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Los datos de recolocacion no son validos.",
        details: parsedBody.error.flatten(),
      },
      { status: 400 },
    );
  }

  const { eventoId, sillaId, asistenteId } = parsedBody.data;

  const [asistenteResult, sillaResult, reservaAsistenteResult, reservaSillaResult] =
    await Promise.all([
      supabaseAdmin
        .from("asistentes")
        .select("id, evento_id")
        .eq("id", asistenteId)
        .maybeSingle(),
      supabaseAdmin
        .from("sillas")
        .select("id, mesa_id")
        .eq("id", sillaId)
        .maybeSingle(),
      supabaseAdmin
        .from("reservas")
        .select("id, silla_id")
        .eq("asistente_id", asistenteId)
        .maybeSingle(),
      supabaseAdmin
        .from("reservas")
        .select("id, asistente_id")
        .eq("silla_id", sillaId)
        .maybeSingle(),
    ]);

  if (
    asistenteResult.error ||
    sillaResult.error ||
    reservaAsistenteResult.error ||
    reservaSillaResult.error
  ) {
    return NextResponse.json(
      { error: "No se pudieron validar los datos de la recolocacion." },
      { status: 500 },
    );
  }

  if (!asistenteResult.data) {
    return NextResponse.json(
      { error: "El asistente indicado no existe." },
      { status: 404 },
    );
  }

  if (!sillaResult.data) {
    return NextResponse.json(
      { error: "La silla indicada no existe." },
      { status: 404 },
    );
  }

  const mesaResult = await supabaseAdmin
    .from("mesas")
    .select("id, evento_id")
    .eq("id", sillaResult.data.mesa_id)
    .maybeSingle();

  if (mesaResult.error || !mesaResult.data) {
    return NextResponse.json(
      { error: "No se pudo comprobar la mesa de la silla elegida." },
      { status: 500 },
    );
  }

  if (
    asistenteResult.data.evento_id !== eventoId ||
    mesaResult.data.evento_id !== eventoId
  ) {
    return NextResponse.json(
      { error: "Asistente y silla deben pertenecer al mismo evento." },
      { status: 409 },
    );
  }

  if (
    reservaSillaResult.data &&
    reservaSillaResult.data.asistente_id !== asistenteId
  ) {
    return NextResponse.json(
      { error: "La silla elegida ya esta ocupada por otra persona." },
      { status: 409 },
    );
  }

  if (
    reservaAsistenteResult.data &&
    reservaAsistenteResult.data.silla_id === sillaId
  ) {
    return NextResponse.json({
      message: "El asistente ya estaba en esa silla.",
    });
  }

  if (reservaAsistenteResult.data) {
    const { error: updateError } = await supabaseAdmin
      .from("reservas")
      .update({ silla_id: sillaId })
      .eq("id", reservaAsistenteResult.data.id);

    if (updateError) {
      return NextResponse.json(
        { error: "No se pudo recolocar la reserva existente." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      message: "Reserva recolocada correctamente.",
    });
  }

  const { error: insertError } = await supabaseAdmin.from("reservas").insert({
    silla_id: sillaId,
    asistente_id: asistenteId,
  });

  if (insertError) {
    return NextResponse.json(
      { error: "No se pudo crear la reserva desde el panel admin." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    message: "Reserva creada correctamente desde el panel admin.",
  });
}
