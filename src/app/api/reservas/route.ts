import { NextResponse } from "next/server";

import { crearReservaSchema } from "@/lib/schemas";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsedBody = crearReservaSchema.safeParse(body);

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "El cuerpo de la peticion no es valido",
        details: parsedBody.error.flatten(),
      },
      { status: 400 },
    );
  }

  const {
    sillaId,
    asistenteId,
    esCeliaco,
    tieneAlergias,
    movilidadReducida,
    observaciones,
  } = parsedBody.data;

  const [asistenteResult, sillaResult] = await Promise.all([
    supabase
      .from("asistentes")
      .select("id, evento_id")
      .eq("id", asistenteId)
      .maybeSingle(),
    supabase.from("sillas").select("id, mesa_id").eq("id", sillaId).maybeSingle(),
  ]);

  if (asistenteResult.error || sillaResult.error) {
    return NextResponse.json(
      { error: "No se pudieron validar los datos enviados" },
      { status: 500 },
    );
  }

  if (!asistenteResult.data) {
    return NextResponse.json(
      { error: "El asistente indicado no existe" },
      { status: 404 },
    );
  }

  if (!sillaResult.data) {
    return NextResponse.json(
      { error: "La silla indicada no existe" },
      { status: 404 },
    );
  }

  const mesaResult = await supabase
    .from("mesas")
    .select("id, evento_id")
    .eq("id", sillaResult.data.mesa_id)
    .maybeSingle();

  if (mesaResult.error) {
    return NextResponse.json(
      { error: "No se pudo comprobar a que evento pertenece la silla" },
      { status: 500 },
    );
  }

  if (!mesaResult.data) {
    return NextResponse.json(
      { error: "La mesa asociada a la silla no existe" },
      { status: 404 },
    );
  }

  if (mesaResult.data.evento_id !== asistenteResult.data.evento_id) {
    return NextResponse.json(
      {
        error:
          "El asistente y la silla no pertenecen al mismo evento, asi que no se pueden unir",
      },
      { status: 409 },
    );
  }

  const [reservaSilla, reservaAsistente] = await Promise.all([
    supabase
      .from("reservas")
      .select("id")
      .eq("silla_id", sillaId)
      .maybeSingle(),
    supabase
      .from("reservas")
      .select("id")
      .eq("asistente_id", asistenteId)
      .maybeSingle(),
  ]);

  if (reservaSilla.error || reservaAsistente.error) {
    return NextResponse.json(
      { error: "No se pudo comprobar si la reserva entra en conflicto" },
      { status: 500 },
    );
  }

  if (reservaSilla.data) {
    return NextResponse.json(
      { error: "La silla ya esta ocupada" },
      { status: 409 },
    );
  }

  if (reservaAsistente.data) {
    return NextResponse.json(
      { error: "El asistente ya tiene una reserva asignada" },
      { status: 409 },
    );
  }

  const { data, error } = await supabase
    .from("reservas")
    .insert({
      silla_id: sillaId,
      asistente_id: asistenteId,
      es_celiaco: esCeliaco,
      tiene_alergias: tieneAlergias,
      movilidad_reducida: movilidadReducida,
      observaciones: observaciones || null,
    })
    .select(
      "id, silla_id, asistente_id, created_at, es_celiaco, tiene_alergias, movilidad_reducida, observaciones",
    )
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "La reserva entro en conflicto porque la silla ya no estaba libre" },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: "No se pudo guardar la reserva", details: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      message: "Reserva creada correctamente",
      reserva: data,
    },
    { status: 201 },
  );
}
