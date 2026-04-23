import { NextResponse } from "next/server";

import { NO_STORE_HEADERS } from "@/lib/http";
import { buscarAsistenteSchema } from "@/lib/schemas";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsedQuery = buscarAsistenteSchema.safeParse({
    identificador: searchParams.get("identificador"),
  });

  if (!parsedQuery.success) {
    return NextResponse.json(
      {
        error: "Debes enviar un identificador valido",
        details: parsedQuery.error.flatten(),
      },
      { status: 400 },
    );
  }

  const identificadorNormalizado = parsedQuery.data.identificador.toUpperCase();

  const { data, error } = await supabase
    .from("asistentes")
    .select("id, nombre, identificador, evento_id")
    .ilike("identificador", identificadorNormalizado)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "No se pudo buscar el asistente", details: error.message },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json(
      { error: "No existe ningun asistente con ese identificador" },
      { status: 404 },
    );
  }

  return NextResponse.json({
    message: "Asistente encontrado",
    asistente: data,
  }, {
    headers: NO_STORE_HEADERS,
  });
}
