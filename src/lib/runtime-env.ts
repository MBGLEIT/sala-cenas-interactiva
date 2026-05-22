export function isRunningOnVercel() {
  return process.env.VERCEL === "1" || process.env.VERCEL === "true";
}

export const PLAN_IMPORT_SAFE_FILE_SIZE_BYTES = 4 * 1024 * 1024;

export const PLAN_IMPORT_FILE_SIZE_MESSAGE =
  "El archivo del plano es demasiado grande para procesarlo con seguridad en este despliegue. Usa una imagen de hasta 4 MB.";

export const PLAN_IMPORT_VERCEL_UNAVAILABLE_MESSAGE =
  "La importacion avanzada de planos no esta disponible en este despliegue de Vercel. Esta version del importador depende de OCR/Python y almacenamiento local de apoyo. Usa el entorno local para importar planos mientras preparamos una version compatible con cloud.";
