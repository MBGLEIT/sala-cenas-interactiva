"use client";

import dynamic from "next/dynamic";
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
        Preparando la sala interactiva...
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
    setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== id));
  }

  function pushToast(toast: Omit<ToastItem, "id">) {
    const id = `${toast.tone}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    setToasts((currentToasts) => [
      ...currentToasts.slice(-2),
      {
        id,
        ...toast,
      },
    ]);
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
            setError(
              "La silla que habias seleccionado acaba de ocuparse. Elige otra.",
            );
            pushToast({
              tone: "error",
              title: "La silla ya no estaba libre",
              description:
                "Otra persona la ha ocupado antes. Elige otra silla verde.",
            });
          }

          try {
            const eventoActualizado = await fetchEventoSala(evento.id);
            setEvento(eventoActualizado);
          } catch {
            setError(
              "La sala no se ha podido actualizar en tiempo real. Puedes recargarla manualmente.",
            );
            pushToast({
              tone: "error",
              title: "No se pudo refrescar la sala",
              description:
                "La reserva existe, pero la interfaz no ha podido traer el estado nuevo.",
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
      setAsistente(null);
      setEvento(null);
      setSelectedSillaId(null);
      setInfoMessage("");
      setError("Escribe tu identificador para poder continuar.");
      pushToast({
        tone: "error",
        title: "Falta el identificador",
        description: "Escribe el codigo del asistente para poder entrar.",
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
        `/api/asistentes?identificador=${encodeURIComponent(identificadorLimpio)}&ts=${Date.now()}`,
        {
          cache: "no-store",
        },
      );

      const result = (await response.json()) as {
        error?: string;
        asistente?: AsistenteEncontrado;
      };

      if (!response.ok || !result.asistente) {
        setError(
          result.error ??
            "No hemos podido comprobar tu identificador. Intentalo otra vez.",
        );
        pushToast({
          tone: "error",
          title: "No se encontro el asistente",
          description:
            result.error ??
            "Revisa el identificador y vuelve a intentarlo.",
        });
        return;
      }

      setAsistente(result.asistente);
      await cargarEvento(result.asistente.evento_id);
      setInfoMessage("Asistente encontrado. Ya puedes revisar la sala.");
      pushToast({
        tone: "info",
        title: "Asistente identificado",
        description: `${result.asistente.nombre} ya puede entrar en la sala.`,
      });
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : "Ha ocurrido un problema de conexion. Vuelve a intentarlo.";

      setError(message);
      pushToast({
        tone: "error",
        title: "No se pudo comprobar el identificador",
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
    setInfoMessage("Guardando reserva con actualizacion optimista...");
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
          result.error ??
          "No se ha podido confirmar la reserva. Intentalo de nuevo.";

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
      const message =
        result.message ??
        "Reserva creada correctamente. La sala ya se ha sincronizado.";

      setInfoMessage(message);
      pushToast({
        tone: "success",
        title: "Reserva confirmada",
        description: message,
      });
    } catch {
      setEvento(previousEvento);
      setSelectedSillaId(previousSelectedSillaId);
      setError("Ha ocurrido un problema de conexion al guardar la reserva.");
      pushToast({
        tone: "error",
        title: "Fallo al guardar la reserva",
        description:
          "La pantalla ha deshecho el cambio visual porque el servidor no pudo confirmar la reserva.",
      });
    } finally {
      setReservationLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#fff7ed,_#f5f5f4_55%,_#e7e5e4)] px-6 py-12 text-stone-900">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <div className="mx-auto grid max-w-7xl gap-6 xl:grid-cols-[0.95fr_1.45fr]">
        <section className="rounded-[36px] border border-stone-200 bg-white px-8 py-10 shadow-[0_20px_70px_rgba(28,25,23,0.12)] sm:px-10">
          <p className="text-sm font-semibold uppercase tracking-[0.35em] text-amber-700">
            Sala de Cenas Interactiva
          </p>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight text-stone-950">
            Identifica al asistente y elige una silla en la sala.
          </h1>
          <p className="mt-5 text-lg leading-8 text-stone-600">
            Ya no solo consultamos si el identificador existe: ahora dibujamos
            la sala del evento y permitimos elegir una silla libre de forma
            visual.
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
              placeholder="Ejemplo: LUC-315"
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-5 py-4 text-lg font-medium uppercase tracking-[0.15em] text-stone-900 outline-none transition focus:border-amber-500 focus:bg-white"
            />
            <button
              type="submit"
              disabled={lookupLoading || roomLoading}
              className="inline-flex min-w-[220px] items-center justify-center rounded-full bg-stone-950 px-6 py-4 text-sm font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-stone-400"
            >
              {lookupLoading ? "Buscando..." : "Entrar en la sala"}
            </button>
          </form>

          <div className="mt-8 space-y-4">
            {lookupLoading || roomLoading ? (
              <div className="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-800">
                Estamos preparando los datos del asistente y la sala del evento.
              </div>
            ) : null}

            {error ? (
              <div className="rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-rose-700">
                <p className="text-sm font-semibold uppercase tracking-[0.2em]">
                  Error
                </p>
                <p className="mt-2 text-base leading-7">{error}</p>
              </div>
            ) : null}

            {infoMessage ? (
              <div className="rounded-3xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-emerald-700">
                <p className="text-sm font-semibold uppercase tracking-[0.2em]">
                  Estado
                </p>
                <p className="mt-2 text-base leading-7">{infoMessage}</p>
              </div>
            ) : null}

            {asistente ? (
              <div className="rounded-3xl bg-stone-950 px-6 py-5 text-stone-100">
                <p className="text-sm uppercase tracking-[0.25em] text-amber-300">
                  Asistente identificado
                </p>
                <p className="mt-3 text-2xl font-semibold">{asistente.nombre}</p>
                <p className="mt-2 text-sm uppercase tracking-[0.2em] text-stone-400">
                  {asistente.identificador}
                </p>

                {reservaActual ? (
                  <p className="mt-5 rounded-2xl bg-sky-500/15 px-4 py-3 text-sm leading-7 text-sky-200">
                    Este asistente ya tiene reservada la Mesa {reservaActual.mesaNumero},
                    Silla {reservaActual.sillaNumero}. La veras marcada en azul en
                    la sala.
                  </p>
                ) : (
                  <p className="mt-5 rounded-2xl bg-emerald-500/15 px-4 py-3 text-sm leading-7 text-emerald-200">
                    Todavia no tiene silla asignada. Puedes seleccionar una en
                    la sala y confirmar la reserva.
                  </p>
                )}
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                <p className="text-sm font-semibold text-stone-800">
                  Verde: libre
                </p>
                <p className="mt-1 text-sm leading-6 text-stone-500">
                  Se puede pulsar y elegir.
                </p>
              </div>
              <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                <p className="text-sm font-semibold text-stone-800">
                  Rojo: ocupada
                </p>
                <p className="mt-1 text-sm leading-6 text-stone-500">
                  Ya pertenece a otra persona.
                </p>
              </div>
              <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                <p className="text-sm font-semibold text-stone-800">
                  Amarillo: seleccionada
                </p>
                <p className="mt-1 text-sm leading-6 text-stone-500">
                  Es la silla que vas a confirmar.
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-stone-800">
                  Tiempo real
                </p>
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
                  ? "La sala esta escuchando cambios en vivo de reservas."
                  : "La escucha en vivo aun no esta activa o no hay sala cargada."}
              </p>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-amber-900">
              <p className="text-sm font-semibold uppercase tracking-[0.18em]">
                Confirmacion visual
              </p>
              <p className="mt-2 text-sm leading-6">
                {seleccionActual
                  ? `Has elegido la Mesa ${seleccionActual.mesaNumero}, Silla ${seleccionActual.sillaNumero}.`
                  : "Cuando pulses una silla verde, aqui te resumiremos tu eleccion antes de guardar."}
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-[36px] border border-stone-200 bg-white px-8 py-8 shadow-[0_20px_70px_rgba(28,25,23,0.12)] sm:px-10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-amber-700">
                Sala visual
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-stone-950">
                Plano interactivo del evento
              </h2>
            </div>

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

          <p className="mt-4 max-w-3xl text-base leading-7 text-stone-600">
            Cada mesa se dibuja en la posicion guardada en la base de datos. Las
            sillas se colocan alrededor y cambian de color segun su estado.
          </p>

          <div className="mt-8">
            {!evento ? (
              <div className="rounded-[28px] border border-dashed border-stone-300 bg-stone-50 px-6 py-10 text-stone-500">
                Primero identifica a un asistente para cargar la sala del evento.
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
            {selectedSillaId && !reservaActual ? (
              <div className="rounded-3xl border border-amber-200 bg-white px-4 py-4">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-700">
                  Seleccion lista
                </p>
                <p className="mt-2 text-base leading-7 text-stone-700">
                  {seleccionActual
                    ? `Has elegido la Mesa ${seleccionActual.mesaNumero}, Silla ${seleccionActual.sillaNumero}. El siguiente paso es confirmar la reserva.`
                    : "Ya has elegido una silla. El siguiente paso es confirmar la reserva."}
                </p>
              </div>
            ) : null}

            {!selectedSillaId && evento && !reservaActual ? (
              <p className="text-base leading-7 text-stone-600">
                Pulsa sobre una silla verde para seleccionarla. Si cambias de
                idea, puedes pulsarla otra vez para desmarcarla.
              </p>
            ) : null}

            {reservaActual ? (
              <p className="text-base leading-7 text-stone-600">
                La silla azul es la que ya tiene asignada este asistente. En la
                siguiente fase haremos que este estado llegue desde un flujo mas
                completo de usuario y navegacion.
              </p>
            ) : null}

            {reservationLoading ? (
              <p className="text-base leading-7 text-stone-600">
                La interfaz ya ha pintado la reserva de forma optimista mientras
                se confirma en el servidor.
              </p>
            ) : null}

            {!evento ? (
              <p className="text-base leading-7 text-stone-600">
                Cuando encontremos al asistente, aqui apareceran las mesas y
                sillas del evento listas para interactuar.
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
