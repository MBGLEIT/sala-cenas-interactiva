import { z } from "zod";

const uuidLikeSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Debe tener formato UUID valido",
  );

export const eventoIdSchema = z.object({
  id: uuidLikeSchema,
});

export const crearReservaSchema = z.object({
  sillaId: uuidLikeSchema,
  asistenteId: uuidLikeSchema,
});

export const buscarAsistenteSchema = z.object({
  identificador: z
    .string()
    .trim()
    .min(3, "El identificador debe tener al menos 3 caracteres"),
});

export type CrearReservaInput = z.infer<typeof crearReservaSchema>;
