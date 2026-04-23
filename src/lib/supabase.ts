import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl) {
  throw new Error("Falta NEXT_PUBLIC_SUPABASE_URL en el archivo .env.local");
}

if (!supabasePublishableKey) {
  throw new Error(
    "Falta NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY en el archivo .env.local",
  );
}

// Al exportarlo desde el modulo, reutilizamos la misma instancia en toda la app.
export const supabase = createClient(supabaseUrl, supabasePublishableKey);
