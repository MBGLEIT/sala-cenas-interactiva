"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import ToastStack, { ToastItem } from "@/components/toast-stack";
import {
  AsistenteEncontrado,
  EVENTO_SALA_SELECT,
  EventoQueryResult,
  EventoSala,
  RealtimeReservaPayload,
  applyOptimisticReservation,
  findSelectedChairDetails,
  findReservaActual,
  normalizeEventoSala,
} from "@/lib/dinner-room";
import { supabase } from "@/lib/supabase";

const DinnerRoomCanvas = dynamic(
  () => import("@/components/dinner-room-canvas"),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-[28px] border border-stone-200 bg-stone-50 px-6 py-10 text-stone-500">
        Preparando la sala...
      </div>
    ),
  },
);

async function fetchEventoSala(eventoId: string): Promise<EventoSala> {
  const { data, error } = await supabase
    .from("eventos")
    .select(EVENTO_SALA_SELECT)
    .eq("id", eventoId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "No se pudo cargar la sala del evento.");
  }

  if (!data) {
    throw new Error("No existe un evento con ese id.");
  }

  const evento = data as unknown as EventoQueryResult;
  return normalizeEventoSala(evento);
}

function LegendPill({
  colorClassName,
  title,
  description,
}: {
  colorClassName: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-4">
      <span className={`mt-1 h-4 w-4 rounded-full ${colorClassName}`} />
      <div>
        <p className="text-sm font-semibold text-stone-900">{title}</p>
        <p className="mt-1 text-sm leading-6 text-stone-600">{description}</p>
      </div>
    </div>
  );
}

export default function Home() {
  const [identificador, setIdentificador] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [roomLoading, setRoomLoading] = useState(false);
  const [reservationLoading, setReservationLoading] = useState(false);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [error, setError] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [asistente, setAsistente] = useState<AsistenteEncontrado | null>(null);
  const [evento, setEvento] = useState<EventoSala | null>(null);
  const [selectedSillaId, setSelectedSillaId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const selectedSillaIdRef = useRef<string | null>(null);
  const asistenteIdRef = useRef<string | null>(null);

  const reservaActual = useMemo(
    () => findReservaActual(evento, asistente?.id ?? null),
    [evento, asistente?.id],
  );
  const seleccionActual = useMemo(
    () => findSelectedChairDetails(evento, selectedSillaId),
    [evento, selectedSillaId],
  );

  function dismissToast(id: string) {
    setToasts((currentToasts) =>
      currentToasts.filter((toast) => toast.id !== id),
    );
  }

  function pushToast(toast: Omit<ToastItem, "id">) {
    const id = `${toast.tone}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    setToasts((currentToasts) => [
      ...currentToasts.slice(-2),
      {
        id,
        ...toast,
      },
    ]);
  }

  function resetFlow() {
    setError("");
    setInfoMessage("");
    setAsistente(null);
    setEvento(null);
    setSelectedSillaId(null);
    setRealtimeConnected(false);
  }

  useEffect(() => {
    selectedSillaIdRef.current = selectedSillaId;
  }, [selectedSillaId]);

  useEffect(() => {
    asistenteIdRef.current = asistente?.id ?? null;
  }, [asistente?.id]);

  useEffect(() => {
    if (toasts.length === 0) {
      return;
    }

    const timeoutIds = toasts.map((toast) =>
      window.setTimeout(() => {
        dismissToast(toast.id);
      }, 5200),
    );

    return () => {
      timeoutIds.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
    };
  }, [toasts]);

  async function cargarEvento(eventoId: string, options?: { silent?: boolean }) {
    if (!options?.silent) {
      setRoomLoading(true);
    }

    try {
      const eventoActualizado = await fetchEventoSala(eventoId);
      setEvento(eventoActualizado);
    } finally {
      if (!options?.silent) {
        setRoomLoading(false);
      }
    }
  }

  useEffect(() => {
    if (!evento?.id || !asistente?.id) {
      setRealtimeConnected(false);
      return;
    }

    const channel = supabase
      .channel(`reservas-evento-${evento.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "reservas",
        },
        async (payload) => {
          const realtimePayload = payload as unknown as RealtimeReservaPayload;
          const changedSillaId =
            realtimePayload.eventType === "DELETE"
              ? realtimePayload.old?.silla_id
              : realtimePayload.new?.silla_id;
          const changedAsistenteId =
            realtimePayload.eventType === "DELETE"
              ? realtimePayload.old?.asistente_id
              : realtimePayload.new?.asistente_id;

          if (
            changedSillaId &&
            selectedSillaIdRef.current === changedSillaId &&
            changedAsistenteId !== asistenteIdRef.current
          ) {
            setSelectedSillaId(null);
            setError("Esa silla ya no esta libre. Elige otra.");
            pushToast({
              tone: "error",
              title: "Silla ocupada",
              description: "Otra persona la ha reservado antes que tu.",
            });
          }

          try {
            const eventoActualizado = await fetchEventoSala(evento.id);
            setEvento(eventoActualizado);
          } catch {
            setError("No se pudo actualizar la sala en este momento.");
            pushToast({
              tone: "error",
              title: "Sala no actualizada",
              description:
                "La sala no ha podido refrescarse automaticamente ahora mismo.",
            });
          }
        },
      )
      .subscribe((status) => {
        setRealtimeConnected(status === "SUBSCRIBED");
      });

    return () => {
      setRealtimeConnected(false);
      void supabase.removeChannel(channel);
    };
  }, [evento?.id, asistente?.id]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const identificadorLimpio = identificador.trim().toUpperCase();

    if (!identificadorLimpio) {
      resetFlow();
      setError("Escribe tu identificador para continuar.");
      pushToast({
        tone: "error",
        title: "Falta el identificador",
        description: "Escribe el codigo del asistente para continuar.",
      });
      return;
    }

    setLookupLoading(true);
    setError("");
    setInfoMessage("");
    setAsistente(null);
    setEvento(null);
    setSelectedSillaId(null);

    try {
      const response = await fetch(
        `/api/asistentes?identificador=${encodeURIComponent(
          identificadorLimpio,
        )}&ts=${Date.now()}`,
        {
          cache: "no-store",
        },
      );

      const result = (await response.json()) as {
        error?: string;
        asistente?: AsistenteEncontrado;
      };

      if (!response.ok || !result.asistente) {
        setError(result.error ?? "No se ha podido comprobar el identificador.");
        pushToast({
          tone: "error",
          title: "Asistente no encontrado",
          description:
            result.error ?? "Revisa el identificador y vuelve a intentarlo.",
        });
        return;
      }

      setAsistente(result.asistente);
      await cargarEvento(result.asistente.evento_id);
      setInfoMessage("Asistente identificado correctamente.");
      pushToast({
        tone: "success",
        title: "Acceso correcto",
        description: `${result.asistente.nombre} puede acceder a la sala.`,
      });
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : "Ha ocurrido un problema de conexion.";

      setError(message);
      pushToast({
        tone: "error",
        title: "No se pudo continuar",
        description: message,
      });
    } finally {
      setLookupLoading(false);
    }
  }

  async function handleConfirmReservation() {
    if (!asistente || !selectedSillaId || !evento) {
      return;
    }

    const previousEvento = evento;
    const previousSelectedSillaId = selectedSillaId;

    setReservationLoading(true);
    setError("");
    setInfoMessage("Guardando reserva...");
    setEvento(
      applyOptimisticReservation(previousEvento, selectedSillaId, asistente.id),
    );
    setSelectedSillaId(null);

    try {
      const response = await fetch("/api/reservas", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sillaId: selectedSillaId,
          asistenteId: asistente.id,
        }),
      });

      const result = (await response.json()) as {
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        setEvento(previousEvento);
        setSelectedSillaId(previousSelectedSillaId);
        const message =
          result.error ?? "No se ha podido confirmar la reserva.";

        setError(message);
        pushToast({
          tone: "error",
          title: "Reserva no confirmada",
          description: message,
        });
        await cargarEvento(asistente.evento_id, { silent: true });
        return;
      }

      await cargarEvento(asistente.evento_id, { silent: true });
      const message = result.message ?? "Reserva creada correctamente.";

      setInfoMessage(message);
      pushToast({
        tone: "success",
        title: "Reserva confirmada",
        description: message,
      });
    } catch {
      setEvento(previousEvento);
      setSelectedSillaId(previousSelectedSillaId);
      setError("Ha ocurrido un problema de conexion al guardar.");
      pushToast({
        tone: "error",
        title: "Fallo al guardar",
        description: "No se ha podido confirmar la reserva en este momento.",
      });
    } finally {
      setReservationLoading(false);
    }
  }

  const showRoomScreen = Boolean(asistente && evento);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#fff7ed,_#f5f5f4_55%,_#e7e5e4)] px-6 py-12 text-stone-900">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {!showRoomScreen ? (
        <div className="mx-auto max-w-2xl rounded-[36px] border border-stone-200 bg-white px-8 py-10 shadow-[0_20px_70px_rgba(28,25,23,0.12)] sm:px-10">
          <p className="text-sm font-semibold uppercase tracking-[0.35em] text-amber-700">
            Sala de Cenas Interactiva
          </p>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight text-stone-950">
            Identifica al asistente
          </h1>
          <p className="mt-5 text-lg leading-8 text-stone-600">
            Introduce el codigo del asistente para entrar en la sala del evento.
          </p>

          <form className="mt-10 space-y-4" onSubmit={handleSubmit}>
            <label
              htmlFor="identificador"
              className="block text-sm font-semibold uppercase tracking-[0.2em] text-stone-500"
            >
              Identificador del asistente
            </label>
            <input
              id="identificador"
              name="identificador"
              type="text"
              value={identificador}
              onChange={(event) => setIdentificador(event.target.value)}
              placeholder="Pon aqui tu codigo de asistente"
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-5 py-4 text-lg font-medium uppercase tracking-[0.15em] text-stone-900 outline-none transition focus:border-amber-500 focus:bg-white"
            />
            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={lookupLoading || roomLoading}
                className="inline-flex min-w-[220px] items-center justify-center rounded-full bg-stone-950 px-6 py-4 text-sm font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-stone-400"
              >
                {lookupLoading ? "Entrando..." : "Entrar en la sala"}
              </button>
              <Link
                href="/admin"
                className="inline-flex min-w-[220px] items-center justify-center rounded-full border border-stone-300 bg-white px-6 py-4 text-sm font-semibold uppercase tracking-[0.2em] text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
              >
                ¿Eres Administrador?
              </Link>
            </div>
          </form>

          {lookupLoading || roomLoading ? (
            <div className="mt-8 rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-800">
              Estamos preparando el acceso a la sala.
            </div>
          ) : null}

          {error ? (
            <div className="mt-8 rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-rose-700">
              <p className="text-sm font-semibold uppercase tracking-[0.2em]">
                Error
              </p>
              <p className="mt-2 text-base leading-7">{error}</p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mx-auto max-w-7xl space-y-6">
          <section className="rounded-[36px] border border-stone-200 bg-white px-8 py-8 shadow-[0_20px_70px_rgba(28,25,23,0.12)] sm:px-10">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.35em] text-amber-700">
                Asistente identificado
              </p>
              <h1 className="mt-4 text-4xl font-semibold tracking-tight text-stone-950">
                {asistente?.nombre}
              </h1>
              <p className="mt-3 text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
                {asistente?.identificador}
              </p>
            </div>
          </section>

          <section className="rounded-[36px] border border-stone-200 bg-white px-8 py-8 shadow-[0_20px_70px_rgba(28,25,23,0.12)] sm:px-10">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-amber-700">
                Sala visual
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-stone-950">
                {evento?.nombre ?? "Evento"}
              </h2>
            </div>
          </section>

          <section className="rounded-[36px] border border-stone-200 bg-white px-8 py-8 shadow-[0_20px_70px_rgba(28,25,23,0.12)] sm:px-10">
            <div className="mt-2">
              {!evento ? (
                <div className="rounded-[28px] border border-dashed border-stone-300 bg-stone-50 px-6 py-10 text-stone-500">
                  No se ha podido cargar la sala del evento.
                </div>
              ) : (
                <DinnerRoomCanvas
                  evento={evento}
                  selectedSillaId={selectedSillaId}
                  currentAsistenteId={asistente?.id ?? ""}
                  selectionLocked={Boolean(reservaActual) || reservationLoading}
                  onSelectSilla={setSelectedSillaId}
                />
              )}
            </div>

            <div className="mt-6 rounded-3xl bg-stone-100 px-6 py-5">
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={resetFlow}
                  className="inline-flex items-center justify-center rounded-full border border-stone-300 bg-white px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
                >
                  Cambiar asistente
                </button>
                <button
                  type="button"
                  onClick={handleConfirmReservation}
                  disabled={
                    !selectedSillaId ||
                    !asistente ||
                    reservationLoading ||
                    Boolean(reservaActual)
                  }
                  className="inline-flex items-center justify-center rounded-full bg-emerald-600 px-6 py-4 text-sm font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-stone-300"
                >
                  {reservationLoading
                    ? "Guardando..."
                    : reservaActual
                      ? "Reserva ya asignada"
                      : seleccionActual
                        ? `Confirmar Mesa ${seleccionActual.mesaNumero}, Silla ${seleccionActual.sillaNumero}`
                        : "Confirmar reserva"}
                </button>
              </div>

              {infoMessage ? (
                <div className="mt-5 rounded-3xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-emerald-700">
                  <p className="text-sm font-semibold uppercase tracking-[0.2em]">
                    Estado
                  </p>
                  <p className="mt-2 text-base leading-7">{infoMessage}</p>
                </div>
              ) : null}

              {error ? (
                <div className="mt-5 rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-rose-700">
                  <p className="text-sm font-semibold uppercase tracking-[0.2em]">
                    Error
                  </p>
                  <p className="mt-2 text-base leading-7">{error}</p>
                </div>
              ) : null}

              {selectedSillaId && !reservaActual ? (
                <div className="mt-5 rounded-3xl border border-amber-200 bg-white px-4 py-4">
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-700">
                    Seleccion actual
                  </p>
                  <p className="mt-2 text-base leading-7 text-stone-700">
                    {seleccionActual
                      ? `Has elegido la Mesa ${seleccionActual.mesaNumero}, Silla ${seleccionActual.sillaNumero}.`
                      : "Has elegido una silla para confirmar."}
                  </p>
                </div>
              ) : null}

              {!selectedSillaId && evento && !reservaActual ? (
                <div className="mt-5 rounded-3xl border border-stone-200 bg-white px-4 py-4">
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
                    Elige una silla
                  </p>
                  <p className="mt-2 text-base leading-7 text-stone-600">
                    Pulsa sobre una silla libre para seleccionarla.
                  </p>
                </div>
              ) : null}

              {reservaActual ? (
                <div className="mt-5 rounded-3xl border border-sky-200 bg-white px-4 py-4">
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
                    Reserva existente
                  </p>
                  <p className="mt-2 text-base leading-7 text-stone-600">
                    Este asistente ya tiene asignada la Mesa {reservaActual.mesaNumero},
                    Silla {reservaActual.sillaNumero}.
                  </p>
                </div>
              ) : null}

              <div className="mt-5 grid gap-3 lg:grid-cols-2 2xl:grid-cols-4">
                <LegendPill
                  colorClassName="bg-emerald-500"
                  title="Silla libre"
                  description="Puedes elegirla para este asistente."
                />
                <LegendPill
                  colorClassName="bg-rose-500"
                  title="Silla ocupada"
                  description="Ya pertenece a otra persona."
                />
                <LegendPill
                  colorClassName="bg-yellow-400"
                  title="Silla seleccionada"
                  description="Es la que se va a confirmar."
                />
                <LegendPill
                  colorClassName="bg-sky-500"
                  title="Tu reserva"
                  description="Es la silla ya asignada a este asistente."
                />
              </div>

              <div className="mt-5 rounded-2xl border border-stone-200 bg-white px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-stone-800">Tiempo real</p>
                  <span
                    className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${
                      realtimeConnected
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-stone-200 text-stone-600"
                    }`}
                  >
                    {realtimeConnected ? "Activo" : "En espera"}
                  </span>
                </div>
                <p className="mt-1 text-sm leading-6 text-stone-500">
                  {realtimeConnected
                    ? "La sala se actualiza automaticamente cuando cambia una reserva."
                    : "La actualizacion automatica no esta activa en este momento."}
                </p>
              </div>

              {reservationLoading ? (
                <div className="mt-5 rounded-3xl border border-amber-200 bg-white px-4 py-4">
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-700">
                    Guardando
                  </p>
                  <p className="mt-2 text-base leading-7 text-stone-600">
                    Estamos confirmando la reserva.
                  </p>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
