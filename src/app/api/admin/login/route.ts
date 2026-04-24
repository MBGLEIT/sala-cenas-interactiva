import { NextResponse } from "next/server";

import {
  setAdminSessionCookie,
  verifyAdminPassword,
} from "@/lib/admin-auth";
import { adminLoginSchema } from "@/lib/schemas";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsedBody = adminLoginSchema.safeParse(body);

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "La contrasena del panel admin no es valida.",
        details: parsedBody.error.flatten(),
      },
      { status: 400 },
    );
  }

  if (!verifyAdminPassword(parsedBody.data.password)) {
    return NextResponse.json(
      { error: "La contrasena admin no es correcta." },
      { status: 401 },
    );
  }

  setAdminSessionCookie();

  return NextResponse.json({
    message: "Acceso admin concedido.",
  });
}
