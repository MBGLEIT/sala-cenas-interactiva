import "server-only";

import {
  EVENTO_SALA_SELECT,
  EventoQueryResult,
  EventoSala,
  normalizeEventoSala,
  normalizeReservas,
} from "@/lib/dinner-room";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type AdminEventSummary = {
  id: string;
  nombre: string;
  fecha: string;
};

export type AdminAssistantRow = {
  id: string;
  nombre: string;
  identificador: string;
  reservaActual: {
    reservaId: string;
    sillaId: string;
    mesaNumero: number;
    sillaNumero: number;
  } | null;
};

export type AdminReservationRow = {
  id: string;
  sillaId: string;
  asistenteId: string;
  asistenteNombre: string;
  asistenteIdentificador: string;
  mesaNumero: number;
  sillaNumero: number;
  createdAt: string;
  esCeliaco: boolean;
  tieneAlergias: boolean;
  movilidadReducida: boolean;
  observaciones: string | null;
};

export type AdminChairOption = {
  sillaId: string;
  label: string;
};

export type AdminPanelData = {
  evento: EventoSala;
  asistentes: AdminAssistantRow[];
  reservas: AdminReservationRow[];
  sillasDisponibles: AdminChairOption[];
};

export async function fetchAdminEvents() {
  const { data, error } = await supabaseAdmin
    .from("eventos")
    .select("id, nombre, fecha")
    .order("fecha", { ascending: true });

  if (error) {
    throw new Error(
      `No se pudieron cargar los eventos del panel admin. Detalle: ${error.message}`,
    );
  }

  return (data ?? []) as AdminEventSummary[];
}

export async function fetchAdminPanelData(eventoId: string): Promise<AdminPanelData> {
  const [{ data: eventoData, error: eventoError }, { data: asistentesData, error: asistentesError }] =
    await Promise.all([
      supabaseAdmin
        .from("eventos")
        .select(EVENTO_SALA_SELECT)
        .eq("id", eventoId)
        .maybeSingle(),
      supabaseAdmin
        .from("asistentes")
        .select("id, nombre, identificador")
        .eq("evento_id", eventoId)
        .order("nombre", { ascending: true }),
    ]);

  if (eventoError || !eventoData) {
    throw new Error(
      `No se pudo cargar el evento del panel admin. Detalle: ${eventoError?.message ?? "Evento no encontrado."}`,
    );
  }

  if (asistentesError) {
    throw new Error(
      `No se pudieron cargar los asistentes del panel admin. Detalle: ${asistentesError.message}`,
    );
  }

  const evento = normalizeEventoSala(eventoData as EventoQueryResult);
  const asistentesBase = (asistentesData ?? []) as {
    id: string;
    nombre: string;
    identificador: string;
  }[];

  const reservas: AdminReservationRow[] = [];
  const reservaPorAsistente = new Map<string, AdminAssistantRow["reservaActual"]>();
  const sillasDisponibles: AdminChairOption[] = [];

  for (const mesa of evento.mesas) {
    for (const silla of mesa.sillas) {
      const reservasSilla = normalizeReservas(silla.reservas);
      const primeraReserva = reservasSilla[0];

      if (!primeraReserva) {
        sillasDisponibles.push({
          sillaId: silla.id,
          label: `Mesa ${mesa.numero}, Silla ${silla.numero}`,
        });
        continue;
      }

      reservaPorAsistente.set(primeraReserva.asistente_id, {
        reservaId: primeraReserva.id,
        sillaId: silla.id,
        mesaNumero: mesa.numero,
        sillaNumero: silla.numero,
      });
    }
  }

  const asistentes = asistentesBase.map((asistente) => ({
    ...asistente,
    reservaActual: reservaPorAsistente.get(asistente.id) ?? null,
  }));

  const asistentePorId = new Map(asistentes.map((asistente) => [asistente.id, asistente]));

  for (const mesa of evento.mesas) {
    for (const silla of mesa.sillas) {
      const reserva = normalizeReservas(silla.reservas)[0];

      if (!reserva) {
        continue;
      }

      const asistente = asistentePorId.get(reserva.asistente_id);

      reservas.push({
        id: reserva.id,
        sillaId: silla.id,
        asistenteId: reserva.asistente_id,
        asistenteNombre: asistente?.nombre ?? "Asistente no encontrado",
        asistenteIdentificador: asistente?.identificador ?? "Sin identificador",
        mesaNumero: mesa.numero,
        sillaNumero: silla.numero,
        createdAt: reserva.created_at,
        esCeliaco: Boolean(reserva.es_celiaco),
        tieneAlergias: Boolean(reserva.tiene_alergias),
        movilidadReducida: Boolean(reserva.movilidad_reducida),
        observaciones: reserva.observaciones ?? null,
      });
    }
  }

  reservas.sort((a, b) => {
    if (a.mesaNumero !== b.mesaNumero) {
      return a.mesaNumero - b.mesaNumero;
    }

    return a.sillaNumero - b.sillaNumero;
  });

  return {
    evento,
    asistentes,
    reservas,
    sillasDisponibles,
  };
}
