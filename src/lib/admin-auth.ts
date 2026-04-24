import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

const ADMIN_SESSION_COOKIE = "admin-session";
const ADMIN_SESSION_VALUE = "authenticated";

function getAdminPassword() {
  const adminPassword = process.env.ADMIN_ACCESS_PASSWORD;

  if (!adminPassword) {
    throw new Error("Falta ADMIN_ACCESS_PASSWORD en las variables de entorno.");
  }

  return adminPassword;
}

function signAdminSession(value: string) {
  return createHmac("sha256", getAdminPassword()).update(value).digest("hex");
}

function verifyAdminSession(token: string | undefined) {
  if (!token) {
    return false;
  }

  const [value, signature] = token.split(".");

  if (!value || !signature) {
    return false;
  }

  const expectedSignature = signAdminSession(value);
  const expectedBuffer = Buffer.from(expectedSignature);
  const providedBuffer = Buffer.from(signature);

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return value === ADMIN_SESSION_VALUE && timingSafeEqual(expectedBuffer, providedBuffer);
}

export function verifyAdminPassword(candidate: string) {
  const expected = Buffer.from(getAdminPassword());
  const provided = Buffer.from(candidate);

  if (expected.length !== provided.length) {
    return false;
  }

  return timingSafeEqual(expected, provided);
}

export function createAdminSessionToken() {
  return `${ADMIN_SESSION_VALUE}.${signAdminSession(ADMIN_SESSION_VALUE)}`;
}

export function isAdminAuthenticated() {
  const cookieStore = cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;

  return verifyAdminSession(token);
}

export function setAdminSessionCookie() {
  const cookieStore = cookies();

  cookieStore.set(ADMIN_SESSION_COOKIE, createAdminSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 8,
    path: "/",
  });
}

export function clearAdminSessionCookie() {
  const cookieStore = cookies();
  cookieStore.delete(ADMIN_SESSION_COOKIE);
}
