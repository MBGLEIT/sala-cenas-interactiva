export type MaybeArray<T> = T | T[] | null;

export type AsistenteEncontrado = {
  id: string;
  nombre: string;
  identificador: string;
  evento_id: string;
};

export type Reserva = {
  id: string;
  asistente_id: string;
  created_at: string;
};

export type Silla = {
  id: string;
  numero: number;
  created_at: string;
  reservas: MaybeArray<Reserva>;
};

export type Mesa = {
  id: string;
  numero: number;
  pos_x: number;
  pos_y: number;
  created_at: string;
  sillas: Silla[];
};

export type EventoSala = {
  id: string;
  nombre: string;
  fecha: string;
  mesas: Mesa[];
};

export type ReservaActual = {
  mesaNumero: number;
  sillaNumero: number;
};

export type SeleccionActual = {
  mesaNumero: number;
  sillaNumero: number;
};

export type RealtimeReservaPayload = {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new?: {
    silla_id?: string;
    asistente_id?: string;
  };
  old?: {
    silla_id?: string;
    asistente_id?: string;
  };
};

export type EventoQueryResult = {
  id: string;
  nombre: string;
  fecha: string;
  created_at: string;
  mesas:
    | {
        id: string;
        numero: number;
        pos_x: number;
        pos_y: number;
        created_at: string;
        sillas:
          | {
              id: string;
              numero: number;
              created_at: string;
              reservas: MaybeArray<Reserva>;
            }[]
          | null;
      }[]
    | null;
};

export const EVENTO_SALA_SELECT = `
  id,
  nombre,
  fecha,
  created_at,
  mesas (
    id,
    numero,
    pos_x,
    pos_y,
    created_at,
    sillas (
      id,
      numero,
      created_at,
      reservas (
        id,
        asistente_id,
        created_at
      )
    )
  )
`;

export function normalizeReservas(reservas: MaybeArray<Reserva>): Reserva[] {
  if (!reservas) {
    return [];
  }

  return Array.isArray(reservas) ? reservas : [reservas];
}

export function normalizeEventoSala(evento: EventoQueryResult): EventoSala {
  return {
    id: evento.id,
    nombre: evento.nombre,
    fecha: evento.fecha,
    mesas: (evento.mesas ?? [])
      .map((mesa) => ({
        ...mesa,
        sillas: (mesa.sillas ?? [])
          .map((silla) => ({
            ...silla,
            reservas: normalizeReservas(silla.reservas),
          }))
          .sort((a, b) => a.numero - b.numero),
      }))
      .sort((a, b) => a.numero - b.numero),
  };
}

export function applyOptimisticReservation(
  evento: EventoSala,
  sillaId: string,
  asistenteId: string,
): EventoSala {
  const optimisticReserva: Reserva = {
    id: `temp-${Date.now()}`,
    asistente_id: asistenteId,
    created_at: new Date().toISOString(),
  };

  return {
    ...evento,
    mesas: evento.mesas.map((mesa) => ({
      ...mesa,
      sillas: mesa.sillas.map((silla) => ({
        ...silla,
        reservas:
          silla.id === sillaId
            ? [optimisticReserva]
            : normalizeReservas(silla.reservas),
      })),
    })),
  };
}

export function findReservaActual(
  evento: EventoSala | null,
  asistenteId: string | null,
): ReservaActual | null {
  if (!evento || !asistenteId) {
    return null;
  }

  for (const mesa of evento.mesas) {
    for (const silla of mesa.sillas) {
      const reserva = normalizeReservas(silla.reservas).find(
        (item) => item.asistente_id === asistenteId,
      );

      if (reserva) {
        return {
          mesaNumero: mesa.numero,
          sillaNumero: silla.numero,
        };
      }
    }
  }

  return null;
}

export function findSelectedChairDetails(
  evento: EventoSala | null,
  sillaId: string | null,
): SeleccionActual | null {
  if (!evento || !sillaId) {
    return null;
  }

  for (const mesa of evento.mesas) {
    const silla = mesa.sillas.find((item) => item.id === sillaId);

    if (silla) {
      return {
        mesaNumero: mesa.numero,
        sillaNumero: silla.numero,
      };
    }
  }

  return null;
}
