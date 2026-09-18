import { NextResponse } from "next/server";
import { toDataURL } from "qrcode";

import { createAdminChallengeToken } from "@/lib/admin-auth";
import { verifyAdminPasswordHash } from "@/lib/admin-password";
import { createTotpSecret, createTotpUri } from "@/lib/admin-totp";
import { findAdminUserByEmail } from "@/lib/admin-users";
import { adminLoginSchema } from "@/lib/schemas";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsedBody = adminLoginSchema.safeParse(body);

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Los datos de acceso no son validos.",
        details: parsedBody.error.flatten(),
      },
      { status: 400 },
    );
  }

  const adminUser = await findAdminUserByEmail(parsedBody.data.email);

  if (
    !adminUser ||
    !(await verifyAdminPasswordHash(parsedBody.data.password, adminUser.password_hash))
  ) {
    return NextResponse.json(
      { error: "El correo o la contraseña no son correctos." },
      { status: 401 },
    );
  }

  if (adminUser.status === "pending") {
    return NextResponse.json(
      {
        status: "pending",
        error: "Tu solicitud de acceso admin todavia esta pendiente de aprobacion.",
      },
      { status: 403 },
    );
  }

  if (adminUser.status === "rejected") {
    return NextResponse.json(
      {
        status: "rejected",
        error: "Esta solicitud de acceso admin ha sido rechazada.",
      },
      { status: 403 },
    );
  }

  if (adminUser.status === "disabled") {
    return NextResponse.json(
      {
        status: "disabled",
        error: "Esta cuenta admin esta desactivada.",
      },
      { status: 403 },
    );
  }

  if (adminUser.status === "approved" || !adminUser.totp_enabled) {
    const secret = adminUser.totp_secret ?? createTotpSecret();

    if (!adminUser.totp_secret) {
      const { error } = await supabaseAdmin
        .from("admin_users")
        .update({ totp_secret: secret })
        .eq("id", adminUser.id);

      if (error) {
        return NextResponse.json(
          { error: "No se pudo preparar la configuracion 2FA." },
          { status: 500 },
        );
      }
    }

    const totpUri = createTotpUri({
      email: adminUser.email,
      secret,
    });

    return NextResponse.json({
      requiresTotpSetup: true,
      setupToken: createAdminChallengeToken({
        adminId: adminUser.id,
        email: adminUser.email,
        purpose: "totp-setup",
      }),
      totpSecret: secret,
      totpUri,
      totpQrDataUrl: await toDataURL(totpUri),
      message: "Configura el 2FA para activar tu cuenta admin.",
    });
  }

  return NextResponse.json({
    requiresTotp: true,
    challengeToken: createAdminChallengeToken({
      adminId: adminUser.id,
      email: adminUser.email,
      purpose: "totp-verify",
    }),
    message: "Introduce el codigo de tu app authenticator.",
  });
}
