import { NextResponse } from "next/server";

import {
  setAdminSessionCookie,
  verifyAdminChallengeToken,
} from "@/lib/admin-auth";
import { findAdminUserById } from "@/lib/admin-users";
import { adminTotpSetupSchema } from "@/lib/schemas";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { verifyTotpCode } from "@/lib/admin-totp";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsedBody = adminTotpSetupSchema.safeParse(body);

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
    parsedBody.data.setupToken,
    "totp-setup",
  );

  if (!challenge) {
    return NextResponse.json(
      { error: "La sesion de configuracion 2FA ha caducado." },
      { status: 401 },
    );
  }

  const adminUser = await findAdminUserById(challenge.id);

  if (
    !adminUser ||
    (adminUser.status !== "approved" && adminUser.status !== "active") ||
    !adminUser.totp_secret
  ) {
    return NextResponse.json(
      { error: "Esta cuenta admin no puede configurar 2FA." },
      { status: 403 },
    );
  }

  if (!verifyTotpCode(adminUser.totp_secret, parsedBody.data.code)) {
    return NextResponse.json(
      { error: "El codigo 2FA no coincide. Revisa la app authenticator." },
      { status: 401 },
    );
  }

  const { error } = await supabaseAdmin
    .from("admin_users")
    .update({
      status: "active",
      totp_enabled: true,
      last_login_at: new Date().toISOString(),
    })
    .eq("id", adminUser.id);

  if (error) {
    return NextResponse.json(
      { error: "No se pudo activar el 2FA de la cuenta admin." },
      { status: 500 },
    );
  }

  setAdminSessionCookie({
    id: adminUser.id,
    email: adminUser.email,
  });

  return NextResponse.json({
    message: "2FA activado. Acceso admin concedido.",
  });
}
