import { NextResponse } from "next/server";

import { getAdminSession } from "@/lib/admin-auth";
import {
  getActiveAdminUser,
  serializeAdminAccessRequest,
} from "@/lib/admin-users";
import { adminAccessRequestReviewSchema } from "@/lib/schemas";
import { supabaseAdmin } from "@/lib/supabase-admin";

async function requireActiveAdmin() {
  const session = getAdminSession();

  if (!session) {
    return null;
  }

  return getActiveAdminUser(session.id);
}

export async function GET() {
  const activeAdmin = await requireActiveAdmin();

  if (!activeAdmin) {
    return NextResponse.json(
      { error: "No tienes permisos para gestionar accesos admin." },
      { status: 401 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("admin_users")
    .select("id,email,name,password_hash,status,totp_secret,totp_enabled,created_at,approved_at,approved_by,last_login_at")
    .in("status", ["pending", "approved", "rejected"])
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "No se pudieron cargar las solicitudes admin." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    requests: (data ?? []).map(serializeAdminAccessRequest),
  });
}

export async function POST(request: Request) {
  const activeAdmin = await requireActiveAdmin();

  if (!activeAdmin) {
    return NextResponse.json(
      { error: "No tienes permisos para gestionar accesos admin." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsedBody = adminAccessRequestReviewSchema.safeParse(body);

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "La accion de revision no es valida.",
        details: parsedBody.error.flatten(),
      },
      { status: 400 },
    );
  }

  const nextStatus = parsedBody.data.action === "approve" ? "approved" : "rejected";
  const { data, error } = await supabaseAdmin
    .from("admin_users")
    .update({
      status: nextStatus,
      approved_at:
        parsedBody.data.action === "approve" ? new Date().toISOString() : null,
      approved_by: parsedBody.data.action === "approve" ? activeAdmin.id : null,
    })
    .eq("id", parsedBody.data.adminUserId)
    .neq("id", activeAdmin.id)
    .select("id,email,name,password_hash,status,totp_secret,totp_enabled,created_at,approved_at,approved_by,last_login_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "No se pudo actualizar la solicitud admin." },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json(
      { error: "No se encontro una solicitud admin revisable." },
      { status: 404 },
    );
  }

  return NextResponse.json({
    message:
      parsedBody.data.action === "approve"
        ? "Solicitud admin aprobada."
        : "Solicitud admin rechazada.",
    request: serializeAdminAccessRequest(data),
  });
}
