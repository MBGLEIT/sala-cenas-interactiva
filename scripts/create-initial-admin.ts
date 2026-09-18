import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { randomBytes, scrypt } from "node:crypto";

type CliArgs = {
  email?: string;
  name?: string;
  password?: string;
};

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

async function hashAdminPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const key = await derivePasswordKey(password, salt);

  return `scrypt:v1:${salt}:${key.toString("base64url")}`;
}

function parseArgs(argv: string[]) {
  return argv.reduce<CliArgs>((args, current) => {
    const [key, ...valueParts] = current.replace(/^--/, "").split("=");
    const value = valueParts.join("=").trim();

    if (key === "email" || key === "name" || key === "password") {
      args[key] = value;
    }

    return args;
  }, {});
}

function printUsage() {
  console.log(
    [
      "Uso:",
      "npm run admin:create-initial -- --email=admin@ejemplo.com --name=\"Admin Principal\" --password=\"ContrasenaSegura123\"",
      "",
      "La cuenta se crea aprobada. En el primer acceso configurara 2FA y pasara a activa.",
    ].join("\n"),
  );
}

async function main() {
  loadEnvConfig(process.cwd());

  const args = parseArgs(process.argv.slice(2));

  if (!args.email || !args.name || !args.password) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (args.password.length < 8) {
    console.error("La contrasena debe tener al menos 8 caracteres.");
    process.exitCode = 1;
    return;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    console.error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY en .env.local.",
    );
    process.exitCode = 1;
    return;
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const passwordHash = await hashAdminPassword(args.password);
  const { data, error } = await supabaseAdmin
    .from("admin_users")
    .upsert(
      {
        email: args.email.trim().toLowerCase(),
        name: args.name.trim(),
        password_hash: passwordHash,
        status: "approved",
        totp_secret: null,
        totp_enabled: false,
        approved_at: new Date().toISOString(),
      },
      { onConflict: "email" },
    )
    .select("id,email,name,status")
    .single();

  if (error) {
    console.error("No se pudo crear el admin inicial:", error.message);
    process.exitCode = 1;
    return;
  }

  console.log("Admin inicial preparado:");
  console.log(`- ID: ${data.id}`);
  console.log(`- Email: ${data.email}`);
  console.log(`- Nombre: ${data.name}`);
  console.log(`- Estado: ${data.status}`);
  console.log("Siguiente paso: entra al panel y configura el 2FA.");
}

void main();
