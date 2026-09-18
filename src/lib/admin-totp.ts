import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;

function base32Encode(buffer: Buffer) {
  let bits = "";
  let output = "";

  for (const byte of buffer) {
    bits += byte.toString(2).padStart(8, "0");
  }

  for (let index = 0; index < bits.length; index += 5) {
    const chunk = bits.slice(index, index + 5).padEnd(5, "0");
    output += BASE32_ALPHABET[Number.parseInt(chunk, 2)];
  }

  return output;
}

function base32Decode(secret: string) {
  const normalizedSecret = secret.replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase();
  let bits = "";

  for (const char of normalizedSecret) {
    const value = BASE32_ALPHABET.indexOf(char);

    if (value === -1) {
      throw new Error("El secreto 2FA no tiene formato Base32 valido.");
    }

    bits += value.toString(2).padStart(5, "0");
  }

  const bytes: number[] = [];

  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }

  return Buffer.from(bytes);
}

function counterToBuffer(counter: number) {
  const buffer = Buffer.alloc(8);
  const high = Math.floor(counter / 0x100000000);
  const low = counter >>> 0;

  buffer.writeUInt32BE(high, 0);
  buffer.writeUInt32BE(low, 4);

  return buffer;
}

function generateTotpCode(secret: string, counter: number) {
  const hmac = createHmac("sha1", base32Decode(secret))
    .update(counterToBuffer(counter))
    .digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

export function createTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function createTotpUri({
  email,
  issuer = "Sala de Cenas",
  secret,
}: {
  email: string;
  issuer?: string;
  secret: string;
}) {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const encodedIssuer = encodeURIComponent(issuer);

  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

export function verifyTotpCode(secret: string, code: string) {
  const normalizedCode = code.replace(/\s+/g, "");

  if (!/^\d{6}$/.test(normalizedCode)) {
    return false;
  }

  const nowCounter = Math.floor(Date.now() / 1000 / STEP_SECONDS);
  const provided = Buffer.from(normalizedCode);

  for (let offset = -1; offset <= 1; offset += 1) {
    const expected = Buffer.from(generateTotpCode(secret, nowCounter + offset));

    if (expected.length === provided.length && timingSafeEqual(expected, provided)) {
      return true;
    }
  }

  return false;
}
