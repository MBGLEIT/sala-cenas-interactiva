import "server-only";

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = {
  N: 16384,
  r: 8,
  p: 1,
} as const;

function derivePasswordKey(password: string, salt: string) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(derivedKey);
    });
  });
}

export async function hashAdminPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const key = await derivePasswordKey(password, salt);

  return `scrypt:v1:${salt}:${key.toString("base64url")}`;
}

export async function verifyAdminPasswordHash(password: string, passwordHash: string) {
  const [algorithm, version, salt, storedKey] = passwordHash.split(":");

  if (algorithm !== "scrypt" || version !== "v1" || !salt || !storedKey) {
    return false;
  }

  const providedKey = await derivePasswordKey(password, salt);
  const storedKeyBuffer = Buffer.from(storedKey, "base64url");

  if (providedKey.length !== storedKeyBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedKey, storedKeyBuffer);
}
