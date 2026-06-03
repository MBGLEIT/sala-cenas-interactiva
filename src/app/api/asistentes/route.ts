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
    codigo: searchParams.get("codigo"),
  });

  if (!parsedQuery.success) {
    return NextResponse.json(
      {
        error: "Debes enviar un identificador o un codigo QR valido",
        details: parsedQuery.error.flatten(),
      },
      { status: 400 },
    );
  }

  const identificadorNormalizado = parsedQuery.data.identificador?.toUpperCase() ?? null;
  const codigoNormalizado = parsedQuery.data.codigo?.toUpperCase() ?? null;
  let data:
    | {
        id: string;
        nombre: string;
        identificador: string;
        evento_id: string;
        qr_reserva_token?: string | null;
      }
    | null = null;
  let error: { message?: string } | null = null;

  if (codigoNormalizado) {
    const qrResult = await supabase
      .from("asistentes")
      .select("id, nombre, identificador, evento_id, qr_reserva_token")
      .eq("qr_reserva_token", codigoNormalizado)
      .maybeSingle();

    if (qrResult.error) {
      error = qrResult.error;
    } else {
      data = qrResult.data;
    }

    if (!data) {
      const fallbackResult = await supabase
        .from("asistentes")
        .select("id, nombre, identificador, evento_id, qr_reserva_token")
        .ilike("identificador", codigoNormalizado)
        .maybeSingle();

      if (fallbackResult.error) {
        error = fallbackResult.error;
      } else {
        data = fallbackResult.data;
      }
    }
  } else if (identificadorNormalizado) {
    const identifierResult = await supabase
      .from("asistentes")
      .select("id, nombre, identificador, evento_id, qr_reserva_token")
      .ilike("identificador", identificadorNormalizado)
      .maybeSingle();

    error = identifierResult.error;
    data = identifierResult.data;
  }

  if (error) {
    return NextResponse.json(
      { error: "No se pudo buscar el asistente", details: error.message },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json(
      { error: "No existe ningun asistente con ese identificador o QR" },
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
