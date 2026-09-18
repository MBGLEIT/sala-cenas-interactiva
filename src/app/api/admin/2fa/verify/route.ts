import { NextResponse } from "next/server";

import {
  setAdminSessionCookie,
  verifyAdminChallengeToken,
} from "@/lib/admin-auth";
import { findAdminUserById } from "@/lib/admin-users";
import { adminTotpVerifySchema } from "@/lib/schemas";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifyTotpCode } from "@/lib/admin-totp";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsedBody = adminTotpVerifySchema.safeParse(body);

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "El codigo 2FA no es valido.",
        details: parsedBody.error.flatten(),
      },
      { status: 400 },
    );
  }

  const challenge = verifyAdminChallengeToken(
    parsedBody.data.challengeToken,
    "totp-verify",
  );

  if (!challenge) {
    return NextResponse.json(
      { error: "La sesion 2FA ha caducado. Vuelve a iniciar sesion." },
      { status: 401 },
    );
  }

  const adminUser = await findAdminUserById(challenge.id);

  if (
    !adminUser ||
    adminUser.status !== "active" ||
    !adminUser.totp_enabled ||
    !adminUser.totp_secret
  ) {
    return NextResponse.json(
      { error: "Esta cuenta admin no esta activa." },
      { status: 403 },
    );
  }

  if (!verifyTotpCode(adminUser.totp_secret, parsedBody.data.code)) {
    return NextResponse.json(
      { error: "El codigo 2FA no coincide." },
      { status: 401 },
    );
  }

  const { error } = await supabaseAdmin
    .from("admin_users")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", adminUser.id);

  if (error) {
    return NextResponse.json(
      { error: "No se pudo actualizar el acceso admin." },
      { status: 500 },
    );
  }

  setAdminSessionCookie({
    id: adminUser.id,
    email: adminUser.email,
  });

  return NextResponse.json({
    message: "Acceso admin concedido.",
  });
}
