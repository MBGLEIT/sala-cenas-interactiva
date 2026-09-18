import "server-only";

import { getAdminSession } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

type AdminAuditInput = {
  action: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
};

export async function logAdminAction({
  action,
  targetType,
  targetId,
  details = {},
}: AdminAuditInput) {
  const session = getAdminSession();

  if (!session) {
    return;
  }

  const { error } = await supabaseAdmin.from("admin_audit_logs").insert({
    admin_user_id: session.id,
    action,
    target_type: targetType ?? null,
    target_id: targetId ?? null,
    details,
  });

  if (error) {
    console.error("No se pudo guardar el historial admin", error);
  }
}

export function serializeAdminAuditLog(log: {
  id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}) {
  return {
    id: log.id,
    action: log.action,
    targetType: log.target_type,
    targetId: log.target_id,
    details: log.details ?? {},
    createdAt: log.created_at,
  };
}
