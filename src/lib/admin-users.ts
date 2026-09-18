import "server-only";

import { supabaseAdmin } from "@/lib/supabase-admin";

export type AdminUserStatus = "pending" | "approved" | "active" | "rejected" | "disabled";

export type AdminUserRecord = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  status: AdminUserStatus;
  totp_secret: string | null;
  totp_enabled: boolean;
  created_at: string;
  approved_at: string | null;
  approved_by: string | null;
  last_login_at: string | null;
};

const ADMIN_USER_COLUMNS =
  "id,email,name,password_hash,status,totp_secret,totp_enabled,created_at,approved_at,approved_by,last_login_at";

export async function findAdminUserByEmail(email: string) {
  const { data, error } = await supabaseAdmin
    .from("admin_users")
    .select(ADMIN_USER_COLUMNS)
    .eq("email", email)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as AdminUserRecord | null;
}

export async function findAdminUserById(id: string) {
  const { data, error } = await supabaseAdmin
    .from("admin_users")
    .select(ADMIN_USER_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as AdminUserRecord | null;
}

export async function getActiveAdminUser(id: string) {
  const user = await findAdminUserById(id);

  if (!user || user.status !== "active" || !user.totp_enabled) {
    return null;
  }

  return user;
}

export function serializeAdminAccessRequest(user: AdminUserRecord) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
    createdAt: user.created_at,
    approvedAt: user.approved_at,
    lastLoginAt: user.last_login_at,
  };
}
