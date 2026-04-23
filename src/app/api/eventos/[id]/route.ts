import { NextResponse } from "next/server";

import {
  EVENTO_SALA_SELECT,
  EventoQueryResult,
  normalizeEventoSala,
} from "@/lib/dinner-room";
import { NO_STORE_HEADERS } from "@/lib/http";
import { eventoIdSchema } from "@/lib/schemas";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function GET(
  _request: Request,
  context: { params: { id: string } },
) {
  const parsedParams = eventoIdSchema.safeParse(context.params);

  if (!parsedParams.success) {
    return NextResponse.json(
      {
        error: "El id del evento no tiene un formato valido",
        details: parsedParams.error.flatten(),
      },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("eventos")
    .select(EVENTO_SALA_SELECT)
    .eq("id", parsedParams.data.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "No se pudo leer el evento", details: error.message },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json(
      { error: "No existe un evento con ese id" },
      { status: 404 },
    );
  }

  const evento = normalizeEventoSala(data as EventoQueryResult);

  return NextResponse.json(evento, {
    headers: NO_STORE_HEADERS,
  });
}
