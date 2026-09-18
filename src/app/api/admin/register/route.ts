import { NextResponse } from "next/server";

import { hashAdminPassword } from "@/lib/admin-password";
import { adminRegisterSchema } from "@/lib/schemas";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsedBody = adminRegisterSchema.safeParse(body);

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Los datos del registro no son validos.",
        details: parsedBody.error.flatten(),
      },
      { status: 400 },
    );
  }

  const passwordHash = await hashAdminPassword(parsedBody.data.password);
  const { error } = await supabaseAdmin.from("admin_users").insert({
    email: parsedBody.data.email,
    name: parsedBody.data.name,
    password_hash: passwordHash,
    status: "pending",
  });

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Ya existe una solicitud o cuenta admin con ese correo." },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: "No se pudo crear la solicitud de acceso admin." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    message: "Solicitud enviada. Un administrador debe aprobarla desde el panel.",
  });
}
