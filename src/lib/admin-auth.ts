import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

const ADMIN_SESSION_COOKIE = "admin-session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;
const CHALLENGE_MAX_AGE_SECONDS = 60 * 10;

type AdminSessionPayload = {
  sub: string;
  email: string;
  exp: number;
  type: "admin-session";
};

type AdminChallengePayload = {
  sub: string;
  email: string;
  exp: number;
  nonce: string;
  purpose: "totp-setup" | "totp-verify";
};

export type AdminSession = {
  id: string;
  email: string;
};

function getAdminSessionSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET ?? process.env.ADMIN_ACCESS_PASSWORD;

  if (!secret) {
    throw new Error(
      "Falta ADMIN_SESSION_SECRET en las variables de entorno del panel admin.",
    );
  }

  return secret;
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(encodedPayload: string) {
  return createHmac("sha256", getAdminSessionSecret())
    .update(encodedPayload)
    .digest("base64url");
}

function signToken(payload: AdminSessionPayload | AdminChallengePayload) {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));

  return `${encodedPayload}.${signPayload(encodedPayload)}`;
}

function verifySignedToken<TPayload>(token: string | undefined): TPayload | null {
  if (!token) {
    return null;
  }

  const [encodedPayload, signature] = token.split(".");

  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signPayload(encodedPayload);
  const expectedBuffer = Buffer.from(expectedSignature);
  const providedBuffer = Buffer.from(signature);

  if (
    expectedBuffer.length !== providedBuffer.length ||
    !timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as TPayload & {
      exp?: number;
    };

    if (!payload.exp || payload.exp < Date.now()) {
      return null;
    }

    return payload as TPayload;
  } catch {
    return null;
  }
}

export function createAdminChallengeToken({
  adminId,
  email,
  purpose,
}: {
  adminId: string;
  email: string;
  purpose: AdminChallengePayload["purpose"];
}) {
  return signToken({
    sub: adminId,
    email,
    purpose,
    nonce: randomBytes(12).toString("base64url"),
    exp: Date.now() + CHALLENGE_MAX_AGE_SECONDS * 1000,
  });
}

export function verifyAdminChallengeToken(
  token: string,
  purpose: AdminChallengePayload["purpose"],
) {
  const payload = verifySignedToken<AdminChallengePayload>(token);

  if (!payload || payload.purpose !== purpose) {
    return null;
  }

  return {
    id: payload.sub,
    email: payload.email,
  } satisfies AdminSession;
}

export function createAdminSessionToken(admin: AdminSession) {
  return signToken({
    sub: admin.id,
    email: admin.email,
    type: "admin-session",
    exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  });
}

export function getAdminSession() {
  const cookieStore = cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  const payload = verifySignedToken<AdminSessionPayload>(token);

  if (!payload || payload.type !== "admin-session") {
    return null;
  }

  return {
    id: payload.sub,
    email: payload.email,
  } satisfies AdminSession;
}

export function isAdminAuthenticated() {
  return Boolean(getAdminSession());
}

export function setAdminSessionCookie(admin: AdminSession) {
  const cookieStore = cookies();

  cookieStore.set(ADMIN_SESSION_COOKIE, createAdminSessionToken(admin), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
}

export function clearAdminSessionCookie() {
  const cookieStore = cookies();
  cookieStore.delete(ADMIN_SESSION_COOKIE);
}
