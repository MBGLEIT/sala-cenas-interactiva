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
  esCeliaco: z.boolean().optional().default(false),
  tieneAlergias: z.boolean().optional().default(false),
  movilidadReducida: z.boolean().optional().default(false),
  observaciones: z
    .string()
    .trim()
    .max(300, "Las observaciones no pueden superar 300 caracteres")
    .optional()
    .default(""),
});

export const buscarAsistenteSchema = z.object({
  identificador: z
    .string()
    .trim()
    .min(3, "El identificador debe tener al menos 3 caracteres"),
});

export const adminLoginSchema = z.object({
  password: z
    .string()
    .trim()
    .min(4, "La contrasena admin debe tener al menos 4 caracteres"),
});

export const adminUpsertReservaSchema = z.object({
  eventoId: uuidLikeSchema,
  sillaId: uuidLikeSchema,
  asistenteId: uuidLikeSchema,
});

export const adminDeleteReservaSchema = z.object({
  reservaId: uuidLikeSchema,
});

export const adminCreateEventoSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(3, "El nombre del evento debe tener al menos 3 caracteres"),
  fecha: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe ir en formato YYYY-MM-DD"),
});

export const adminUpdateEventoSchema = adminCreateEventoSchema.extend({
  eventoId: uuidLikeSchema,
});

export const adminDeleteEventoSchema = z.object({
  eventoId: uuidLikeSchema,
});

export const adminCreateMesaSchema = z.object({
  eventoId: uuidLikeSchema,
  numero: z.coerce
    .number()
    .int("El numero de mesa debe ser entero")
    .positive("El numero de mesa debe ser mayor que 0"),
  quantity: z.coerce
    .number()
    .int("La cantidad de mesas debe ser entera")
    .min(1, "Debes crear al menos una mesa")
    .max(50, "No se pueden crear mas de 50 mesas a la vez")
    .optional()
    .default(1),
  chairCount: z.coerce
    .number()
    .int("El numero de sillas debe ser entero")
    .min(1, "La mesa debe tener al menos 1 silla")
    .max(40, "La mesa no puede superar 40 sillas"),
  posX: z.coerce.number(),
  posY: z.coerce.number(),
});

export const adminUpdateMesaSchema = z.object({
  mesaId: uuidLikeSchema,
  eventoId: uuidLikeSchema,
  numero: z.coerce
    .number()
    .int("El numero de mesa debe ser entero")
    .positive("El numero de mesa debe ser mayor que 0"),
  posX: z.coerce.number(),
  posY: z.coerce.number(),
});

export const adminDeleteMesaSchema = z.object({
  mesaId: uuidLikeSchema,
});

export const adminCreateSillaSchema = z.object({
  mesaId: uuidLikeSchema,
  numero: z.coerce
    .number()
    .int("El numero de silla debe ser entero")
    .positive("El numero de silla debe ser mayor que 0"),
});

export const adminUpdateSillaSchema = adminCreateSillaSchema.extend({
  sillaId: uuidLikeSchema,
});

export const adminDeleteSillaSchema = z.object({
  sillaId: uuidLikeSchema,
});

export const adminCreateAsistenteSchema = z.object({
  eventoId: uuidLikeSchema,
  nombre: z
    .string()
    .trim()
    .min(3, "El nombre del asistente debe tener al menos 3 caracteres"),
  identificador: z
    .string()
    .trim()
    .min(3, "El identificador debe tener al menos 3 caracteres"),
});

export const adminUpdateAsistenteSchema = z.object({
  asistenteId: uuidLikeSchema,
  nombre: z
    .string()
    .trim()
    .min(3, "El nombre del asistente debe tener al menos 3 caracteres"),
  identificador: z
    .string()
    .trim()
    .min(3, "El identificador debe tener al menos 3 caracteres"),
});

export const adminDeleteAsistenteSchema = z.object({
  asistenteId: uuidLikeSchema,
});

export const adminImportPlanSchema = z.object({
  eventoId: uuidLikeSchema,
});

export type CrearReservaInput = z.infer<typeof crearReservaSchema>;
