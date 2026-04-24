import { NextResponse } from "next/server";

import { clearAdminSessionCookie } from "@/lib/admin-auth";

export async function POST() {
  clearAdminSessionCookie();

  return NextResponse.json({
    message: "Sesion admin cerrada.",
  });
}
