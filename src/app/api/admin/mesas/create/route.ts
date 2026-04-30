import { NextResponse } from "next/server";

import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getNextMesaPosition } from "@/lib/room-layout";
import { adminCreateMesaSchema } from "@/lib/schemas";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  if (!isAdminAuthenticated()) {
    return NextResponse.json(
      { error: "No tienes acceso al panel admin." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsedBody = adminCreateMesaSchema.safeParse(body);

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Los datos de la mesa no son validos.",
        details: parsedBody.error.flatten(),
      },
      { status: 400 },
    );
  }

  const { eventoId, numero, quantity, chairCount, posX, posY } = parsedBody.data;

  const { data: mesasExistentes, error: existingMesasError } = await supabaseAdmin
    .from("mesas")
    .select("id, numero")
    .eq("evento_id", eventoId)
    .order("numero", { ascending: true });

  if (existingMesasError) {
    return NextResponse.json(
      { error: "No se pudieron revisar las mesas existentes del evento." },
      { status: 500 },
    );
  }

  const existingTableCount = mesasExistentes?.length ?? 0;
  const existingNumbers = new Set((mesasExistentes ?? []).map((mesa) => mesa.numero));
  const targetNumbers = Array.from({ length: quantity }, (_, index) => numero + index);

  if (targetNumbers.some((targetNumber) => existingNumbers.has(targetNumber))) {
    return NextResponse.json(
      { error: "Ya existe al menos una mesa con esos numeros en el evento." },
      { status: 409 },
    );
  }

  const mesasToCreate = targetNumbers.map((targetNumber, index) => {
    const position =
      quantity === 1
        ? { posX, posY }
        : getNextMesaPosition(existingTableCount + index);

    return {
      evento_id: eventoId,
      numero: targetNumber,
      pos_x: position.posX,
      pos_y: position.posY,
    };
  });

  const { data: mesasCreadas, error } = await supabaseAdmin
    .from("mesas")
    .insert(mesasToCreate)
    .select("id, numero")
    .order("numero", { ascending: true });

  if (error || !mesasCreadas) {
    if (error?.code === "23505") {
      return NextResponse.json(
        { error: "Ya existe una mesa con ese numero en el evento." },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: "No se pudo crear la mesa." },
      { status: 500 },
    );
  }

  const sillas = mesasCreadas.flatMap((mesa) =>
    Array.from({ length: chairCount }, (_, index) => ({
      mesa_id: mesa.id,
      numero: index + 1,
    })),
  );

  const { error: chairsError } = await supabaseAdmin.from("sillas").insert(sillas);

  if (chairsError) {
    return NextResponse.json(
      { error: "Las mesas se crearon pero no se pudieron crear sus sillas." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    message:
      quantity === 1
        ? `Mesa creada correctamente con ${chairCount} sillas.`
        : `${quantity} mesas creadas correctamente con ${chairCount} sillas cada una.`,
    mesaId: mesasCreadas[0]?.id,
  });
}
