import { NextResponse } from "next/server";

import { isAdminAuthenticated } from "@/lib/admin-auth";
import { importTablesFromPlanFile } from "@/lib/plan-import";
import { adminImportPlanSchema } from "@/lib/schemas";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  if (!isAdminAuthenticated()) {
    return NextResponse.json(
      { error: "No tienes acceso al panel admin." },
      { status: 401 },
    );
  }

  const formData = await request.formData().catch(() => null);
  const eventoId = formData?.get("eventoId");
  const file = formData?.get("file");

  const parsedBody = adminImportPlanSchema.safeParse({
    eventoId: typeof eventoId === "string" ? eventoId : "",
  });

  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Falta el evento al que quieres cargar el plano." },
      { status: 400 },
    );
  }

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { error: "Debes subir un archivo con el plano de sala." },
      { status: 400 },
    );
  }

  const { data: mesasExistentes, error: mesasExistentesError } = await supabaseAdmin
    .from("mesas")
    .select("numero")
    .eq("evento_id", parsedBody.data.eventoId);

  if (mesasExistentesError) {
    return NextResponse.json(
      { error: "No se pudieron revisar las mesas existentes del evento." },
      { status: 500 },
    );
  }

  const existingNumbers = new Set((mesasExistentes ?? []).map((mesa) => mesa.numero));

  let importedTables;

  try {
    importedTables = await importTablesFromPlanFile(
      file,
      mesasExistentes?.length ?? 0,
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "No se ha podido interpretar ese archivo. El importador admite PDF, imagenes, TXT, CSV, XLSX, DOCX y JSON, y funciona mejor si el plano muestra M:x y S:x con claridad.",
      },
      { status: 400 },
    );
  }

  if (importedTables.length === 0) {
    return NextResponse.json(
      {
        error:
          "No se han encontrado mesas legibles en ese archivo. Usa el formato M:x y S:x o un plano donde esos datos se vean con claridad.",
      },
      { status: 400 },
    );
  }

  if (importedTables.some((table) => existingNumbers.has(table.numero))) {
    return NextResponse.json(
      {
        error:
          "El plano incluye numeros de mesa que ya existen en este evento. Corrigelos o usa otro rango de mesas.",
      },
      { status: 409 },
    );
  }

  const mesasPayload = importedTables.map((table) => ({
    evento_id: parsedBody.data.eventoId,
    numero: table.numero,
    pos_x: table.posX,
    pos_y: table.posY,
  }));

  const { data: mesasCreadas, error: mesasError } = await supabaseAdmin
    .from("mesas")
    .insert(mesasPayload)
    .select("id, numero")
    .order("numero", { ascending: true });

  if (mesasError || !mesasCreadas) {
    return NextResponse.json(
      { error: "No se pudieron crear las mesas del plano." },
      { status: 500 },
    );
  }

  const mesaIdByNumero = new Map(mesasCreadas.map((mesa) => [mesa.numero, mesa.id]));

  const chairsPayload = importedTables.flatMap((table) =>
    Array.from({ length: table.chairCount }, (_, index) => ({
      mesa_id: mesaIdByNumero.get(table.numero),
      numero: index + 1,
    })),
  );

  const { error: chairsError } = await supabaseAdmin.from("sillas").insert(chairsPayload);

  if (chairsError) {
    return NextResponse.json(
      { error: "Se crearon las mesas, pero no se pudieron crear sus sillas." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    message: `Plano cargado correctamente con ${importedTables.length} mesas y ${chairsPayload.length} sillas.`,
  });
}
