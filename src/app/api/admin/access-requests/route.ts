import { NextResponse } from "next/server";

import { logAdminAction, serializeAdminAuditLog } from "@/lib/admin-audit";
import { getAdminSession } from "@/lib/admin-auth";
import {
  getActiveAdminUser,
  serializeAdminAccessRequest,
  serializeAdminUser,
} from "@/lib/admin-users";
import { adminAccessRequestReviewSchema } from "@/lib/schemas";
import { supabaseAdmin } from "@/lib/supabase-admin";

const ADMIN_USER_COLUMNS =
  "id,email,name,password_hash,status,totp_secret,totp_enabled,created_at,approved_at,approved_by,last_login_at";

async function requireActiveAdmin() {
  const session = getAdminSession();

  if (!session) {
    return null;
  }

  return getActiveAdminUser(session.id);
}

function getActionMessage(action: string) {
  if (action === "approve") {
    return "Solicitud admin aprobada.";
  }

  if (action === "reject") {
    return "Solicitud admin rechazada.";
  }

  if (action === "revoke") {
    return "Acceso admin revocado.";
  }

  return "Acceso admin restituido.";
}

export async function GET() {
  const activeAdmin = await requireActiveAdmin();

  if (!activeAdmin) {
    return NextResponse.json(
      { error: "No tienes permisos para gestionar accesos admin." },
      { status: 401 },
    );
  }

  const [usersResult, logsResult] = await Promise.all([
    supabaseAdmin
      .from("admin_users")
      .select(ADMIN_USER_COLUMNS)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("admin_audit_logs")
      .select("id,admin_user_id,action,target_type,target_id,details,created_at")
      .order("created_at", { ascending: false })
      .limit(250),
  ]);

  if (usersResult.error) {
    return NextResponse.json(
      { error: "No se pudieron cargar los usuarios admin." },
      { status: 500 },
    );
  }

  if (logsResult.error) {
    return NextResponse.json(
      { error: "No se pudo cargar el historial admin." },
      { status: 500 },
    );
  }

  const users = usersResult.data ?? [];

  return NextResponse.json({
    requests: users
      .filter((user) => ["pending", "approved", "rejected"].includes(user.status))
      .map(serializeAdminAccessRequest),
    users: users.map(serializeAdminUser),
    logs: (logsResult.data ?? []).map((log) => ({
      ...serializeAdminAuditLog(log),
      adminUserId: log.admin_user_id,
    })),
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
        error: "La acción de revisión no es válida.",
        details: parsedBody.error.flatten(),
      },
      { status: 400 },
    );
  }

  const { adminUserId, action } = parsedBody.data;

  if (adminUserId === activeAdmin.id && action === "revoke") {
    return NextResponse.json(
      { error: "No puedes revocar tu propio acceso mientras estás dentro." },
      { status: 409 },
    );
  }

  const { data: currentAdminUser, error: currentAdminUserError } = await supabaseAdmin
    .from("admin_users")
    .select(ADMIN_USER_COLUMNS)
    .eq("id", adminUserId)
    .maybeSingle();

  if (currentAdminUserError) {
    return NextResponse.json(
      { error: "No se pudo comprobar el usuario admin." },
      { status: 500 },
    );
  }

  if (!currentAdminUser) {
    return NextResponse.json(
      { error: "No se encontró el usuario admin." },
      { status: 404 },
    );
  }

  const nextStatusByAction = {
    approve: "approved",
    reject: "rejected",
    revoke: "disabled",
    restore: currentAdminUser.totp_enabled ? "active" : "approved",
  } as const;
  const nextStatus = nextStatusByAction[action];
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("admin_users")
    .update({
      status: nextStatus,
      approved_at: action === "approve" || action === "restore" ? now : null,
      approved_by:
        action === "approve" || action === "restore" ? activeAdmin.id : null,
    })
    .eq("id", adminUserId)
    .select(ADMIN_USER_COLUMNS)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "No se pudo actualizar el usuario admin." },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json(
      { error: "No se encontró el usuario admin." },
      { status: 404 },
    );
  }

  await logAdminAction({
    action: `admin_user.${action}`,
    targetType: "admin_user",
    targetId: data.id,
    details: {
      email: data.email,
      name: data.name,
      nextStatus,
    },
  });

  return NextResponse.json({
    message: getActionMessage(action),
    request: serializeAdminAccessRequest(data),
    user: serializeAdminUser(data),
  });
}
