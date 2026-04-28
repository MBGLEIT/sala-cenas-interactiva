import { NextResponse } from "next/server";

import { isAdminAuthenticated } from "@/lib/admin-auth";
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

  const { eventoId, numero, chairCount, posX, posY } = parsedBody.data;

  const { data: mesaCreada, error } = await supabaseAdmin
    .from("mesas")
    .insert({
      evento_id: eventoId,
      numero,
      pos_x: posX,
      pos_y: posY,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
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

  const sillas = Array.from({ length: chairCount }, (_, index) => ({
    mesa_id: mesaCreada.id,
    numero: index + 1,
  }));

  const { error: chairsError } = await supabaseAdmin.from("sillas").insert(sillas);

  if (chairsError) {
    return NextResponse.json(
      { error: "La mesa se creo pero no se pudieron crear sus sillas." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    message: `Mesa creada correctamente con ${chairCount} sillas.`,
    mesaId: mesaCreada.id,
  });
}
