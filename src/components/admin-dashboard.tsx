"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import AdminTableLayoutEditor from "@/components/admin-table-layout-editor";
import ToastStack, { ToastItem } from "@/components/toast-stack";
import {
  AdminEventSummary,
  AdminPanelData,
  AdminReservationRow,
} from "@/lib/admin-panel";
import { getNextMesaPosition } from "@/lib/room-layout";

type AdminDashboardProps = {
  events: AdminEventSummary[];
  selectedEventId: string | null;
  panelData: AdminPanelData | null;
};

type JsonResponse = {
  error?: string;
  message?: string;
  eventoId?: string;
  mesaId?: string;
};

type MesaCapacityPreset = "8" | "10" | "12" | "custom";

type ChairRow = {
  id: string;
  mesaId: string;
  mesaNumero: number;
  numero: number;
};

async function parseJsonResponse(response: Response) {
  return (await response.json()) as JsonResponse;
}

function AdminCard({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[32px] border border-stone-200 bg-white px-6 py-6 shadow-[0_20px_60px_rgba(28,25,23,0.08)]">
      <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-700">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight text-stone-950">
        {title}
      </h2>
      <p className="mt-3 text-sm leading-7 text-stone-600">{description}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function AdminField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-600">
        {label}
      </span>
      {children}
      {hint ? <span className="text-xs leading-5 text-stone-500">{hint}</span> : null}
    </label>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-3xl border border-stone-200 bg-stone-50 px-5 py-5">
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
        {label}
      </p>
      <p className="mt-3 text-3xl font-semibold text-stone-950">{value}</p>
    </div>
  );
}

function AdminSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <details
      open
      className="overflow-hidden rounded-[36px] border border-stone-200 bg-white shadow-[0_20px_70px_rgba(28,25,23,0.12)]"
    >
      <summary className="cursor-pointer list-none px-8 py-6 sm:px-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-amber-700">
              Gestion
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-stone-950">
              {title}
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-stone-600">
              {description}
            </p>
          </div>
          <span className="rounded-full border border-stone-300 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-600">
            Abrir o cerrar
          </span>
        </div>
      </summary>
      <div className="border-t border-stone-200 px-8 py-8 sm:px-10">{children}</div>
    </details>
  );
}

function DividerLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
      {children}
    </p>
  );
}

function FieldInputClass(disabled?: boolean) {
  return `w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm font-medium text-stone-900 outline-none transition focus:border-amber-500 focus:bg-white ${
    disabled ? "cursor-not-allowed bg-stone-100" : ""
  }`;
}

export default function AdminDashboard({
  events,
  selectedEventId,
  panelData,
}: AdminDashboardProps) {
  const router = useRouter();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const [eventoNombre, setEventoNombre] = useState("");
  const [eventoFecha, setEventoFecha] = useState("");
  const [editarEventoNombre, setEditarEventoNombre] = useState("");
  const [editarEventoFecha, setEditarEventoFecha] = useState("");

  const [asistenteNombre, setAsistenteNombre] = useState("");
  const [asistenteIdentificador, setAsistenteIdentificador] = useState("");
  const [asistenteEditId, setAsistenteEditId] = useState("");
  const [asistenteEditNombre, setAsistenteEditNombre] = useState("");
  const [asistenteEditIdentificador, setAsistenteEditIdentificador] = useState("");

  const [mesaNumero, setMesaNumero] = useState("1");
  const [mesaCapacityPreset, setMesaCapacityPreset] = useState<MesaCapacityPreset>("10");
  const [mesaCustomChairCount, setMesaCustomChairCount] = useState("10");
  const [mesaEditId, setMesaEditId] = useState("");
  const [mesaEditNumero, setMesaEditNumero] = useState("1");

  const [mesaSeleccionadaId, setMesaSeleccionadaId] = useState("");
  const [sillaNumero, setSillaNumero] = useState("1");
  const [sillaEditId, setSillaEditId] = useState("");
  const [sillaEditMesaId, setSillaEditMesaId] = useState("");
  const [sillaEditNumero, setSillaEditNumero] = useState("1");

  const [asistenteSeleccionadoId, setAsistenteSeleccionadoId] = useState("");
  const [sillaSeleccionadaId, setSillaSeleccionadaId] = useState("");

  const asistentesSinReserva = useMemo(
    () =>
      (panelData?.asistentes ?? []).filter(
        (asistente) => !asistente.reservaActual,
      ),
    [panelData],
  );

  const allChairs = useMemo<ChairRow[]>(
    () =>
      (panelData?.evento.mesas ?? []).flatMap((mesa) =>
        mesa.sillas.map((silla) => ({
          id: silla.id,
          mesaId: mesa.id,
          mesaNumero: mesa.numero,
          numero: silla.numero,
        })),
      ),
    [panelData],
  );

  const asistenteEditActual = useMemo(
    () =>
      (panelData?.asistentes ?? []).find(
        (asistente) => asistente.id === asistenteEditId,
      ) ?? null,
    [panelData, asistenteEditId],
  );

  const mesaEditActual = useMemo(
    () =>
      (panelData?.evento.mesas ?? []).find((mesa) => mesa.id === mesaEditId) ?? null,
    [panelData, mesaEditId],
  );

  const sillaEditActual = useMemo(
    () => allChairs.find((chair) => chair.id === sillaEditId) ?? null,
    [allChairs, sillaEditId],
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

  useEffect(() => {
    if (toasts.length === 0) {
      return;
    }

    const timeoutIds = toasts.map((toast) =>
      window.setTimeout(() => {
        dismissToast(toast.id);
      }, 4200),
    );

    return () => {
      timeoutIds.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
    };
  }, [toasts]);

  useEffect(() => {
    setEditarEventoNombre(panelData?.evento.nombre ?? "");
    setEditarEventoFecha(panelData?.evento.fecha ?? "");

    const firstMesa = panelData?.evento.mesas[0];
    const firstAsistente = panelData?.asistentes[0];
    const firstSillaDisponible = panelData?.sillasDisponibles[0];
    const firstChair = allChairs[0];

    setMesaSeleccionadaId(firstMesa?.id ?? "");
    setMesaEditId(firstMesa?.id ?? "");
    setMesaEditNumero(String(firstMesa?.numero ?? 1));

    setAsistenteSeleccionadoId(firstAsistente?.id ?? "");
    setAsistenteEditId(firstAsistente?.id ?? "");
    setAsistenteEditNombre(firstAsistente?.nombre ?? "");
    setAsistenteEditIdentificador(firstAsistente?.identificador ?? "");

    setSillaSeleccionadaId(firstSillaDisponible?.sillaId ?? "");
    setSillaEditId(firstChair?.id ?? "");
    setSillaEditMesaId(firstChair?.mesaId ?? "");
    setSillaEditNumero(String(firstChair?.numero ?? 1));
  }, [panelData, allChairs]);

  useEffect(() => {
    const nextMesaNumero =
      (panelData?.evento.mesas ?? []).reduce(
        (maxMesaNumero, mesa) => Math.max(maxMesaNumero, mesa.numero),
        0,
      ) + 1;

    setMesaNumero(String(nextMesaNumero));
  }, [panelData?.evento.mesas]);

  useEffect(() => {
    if (!asistenteEditActual) {
      return;
    }

    setAsistenteEditNombre(asistenteEditActual.nombre);
    setAsistenteEditIdentificador(asistenteEditActual.identificador);
  }, [asistenteEditActual]);

  useEffect(() => {
    if (!mesaEditActual) {
      return;
    }

    setMesaEditNumero(String(mesaEditActual.numero));
  }, [mesaEditActual]);

  useEffect(() => {
    if (!sillaEditActual) {
      return;
    }

    setSillaEditMesaId(sillaEditActual.mesaId);
    setSillaEditNumero(String(sillaEditActual.numero));
  }, [sillaEditActual]);

  async function runAdminAction(
    endpoint: string,
    payload: Record<string, string | number>,
    successTitle: string,
    onSuccess?: (result: JsonResponse) => void,
  ) {
    setError("");
    setStatusMessage("");

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result = await parseJsonResponse(response);

    if (!response.ok) {
      const message = result.error ?? "La accion admin no se pudo completar.";
      setError(message);
      pushToast({
        tone: "error",
        title: "Accion no completada",
        description: message,
      });
      return false;
    }

    const message = result.message ?? "Accion completada correctamente.";
    setStatusMessage(message);
    pushToast({
      tone: "success",
      title: successTitle,
      description: message,
    });

    onSuccess?.(result);
    startTransition(() => {
      router.refresh();
    });

    return true;
  }

  async function handleCreateEvento(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const created = await runAdminAction(
      "/api/admin/eventos/create",
      {
        nombre: eventoNombre,
        fecha: eventoFecha,
      },
      "Evento creado",
      (result) => {
        if (result.eventoId) {
          router.push(`/admin?eventoId=${result.eventoId}`);
        }
      },
    );

    if (created) {
      setEventoNombre("");
      setEventoFecha("");
    }
  }

  async function handleUpdateEvento(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedEventId) {
      return;
    }

    await runAdminAction(
      "/api/admin/eventos/update",
      {
        eventoId: selectedEventId,
        nombre: editarEventoNombre,
        fecha: editarEventoFecha,
      },
      "Evento actualizado",
    );
  }

  async function handleDeleteEvento() {
    if (!selectedEventId) {
      return;
    }

    const deleted = await runAdminAction(
      "/api/admin/eventos/delete",
      {
        eventoId: selectedEventId,
      },
      "Evento eliminado",
      () => {
        router.push("/admin");
      },
    );

    if (deleted) {
      setStatusMessage("Evento eliminado correctamente.");
    }
  }

  async function handleCreateAsistente(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedEventId) {
      return;
    }

    const created = await runAdminAction(
      "/api/admin/asistentes/create",
      {
        eventoId: selectedEventId,
        nombre: asistenteNombre,
        identificador: asistenteIdentificador,
      },
      "Asistente creado",
    );

    if (created) {
      setAsistenteNombre("");
      setAsistenteIdentificador("");
    }
  }

  async function handleUpdateAsistente(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!asistenteEditId) {
      return;
    }

    await runAdminAction(
      "/api/admin/asistentes/update",
      {
        asistenteId: asistenteEditId,
        nombre: asistenteEditNombre,
        identificador: asistenteEditIdentificador,
      },
      "Asistente actualizado",
    );
  }

  async function handleDeleteAsistente() {
    if (!asistenteEditId) {
      return;
    }

    await runAdminAction(
      "/api/admin/asistentes/delete",
      {
        asistenteId: asistenteEditId,
      },
      "Asistente eliminado",
    );
  }

  async function handleCreateMesa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedEventId) {
      return;
    }

    const nextPosition = getNextMesaPosition(panelData?.evento.mesas.length ?? 0);

    const chairCount =
      mesaCapacityPreset === "custom"
        ? Number(mesaCustomChairCount)
        : Number(mesaCapacityPreset);

    const created = await runAdminAction(
      "/api/admin/mesas/create",
      {
        eventoId: selectedEventId,
        numero: mesaNumero,
        chairCount,
        posX: nextPosition.posX,
        posY: nextPosition.posY,
      },
      "Mesa creada",
    );

    if (created) {
      setMesaNumero(String(Number(mesaNumero) + 1));
      if (mesaCapacityPreset === "custom") {
        setMesaCustomChairCount(mesaCustomChairCount);
      }
    }
  }

  async function handleUpdateMesa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!mesaEditId || !selectedEventId) {
      return;
    }

    await runAdminAction(
      "/api/admin/mesas/update",
      {
        mesaId: mesaEditId,
        eventoId: selectedEventId,
        numero: mesaEditNumero,
        posX: mesaEditActual?.pos_x ?? 220,
        posY: mesaEditActual?.pos_y ?? 180,
      },
      "Mesa actualizada",
    );
  }

  async function handleMoveMesa(mesaId: string, posX: number, posY: number) {
    if (!selectedEventId) {
      return;
    }

    const mesa = (panelData?.evento.mesas ?? []).find((item) => item.id === mesaId);

    if (!mesa) {
      return;
    }

    setError("");

    const response = await fetch("/api/admin/mesas/update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mesaId,
        eventoId: selectedEventId,
        numero: mesa.numero,
        posX,
        posY,
      }),
    });

    const result = await parseJsonResponse(response);

    if (!response.ok) {
      setError(result.error ?? "No se pudo recolocar la mesa.");
      pushToast({
        tone: "error",
        title: "Mesa no recolocada",
        description: result.error ?? "No se pudo guardar la nueva posicion.",
      });
    }
  }

  async function handleDeleteMesa() {
    if (!mesaEditId) {
      return;
    }

    await runAdminAction(
      "/api/admin/mesas/delete",
      {
        mesaId: mesaEditId,
      },
      "Mesa eliminada",
    );
  }

  async function handleCreateSilla(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const created = await runAdminAction(
      "/api/admin/sillas/create",
      {
        mesaId: mesaSeleccionadaId,
        numero: sillaNumero,
      },
      "Silla creada",
    );

    if (created) {
      setSillaNumero(String(Number(sillaNumero) + 1));
    }
  }

  async function handleUpdateSilla(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!sillaEditId || !sillaEditMesaId) {
      return;
    }

    await runAdminAction(
      "/api/admin/sillas/update",
      {
        sillaId: sillaEditId,
        mesaId: sillaEditMesaId,
        numero: sillaEditNumero,
      },
      "Silla actualizada",
    );
  }

  async function handleDeleteSilla() {
    if (!sillaEditId) {
      return;
    }

    await runAdminAction(
      "/api/admin/sillas/delete",
      {
        sillaId: sillaEditId,
      },
      "Silla eliminada",
    );
  }

  async function handleUpsertReserva(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedEventId) {
      return;
    }

    await runAdminAction(
      "/api/admin/reservas/upsert",
      {
        eventoId: selectedEventId,
        asistenteId: asistenteSeleccionadoId,
        sillaId: sillaSeleccionadaId,
      },
      "Reserva guardada",
    );
  }

  async function handleDeleteReserva(reserva: AdminReservationRow) {
    await runAdminAction(
      "/api/admin/reservas/delete",
      {
        reservaId: reserva.id,
      },
      "Reserva eliminada",
    );
  }

  async function handleLogout() {
    await fetch("/api/admin/logout", {
      method: "POST",
    });

    router.refresh();
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#fff7ed,_#f5f5f4_55%,_#e7e5e4)] px-6 py-12 text-stone-900">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <div className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-[36px] border border-stone-200 bg-white px-8 py-8 shadow-[0_20px_70px_rgba(28,25,23,0.12)] sm:px-10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.35em] text-amber-700">
                Panel admin
              </p>
              <h1 className="mt-4 text-4xl font-semibold tracking-tight text-stone-950">
                Gestion del evento y de la sala
              </h1>
              <p className="mt-4 max-w-3xl text-lg leading-8 text-stone-600">
                Aqui controlas el evento activo, las reservas y toda la
                estructura sin tocar Supabase a mano.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                href="/"
                className="inline-flex items-center justify-center rounded-full border border-stone-300 bg-white px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
              >
                Volver al acceso principal
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center justify-center rounded-full border border-stone-300 bg-white px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
              >
                Cerrar sesion
              </button>
            </div>
          </div>

          {statusMessage ? (
            <div className="mt-6 rounded-3xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-emerald-700">
              <p className="text-sm font-semibold uppercase tracking-[0.2em]">
                Estado
              </p>
              <p className="mt-2 text-base leading-7">{statusMessage}</p>
            </div>
          ) : null}

          {error ? (
            <div className="mt-6 rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4 text-rose-700">
              <p className="text-sm font-semibold uppercase tracking-[0.2em]">
                Error
              </p>
              <p className="mt-2 text-base leading-7">{error}</p>
            </div>
          ) : null}

          <div className="mt-8 grid gap-4 md:grid-cols-4">
            <StatCard label="Eventos" value={events.length} />
            <StatCard label="Asistentes" value={panelData?.asistentes.length ?? 0} />
            <StatCard label="Reservas" value={panelData?.reservas.length ?? 0} />
            <StatCard
              label="Sillas libres"
              value={panelData?.sillasDisponibles.length ?? 0}
            />
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.9fr_1.05fr_1.05fr]">
          <AdminCard
            eyebrow="Vista general"
            title="Evento que estas editando"
            description="Selecciona el evento activo del panel. Todo lo que cambies debajo se aplicara a este evento."
          >
            {events.length > 0 ? (
              <AdminField
                label="Evento activo"
                hint="Si cambias este selector, el panel se recarga con ese evento."
              >
                <select
                  value={selectedEventId ?? ""}
                  onChange={(event) => {
                    router.push(`/admin?eventoId=${event.target.value}`);
                  }}
                  className={FieldInputClass()}
                >
                  {events.map((eventItem) => (
                    <option key={eventItem.id} value={eventItem.id}>
                      {eventItem.nombre} - {eventItem.fecha}
                    </option>
                  ))}
                </select>
              </AdminField>
            ) : (
              <div className="rounded-3xl border border-dashed border-stone-300 bg-stone-50 px-5 py-5 text-sm leading-7 text-stone-500">
                Todavia no hay eventos creados.
              </div>
            )}

            {panelData ? (
              <div className="mt-5 rounded-3xl border border-stone-200 bg-stone-50 px-5 py-5">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
                  Evento abierto ahora
                </p>
                <p className="mt-3 text-lg font-semibold text-stone-950">
                  {panelData.evento.nombre}
                </p>
                <p className="mt-1 text-sm text-stone-600">{panelData.evento.fecha}</p>
              </div>
            ) : null}
          </AdminCard>

          <AdminCard
            eyebrow="Reservas"
            title="Recolocar o asignar sillas"
            description="Escoge un asistente y una silla libre para moverlo o sentarlo desde el panel."
          >
            <form className="grid gap-4" onSubmit={handleUpsertReserva}>
              <AdminField
                label="Asistente"
                hint="Puedes mover asistentes ya sentados o asignar los que aun no tienen sitio."
              >
                <select
                  value={asistenteSeleccionadoId}
                  onChange={(event) => setAsistenteSeleccionadoId(event.target.value)}
                  disabled={!panelData || panelData.asistentes.length === 0}
                  className={FieldInputClass(!panelData || panelData.asistentes.length === 0)}
                >
                  {(panelData?.asistentes ?? []).map((asistente) => (
                    <option key={asistente.id} value={asistente.id}>
                      {asistente.nombre} - {asistente.identificador}
                      {asistente.reservaActual
                        ? ` - Mesa ${asistente.reservaActual.mesaNumero}, Silla ${asistente.reservaActual.sillaNumero}`
                        : " - sin reserva"}
                    </option>
                  ))}
                </select>
              </AdminField>

              <AdminField
                label="Silla libre"
                hint="Solo aparecen sillas que ahora mismo siguen libres."
              >
                <select
                  value={sillaSeleccionadaId}
                  onChange={(event) => setSillaSeleccionadaId(event.target.value)}
                  disabled={!panelData || panelData.sillasDisponibles.length === 0}
                  className={FieldInputClass(!panelData || panelData.sillasDisponibles.length === 0)}
                >
                  {(panelData?.sillasDisponibles ?? []).map((silla) => (
                    <option key={silla.sillaId} value={silla.sillaId}>
                      {silla.label}
                    </option>
                  ))}
                </select>
              </AdminField>

              <button
                type="submit"
                disabled={
                  !selectedEventId ||
                  !asistenteSeleccionadoId ||
                  !sillaSeleccionadaId ||
                  isPending
                }
                className="inline-flex items-center justify-center rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-stone-400"
              >
                Guardar recolocacion
              </button>
            </form>

            <div className="mt-5 rounded-3xl border border-stone-200 bg-stone-50 px-4 py-4">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
                Asistentes sin reserva
              </p>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                {asistentesSinReserva.length > 0
                  ? asistentesSinReserva
                      .map(
                        (asistente) =>
                          `${asistente.nombre} (${asistente.identificador})`,
                      )
                      .join(", ")
                  : "Ahora mismo todos los asistentes del evento tienen silla."}
              </p>
            </div>
          </AdminCard>

          <AdminCard
            eyebrow="Reservas"
            title="Ver y deshacer reservas"
            description="Aqui puedes revisar el reparto actual y quitar reservas si necesitas rehacerlo."
          >
            <div className="space-y-3">
              {(panelData?.reservas ?? []).length === 0 ? (
                <div className="rounded-3xl border border-dashed border-stone-300 bg-stone-50 px-5 py-5 text-sm leading-7 text-stone-500">
                  Todavia no hay reservas en este evento.
                </div>
              ) : (
                panelData?.reservas.map((reserva) => (
                  <div
                    key={reserva.id}
                    className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-stone-200 bg-stone-50 px-4 py-4"
                  >
                    <div>
                      <p className="text-base font-semibold text-stone-900">
                        {reserva.asistenteNombre}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-stone-600">
                        {`${reserva.asistenteIdentificador} | Mesa ${reserva.mesaNumero}, Silla ${reserva.sillaNumero}`}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {reserva.esCeliaco ? (
                          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">
                            Celiaco
                          </span>
                        ) : null}
                        {reserva.tieneAlergias ? (
                          <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-rose-700">
                            Alergias
                          </span>
                        ) : null}
                        {reserva.movilidadReducida ? (
                          <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-sky-700">
                            Movilidad reducida
                          </span>
                        ) : null}
                      </div>
                      {reserva.observaciones ? (
                        <p className="mt-3 text-sm leading-6 text-stone-500">
                          {reserva.observaciones}
                        </p>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDeleteReserva(reserva)}
                      disabled={isPending}
                      className="inline-flex items-center justify-center rounded-full border border-rose-300 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-rose-700 transition hover:border-rose-500 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Deshacer reserva
                    </button>
                  </div>
                ))
              )}
            </div>
          </AdminCard>
        </section>

        <AdminSection
          title="Eventos y asistentes"
          description="Aqui puedes crear, editar y eliminar el evento activo y las personas invitadas."
        >
          <div className="grid gap-6 xl:grid-cols-2">
            <AdminCard
              eyebrow="Eventos"
              title="Crear, editar y eliminar eventos"
              description="Primero puedes crear nuevos eventos y despues modificar o borrar el que tengas activo."
            >
              <form className="grid gap-4" onSubmit={handleUpdateEvento}>
                <DividerLabel>Editar evento activo</DividerLabel>
                <AdminField
                  label="Nombre actual"
                  hint="Este cambio se aplicara al evento que tienes seleccionado arriba."
                >
                  <input
                    type="text"
                    value={editarEventoNombre}
                    onChange={(event) => setEditarEventoNombre(event.target.value)}
                    disabled={!selectedEventId}
                    className={FieldInputClass(!selectedEventId)}
                  />
                </AdminField>
                <AdminField
                  label="Fecha actual"
                  hint="Puedes corregir la fecha sin crear un evento nuevo."
                >
                  <input
                    type="date"
                    value={editarEventoFecha}
                    onChange={(event) => setEditarEventoFecha(event.target.value)}
                    disabled={!selectedEventId}
                    className={FieldInputClass(!selectedEventId)}
                  />
                </AdminField>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="submit"
                    disabled={!selectedEventId || isPending}
                    className="inline-flex items-center justify-center rounded-full bg-stone-950 px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-stone-400"
                  >
                    Guardar cambios
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteEvento}
                    disabled={!selectedEventId || isPending}
                    className="inline-flex items-center justify-center rounded-full border border-rose-300 bg-white px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-rose-700 transition hover:border-rose-500 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Eliminar evento
                  </button>
                </div>
              </form>

              <div className="my-6 border-t border-stone-200" />

              <form className="grid gap-4" onSubmit={handleCreateEvento}>
                <DividerLabel>Crear evento</DividerLabel>
                <AdminField
                  label="Nombre del evento"
                  hint="Ejemplo: Cena anual Logievents 2026"
                >
                  <input
                    type="text"
                    value={eventoNombre}
                    onChange={(event) => setEventoNombre(event.target.value)}
                    placeholder="Nombre del evento"
                    className={FieldInputClass()}
                  />
                </AdminField>
                <AdminField
                  label="Fecha del evento"
                  hint="Usa la fecha real en la que se celebrara."
                >
                  <input
                    type="date"
                    value={eventoFecha}
                    onChange={(event) => setEventoFecha(event.target.value)}
                    className={FieldInputClass()}
                  />
                </AdminField>
                <button
                  type="submit"
                  disabled={isPending}
                  className="inline-flex items-center justify-center rounded-full bg-stone-950 px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-stone-400"
                >
                  Crear evento
                </button>
              </form>
            </AdminCard>

            <AdminCard
              eyebrow="Asistentes"
              title="Crear, editar y eliminar asistentes"
              description="Da de alta personas nuevas o corrige el nombre y el identificador de las existentes."
            >
              <form className="grid gap-4" onSubmit={handleUpdateAsistente}>
                <DividerLabel>Editar o eliminar asistente</DividerLabel>
                <AdminField
                  label="Asistente"
                  hint="Selecciona a quien quieres corregir o borrar."
                >
                  <select
                    value={asistenteEditId}
                    onChange={(event) => setAsistenteEditId(event.target.value)}
                    disabled={!panelData || panelData.asistentes.length === 0}
                    className={FieldInputClass(!panelData || panelData.asistentes.length === 0)}
                  >
                    {(panelData?.asistentes ?? []).map((asistente) => (
                      <option key={asistente.id} value={asistente.id}>
                        {asistente.nombre} - {asistente.identificador}
                      </option>
                    ))}
                  </select>
                </AdminField>
                <AdminField label="Nuevo nombre">
                  <input
                    type="text"
                    value={asistenteEditNombre}
                    onChange={(event) => setAsistenteEditNombre(event.target.value)}
                    disabled={!asistenteEditId}
                    className={FieldInputClass(!asistenteEditId)}
                  />
                </AdminField>
                <AdminField label="Nuevo identificador">
                  <input
                    type="text"
                    value={asistenteEditIdentificador}
                    onChange={(event) =>
                      setAsistenteEditIdentificador(event.target.value.toUpperCase())
                    }
                    disabled={!asistenteEditId}
                    className={`${FieldInputClass(!asistenteEditId)} uppercase tracking-[0.08em]`}
                  />
                </AdminField>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="submit"
                    disabled={!asistenteEditId || isPending}
                    className="inline-flex items-center justify-center rounded-full bg-stone-950 px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-stone-400"
                  >
                    Guardar cambios
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteAsistente}
                    disabled={!asistenteEditId || isPending}
                    className="inline-flex items-center justify-center rounded-full border border-rose-300 bg-white px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-rose-700 transition hover:border-rose-500 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Eliminar asistente
                  </button>
                </div>
              </form>

              <div className="my-6 border-t border-stone-200" />

              <form className="grid gap-4" onSubmit={handleCreateAsistente}>
                <DividerLabel>Crear asistente</DividerLabel>
                <AdminField
                  label="Nombre del asistente"
                  hint="Nombre completo tal y como lo vera el equipo."
                >
                  <input
                    type="text"
                    value={asistenteNombre}
                    onChange={(event) => setAsistenteNombre(event.target.value)}
                    placeholder="Nombre del asistente"
                    disabled={!selectedEventId}
                    className={FieldInputClass(!selectedEventId)}
                  />
                </AdminField>
                <AdminField
                  label="Identificador"
                  hint="Ejemplo: ANA-104 o INV-001."
                >
                  <input
                    type="text"
                    value={asistenteIdentificador}
                    onChange={(event) =>
                      setAsistenteIdentificador(event.target.value.toUpperCase())
                    }
                    placeholder="Codigo del asistente"
                    disabled={!selectedEventId}
                    className={`${FieldInputClass(!selectedEventId)} uppercase tracking-[0.08em]`}
                  />
                </AdminField>
                <button
                  type="submit"
                  disabled={!selectedEventId || isPending}
                  className="inline-flex items-center justify-center rounded-full bg-stone-950 px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-stone-400"
                >
                  Crear asistente
                </button>
              </form>
            </AdminCard>
          </div>
        </AdminSection>

        <AdminSection
          title="Mesas y sillas"
          description="Desde aqui montas la sala, la corriges y eliminas lo que ya no sirva."
        >
          <div className="grid gap-6 xl:grid-cols-2">
            <AdminCard
              eyebrow="Plano"
              title="Resumen de estructura"
              description="Un vistazo rapido a las mesas del evento. Puedes arrastrarlas para recolocarlas en la sala."
            >
              <AdminTableLayoutEditor
                mesas={panelData?.evento.mesas ?? []}
                selectedMesaId={mesaEditId}
                onSelectMesa={setMesaEditId}
                onMoveMesa={handleMoveMesa}
                disabled={isPending}
              />

              <div className="grid gap-3 sm:grid-cols-2">
                {(panelData?.evento.mesas ?? []).length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-stone-300 bg-stone-50 px-5 py-5 text-sm leading-7 text-stone-500">
                    Este evento aun no tiene mesas creadas.
                  </div>
                ) : (
                  panelData?.evento.mesas.map((mesa) => (
                    <div
                      key={mesa.id}
                      className="rounded-3xl border border-stone-200 bg-stone-50 px-5 py-5"
                    >
                      <p className="text-base font-semibold text-stone-900">
                        Mesa {mesa.numero}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-stone-600">
                        Sillas: {mesa.sillas.length}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </AdminCard>

            <AdminCard
              eyebrow="Sillas"
              title="Crear, editar y eliminar sillas"
              description="Crea sillas nuevas, cambialas de mesa o corrige su numero cuando haga falta."
            >
              <form className="grid gap-4" onSubmit={handleUpdateSilla}>
                <DividerLabel>Editar o eliminar silla</DividerLabel>
                <AdminField
                  label="Silla"
                  hint="Selecciona la silla que quieres modificar."
                >
                  <select
                    value={sillaEditId}
                    onChange={(event) => setSillaEditId(event.target.value)}
                    disabled={allChairs.length === 0}
                    className={FieldInputClass(allChairs.length === 0)}
                  >
                    {allChairs.map((chair) => (
                      <option key={chair.id} value={chair.id}>
                        Mesa {chair.mesaNumero} - Silla {chair.numero}
                      </option>
                    ))}
                  </select>
                </AdminField>
                <AdminField label="Mesa de destino">
                  <select
                    value={sillaEditMesaId}
                    onChange={(event) => setSillaEditMesaId(event.target.value)}
                    disabled={!sillaEditId}
                    className={FieldInputClass(!sillaEditId)}
                  >
                    {(panelData?.evento.mesas ?? []).map((mesa) => (
                      <option key={mesa.id} value={mesa.id}>
                        Mesa {mesa.numero}
                      </option>
                    ))}
                  </select>
                </AdminField>
                <AdminField label="Numero de silla">
                  <input
                    type="number"
                    value={sillaEditNumero}
                    onChange={(event) => setSillaEditNumero(event.target.value)}
                    disabled={!sillaEditId}
                    className={FieldInputClass(!sillaEditId)}
                  />
                </AdminField>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="submit"
                    disabled={!sillaEditId || isPending}
                    className="inline-flex items-center justify-center rounded-full bg-stone-950 px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-stone-400"
                  >
                    Guardar cambios
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteSilla}
                    disabled={!sillaEditId || isPending}
                    className="inline-flex items-center justify-center rounded-full border border-rose-300 bg-white px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-rose-700 transition hover:border-rose-500 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Eliminar silla
                  </button>
                </div>
              </form>

              <div className="my-6 border-t border-stone-200" />

              <form className="grid gap-4" onSubmit={handleCreateSilla}>
                <DividerLabel>Crear silla</DividerLabel>
                <AdminField
                  label="Mesa donde crear la silla"
                  hint="La silla se anadira a la mesa que elijas aqui."
                >
                  <select
                    value={mesaSeleccionadaId}
                    onChange={(event) => setMesaSeleccionadaId(event.target.value)}
                    disabled={!panelData || panelData.evento.mesas.length === 0}
                    className={FieldInputClass(!panelData || panelData.evento.mesas.length === 0)}
                  >
                    {(panelData?.evento.mesas ?? []).map((mesa) => (
                      <option key={mesa.id} value={mesa.id}>
                        Mesa {mesa.numero}
                      </option>
                    ))}
                  </select>
                </AdminField>
                <AdminField
                  label="Numero de silla"
                  hint="Ejemplo: 1, 2, 3 o 4."
                >
                  <input
                    type="number"
                    value={sillaNumero}
                    onChange={(event) => setSillaNumero(event.target.value)}
                    disabled={!mesaSeleccionadaId}
                    className={FieldInputClass(!mesaSeleccionadaId)}
                  />
                </AdminField>
                <button
                  type="submit"
                  disabled={!mesaSeleccionadaId || isPending}
                  className="inline-flex items-center justify-center rounded-full bg-stone-950 px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-stone-400"
                >
                  Crear silla
                </button>
              </form>
            </AdminCard>
          </div>

          <div className="mt-6">
            <AdminCard
              eyebrow="Mesas"
              title="Crear, editar y eliminar mesas"
              description="Crea mesas nuevas y cambia su numero. La posicion ahora se gestiona arrastrandolas en el editor visual."
            >
              <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
                <form className="grid gap-4" onSubmit={handleUpdateMesa}>
                  <DividerLabel>Editar o eliminar mesa</DividerLabel>
                  <AdminField
                    label="Mesa"
                    hint="Selecciona la mesa que quieres corregir."
                  >
                    <select
                      value={mesaEditId}
                      onChange={(event) => setMesaEditId(event.target.value)}
                      disabled={!panelData || panelData.evento.mesas.length === 0}
                      className={FieldInputClass(!panelData || panelData.evento.mesas.length === 0)}
                    >
                      {(panelData?.evento.mesas ?? []).map((mesa) => (
                        <option key={mesa.id} value={mesa.id}>
                          Mesa {mesa.numero}
                        </option>
                      ))}
                    </select>
                  </AdminField>
                  <div className="grid gap-4 lg:grid-cols-3">
                    <AdminField label="Nuevo numero">
                      <input
                        type="number"
                        value={mesaEditNumero}
                        onChange={(event) => setMesaEditNumero(event.target.value)}
                        disabled={!mesaEditId}
                        className={FieldInputClass(!mesaEditId)}
                      />
                    </AdminField>
                  </div>
                  <p className="text-sm leading-6 text-stone-600">
                    La posicion de esta mesa se cambia arrastrandola dentro del editor visual de arriba.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="submit"
                      disabled={!mesaEditId || isPending}
                      className="inline-flex items-center justify-center rounded-full bg-stone-950 px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-stone-400"
                    >
                      Guardar cambios
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteMesa}
                      disabled={!mesaEditId || isPending}
                      className="inline-flex items-center justify-center rounded-full border border-rose-300 bg-white px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-rose-700 transition hover:border-rose-500 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Eliminar mesa
                    </button>
                  </div>
                </form>

                <form className="grid gap-4" onSubmit={handleCreateMesa}>
                  <DividerLabel>Crear mesa</DividerLabel>
                  <div className="grid gap-4">
                    <AdminField
                      label="Numero de mesa"
                      hint="La nueva mesa aparecera colocada automaticamente y luego podras moverla arrastrando."
                    >
                      <input
                        type="number"
                        value={mesaNumero}
                        onChange={(event) => setMesaNumero(event.target.value)}
                        disabled={!selectedEventId}
                        className={FieldInputClass(!selectedEventId)}
                      />
                    </AdminField>
                    <AdminField
                      label="Tipo de mesa"
                      hint="La mesa se creara con sus sillas automaticamente."
                    >
                      <select
                        value={mesaCapacityPreset}
                        onChange={(event) =>
                          setMesaCapacityPreset(event.target.value as MesaCapacityPreset)
                        }
                        disabled={!selectedEventId}
                        className={FieldInputClass(!selectedEventId)}
                      >
                        <option value="8">Mesa para 8</option>
                        <option value="10">Mesa para 10</option>
                        <option value="12">Mesa para 12</option>
                        <option value="custom">Personalizada</option>
                      </select>
                    </AdminField>
                    {mesaCapacityPreset === "custom" ? (
                      <AdminField
                        label="Numero de sillas"
                        hint="El tamano visual de la mesa se ajustara a esta cantidad."
                      >
                        <input
                          type="number"
                          min="1"
                          max="40"
                          value={mesaCustomChairCount}
                          onChange={(event) => setMesaCustomChairCount(event.target.value)}
                          disabled={!selectedEventId}
                          className={FieldInputClass(!selectedEventId)}
                        />
                      </AdminField>
                    ) : null}
                  </div>
                  <button
                    type="submit"
                    disabled={!selectedEventId || isPending}
                    className="inline-flex items-center justify-center rounded-full bg-stone-950 px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-stone-400"
                  >
                    Crear mesa
                  </button>
                </form>
              </div>
            </AdminCard>
          </div>
        </AdminSection>
      </div>
    </main>
  );
}
