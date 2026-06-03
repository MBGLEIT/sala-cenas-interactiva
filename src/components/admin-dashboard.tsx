"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import AdminTableLayoutEditor from "@/components/admin-table-layout-editor";
import DinnerRoomScene from "@/components/dinner-room-scene";
import ToastStack, { ToastItem } from "@/components/toast-stack";
import {
  AdminEventSummary,
  AdminPanelData,
  AdminReservationRow,
} from "@/lib/admin-panel";
import { EventoSala } from "@/lib/dinner-room";
import { getNextMesaPosition } from "@/lib/room-layout";
import {
  PLAN_IMPORT_FILE_SIZE_MESSAGE,
  PLAN_IMPORT_SAFE_FILE_SIZE_BYTES,
} from "@/lib/runtime-env";
import { supabase } from "@/lib/supabase";

type AdminDashboardProps = {
  events: AdminEventSummary[];
  selectedEventId: string | null;
  panelData: AdminPanelData | null;
};

type JsonResponse = {
  error?: string;
  message?: string;
  cancelled?: boolean;
  unsupported?: boolean;
  queued?: boolean;
  eventoId?: string;
  mesaId?: string;
  traceId?: string;
  eventoNombre?: string | null;
  mesaIds?: string[];
  importedTables?: Array<{
    numero: number;
    chairCount: number;
    posX: number;
    posY: number;
  }>;
};

type ImportTraceLogEntry = {
  id: string;
  at: string;
  level: "info" | "warn" | "error";
  stage: string;
  details?: Record<string, unknown>;
};

type ImportProgressState = {
  traceId: string;
  status:
    | "pending"
    | "running"
    | "cancel_requested"
    | "review_pending"
    | "completed"
    | "failed"
    | "cancelled";
  logs: ImportTraceLogEntry[];
  expanded: boolean;
  summary?: string;
  cancelling: boolean;
  eventoId: string;
  eventoNombre: string;
};

type ReimportDialogMode = "choice" | "params" | null;

type MesaCapacityPreset = "8" | "10" | "12" | "custom";

type ChairRow = {
  id: string;
  mesaId: string;
  mesaNumero: number;
  numero: number;
};

type ImportReviewState = {
  traceId: string;
  eventoId: string;
  eventoNombre: string;
  mesaIds: string[];
  importedTables: Array<{
    numero: number;
    chairCount: number;
    posX: number;
    posY: number;
  }>;
};

function buildPreviewEvent(review: ImportReviewState): EventoSala {
  return {
    id: review.eventoId,
    nombre: review.eventoNombre,
    fecha: "",
    mesas: review.importedTables.map((table) => ({
      id: `preview-mesa-${table.numero}`,
      numero: table.numero,
      pos_x: table.posX,
      pos_y: table.posY,
      created_at: "",
      sillas: Array.from({ length: table.chairCount }, (_, index) => ({
        id: `preview-silla-${table.numero}-${index + 1}`,
        numero: index + 1,
        created_at: "",
        reservas: [],
      })),
    })),
  };
}

async function parseJsonResponse(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return (await response.json()) as JsonResponse;
  }

  const rawText = await response.text();
  return {
    error:
      rawText.trim() ||
      "La respuesta del servidor no se pudo interpretar correctamente.",
  } satisfies JsonResponse;
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

function formatImportLogEntry(entry: ImportTraceLogEntry) {
  const time = new Date(entry.at).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const details = entry.details ? ` ${JSON.stringify(entry.details)}` : "";
  return `[${time}] ${entry.stage}${details}`;
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
  const refreshTimeoutRef = useRef<number | null>(null);

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
  const [mesaBatchQuantity, setMesaBatchQuantity] = useState("1");
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
  const [planFile, setPlanFile] = useState<File | null>(null);
  const [planExpectedTableCount, setPlanExpectedTableCount] = useState("");
  const [planExpectedRowCount, setPlanExpectedRowCount] = useState("");
  const [planExpectedColumnCount, setPlanExpectedColumnCount] = useState("");
  const [planExpectedChairTotal, setPlanExpectedChairTotal] = useState("");
  const [importReview, setImportReview] = useState<ImportReviewState | null>(null);
  const [showImportRejectActions, setShowImportRejectActions] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgressState | null>(null);
  const [reimportDialogMode, setReimportDialogMode] = useState<ReimportDialogMode>(null);
  const [reimportFile, setReimportFile] = useState<File | null>(null);
  const [reimportExpectedTableCount, setReimportExpectedTableCount] = useState("");
  const [reimportExpectedRowCount, setReimportExpectedRowCount] = useState("");
  const [reimportExpectedColumnCount, setReimportExpectedColumnCount] = useState("");
  const [reimportExpectedChairTotal, setReimportExpectedChairTotal] = useState("");
  const importAbortRef = useRef<AbortController | null>(null);
  const importStatusNotFoundCountRef = useRef(0);

  const asistentesSinReserva = useMemo(
    () =>
      (panelData?.asistentes ?? []).filter(
        (asistente) => !asistente.reservaActual,
      ),
    [panelData],
  );

  const reservasConAvisosCount = useMemo(
    () =>
      (panelData?.reservas ?? []).filter(
        (reserva) =>
          reserva.esCeliaco ||
          reserva.tieneAlergias ||
          reserva.movilidadReducida ||
          Boolean(reserva.observaciones?.trim()),
      ).length,
    [panelData?.reservas],
  );
  const importReviewPreviewEvent = useMemo(
    () => (importReview ? buildPreviewEvent(importReview) : null),
    [importReview],
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

  const activeImportTraceId = importProgress?.traceId;
  const activeImportStatus = importProgress?.status;

  const scheduleRouterRefresh = useCallback((delay: number = 350) => {
    window.setTimeout(() => {
      startTransition(() => {
        router.refresh();
      });
    }, delay);
  }, [router, startTransition]);

  const scheduleImportRefreshes = useCallback(() => {
    scheduleRouterRefresh(700);
    scheduleRouterRefresh(1800);
  }, [scheduleRouterRefresh]);

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
    if (!activeImportTraceId || !activeImportStatus) {
      return;
    }

    if (
      activeImportStatus === "completed" ||
      activeImportStatus === "failed" ||
      activeImportStatus === "cancelled"
    ) {
      return;
    }

    let cancelled = false;

    const pollTrace = async () => {
      try {
        const response = await fetch(
          `/api/admin/mesas/import-plan/status?traceId=${encodeURIComponent(activeImportTraceId)}`,
          { cache: "no-store" },
        );

        if (!response.ok) {
          const result = await parseJsonResponse(response);
          if (cancelled) {
            return;
          }

          const isTransientMissingTrace =
            response.status === 404 &&
            (activeImportStatus === "pending" ||
              activeImportStatus === "running" ||
              activeImportStatus === "cancel_requested");

          if (isTransientMissingTrace) {
            importStatusNotFoundCountRef.current += 1;

            if (importStatusNotFoundCountRef.current <= 40) {
              setImportProgress((current) =>
                current && current.traceId === activeImportTraceId
                  ? {
                      ...current,
                      summary:
                        importStatusNotFoundCountRef.current <= 4
                          ? "Sincronizando la importacion con la cola cloud..."
                          : "La importacion ya esta en cola. Esperando a que el seguimiento cloud quede disponible...",
                    }
                  : current,
              );
              return;
            }
          }

          importAbortRef.current = null;
          importStatusNotFoundCountRef.current = 0;
          setImportProgress(null);
          setError(result.error ?? "No se pudo consultar el estado de la importacion.");
          pushToast({
            tone: "error",
            title: "Seguimiento no disponible",
            description:
              result.error ?? "No se pudo consultar el estado de la importacion.",
          });
          return;
        }

        const snapshot = (await response.json()) as {
          status: ImportProgressState["status"];
          logs: ImportTraceLogEntry[];
          summary?: string;
          cancelRequested?: boolean;
          eventoId?: string;
          eventoNombre?: string | null;
          createdMesaIds?: string[];
          importedTables?: ImportReviewState["importedTables"];
        };

        if (cancelled) {
          return;
        }

        importStatusNotFoundCountRef.current = 0;

        setImportProgress((current) => {
          if (!current || current.traceId !== activeImportTraceId) {
            return current;
          }

          return {
            ...current,
            status: snapshot.status,
            logs: snapshot.logs ?? current.logs,
            summary: snapshot.summary ?? current.summary,
            cancelling: snapshot.status === "cancel_requested" || current.cancelling,
            eventoId: snapshot.eventoId ?? current.eventoId,
            eventoNombre: snapshot.eventoNombre ?? current.eventoNombre,
          };
        });

        if (snapshot.status === "cancelled") {
          importAbortRef.current = null;
          setImportProgress(null);
          setStatusMessage(snapshot.summary ?? "Importacion cancelada correctamente.");
          pushToast({
            tone: "success",
            title: "Importacion cancelada",
            description:
              snapshot.summary ??
              "La importacion se ha cancelado antes de guardar cambios en el evento.",
          });
          scheduleImportRefreshes();
          return;
        }

        if (snapshot.status === "failed") {
          importAbortRef.current = null;
          setImportProgress(null);
          setError(snapshot.summary ?? "La importacion del plano ha fallado.");
          pushToast({
            tone: "error",
            title: "Importacion fallida",
            description: snapshot.summary ?? "La importacion del plano ha fallado.",
          });
          scheduleImportRefreshes();
          return;
        }

        if (
          snapshot.status === "review_pending" &&
          snapshot.importedTables?.length
        ) {
          importAbortRef.current = null;
          setImportProgress(null);
          setImportReview({
            traceId: activeImportTraceId,
            eventoId:
              snapshot.eventoId ?? selectedEventId ?? panelData?.evento.id ?? "",
            eventoNombre:
              snapshot.eventoNombre ?? panelData?.evento.nombre ?? "Evento",
            mesaIds: snapshot.createdMesaIds ?? [],
            importedTables: snapshot.importedTables,
          });
          setShowImportRejectActions(false);
          setStatusMessage(snapshot.summary ?? "Plano importado y listo para revision.");
          pushToast({
            tone: "success",
            title: "Importacion completada",
            description: snapshot.summary ?? "Revisa el plano antes de confirmarlo.",
          });
          scheduleImportRefreshes();
        }
      } catch {}
    };

    void pollTrace();
    const intervalId = window.setInterval(() => {
      void pollTrace();
    }, 900);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeImportStatus, activeImportTraceId, panelData?.evento.id, panelData?.evento.nombre, scheduleImportRefreshes, selectedEventId]);

  useEffect(() => {
    if (!selectedEventId) {
      return;
    }

    function scheduleRefresh() {
      if (refreshTimeoutRef.current) {
        window.clearTimeout(refreshTimeoutRef.current);
      }

      refreshTimeoutRef.current = window.setTimeout(() => {
        startTransition(() => {
          router.refresh();
        });
      }, 350);
    }

    const channel = supabase
      .channel(`admin-live-${selectedEventId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "eventos",
          filter: `id=eq.${selectedEventId}`,
        },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "mesas",
          filter: `evento_id=eq.${selectedEventId}`,
        },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "asistentes",
          filter: `evento_id=eq.${selectedEventId}`,
        },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "reservas",
        },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sillas",
        },
        scheduleRefresh,
      )
      .subscribe();

    return () => {
      if (refreshTimeoutRef.current) {
        window.clearTimeout(refreshTimeoutRef.current);
      }

      void supabase.removeChannel(channel);
    };
  }, [router, selectedEventId, startTransition]);

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

  useEffect(() => {
    if (!mesaSeleccionadaId) {
      setSillaNumero("1");
      return;
    }

    const mesaSeleccionada =
      (panelData?.evento.mesas ?? []).find((mesa) => mesa.id === mesaSeleccionadaId) ??
      null;
    const siguienteNumero =
      (mesaSeleccionada?.sillas ?? []).reduce(
        (maxSillaNumero, silla) => Math.max(maxSillaNumero, silla.numero),
        0,
      ) + 1;

    setSillaNumero(String(siguienteNumero));
  }, [mesaSeleccionadaId, panelData?.evento.mesas]);

  async function runAdminAction(
    endpoint: string,
    payload: Record<string, string | number | boolean>,
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
    scheduleRouterRefresh();

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

    const chairCount =
      mesaCapacityPreset === "custom"
        ? Number(mesaCustomChairCount)
        : Number(mesaCapacityPreset);
    const nextPosition = getNextMesaPosition(
      panelData?.evento.mesas.length ?? 0,
      chairCount,
      panelData?.evento.nombre ?? "EVENTO",
    );

    const created = await runAdminAction(
      "/api/admin/mesas/create",
      {
        eventoId: selectedEventId,
        numero: mesaNumero,
        quantity: mesaBatchQuantity,
        chairCount,
        posX: nextPosition.posX,
        posY: nextPosition.posY,
      },
      "Mesa creada",
    );

    if (created) {
      setMesaNumero(String(Number(mesaNumero) + Number(mesaBatchQuantity)));
      if (mesaCapacityPreset === "custom") {
        setMesaCustomChairCount(mesaCustomChairCount);
      }
    }
  }

  async function runPlanImport(fileToImport: File, hints: {
    expectedTableCount: string;
    expectedRowCount: string;
    expectedColumnCount: string;
    expectedChairTotal: string;
  }) {
    if (!selectedEventId) {
      return false;
    }

    if (fileToImport.size > PLAN_IMPORT_SAFE_FILE_SIZE_BYTES) {
      setImportProgress(null);
      setError(PLAN_IMPORT_FILE_SIZE_MESSAGE);
      pushToast({
        tone: "error",
        title: "Plano demasiado grande",
        description: PLAN_IMPORT_FILE_SIZE_MESSAGE,
      });
      return false;
    }

    setError("");
    setStatusMessage("");

    const formData = new FormData();
    const clientTraceId = crypto.randomUUID().slice(0, 8);
    formData.append("clientTraceId", clientTraceId);
    formData.append("eventoId", selectedEventId);
    formData.append("file", fileToImport);
    if (hints.expectedTableCount.trim()) {
      formData.append("expectedTableCount", hints.expectedTableCount.trim());
    }
    if (hints.expectedRowCount.trim()) {
      formData.append("expectedRowCount", hints.expectedRowCount.trim());
    }
    if (hints.expectedColumnCount.trim()) {
      formData.append("expectedColumnCount", hints.expectedColumnCount.trim());
    }
    if (hints.expectedChairTotal.trim()) {
      formData.append("expectedChairTotal", hints.expectedChairTotal.trim());
    }

    let response: Response;
    let result: JsonResponse;
    const controller = new AbortController();
    importAbortRef.current = controller;
    importStatusNotFoundCountRef.current = 0;
    setImportProgress({
      traceId: clientTraceId,
      status: "pending",
      logs: [],
      expanded: false,
      summary: "Preparando la importacion del plano.",
      cancelling: false,
      eventoId: selectedEventId,
      eventoNombre: panelData?.evento.nombre ?? "Evento",
    });

    try {
      response = await fetch("/api/admin/mesas/import-plan", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      result = await parseJsonResponse(response);
    } catch (error) {
      if ((error as Error)?.name === "AbortError") {
        return;
      }

      importAbortRef.current = null;
      setImportProgress(null);
      const message =
        "La carga del plano no pudo completarse. El servidor no devolvio una respuesta valida.";
      setError(message);
      pushToast({
        tone: "error",
        title: "Plano no cargado",
        description: message,
      });
      return false;
    }

    if (!response) {
      importAbortRef.current = null;
      setImportProgress(null);
      const message =
        "La carga del plano no pudo completarse. El servidor no devolvio una respuesta valida.";
      setError(message);
      pushToast({
        tone: "error",
        title: "Plano no cargado",
        description: message,
      });
      return false;
    }

    if (!response.ok) {
      if (result.cancelled) {
        importAbortRef.current = null;
        setImportProgress((current) =>
          current
            ? {
                ...current,
                status: "cancelled",
                cancelling: false,
                summary: result.error ?? "Importacion cancelada correctamente.",
              }
            : null,
        );
        setStatusMessage(result.error ?? "Importacion cancelada correctamente.");
        pushToast({
          tone: "success",
          title: "Importacion cancelada",
          description:
            result.error ??
            "La importacion se ha cancelado antes de guardar cambios en el evento.",
        });
        window.setTimeout(() => {
          setImportProgress(null);
        }, 400);
        return false;
      }

      importAbortRef.current = null;
      setImportProgress(null);
      const message = result.error ?? "No se pudo cargar el plano.";
      setError(message);
      pushToast({
        tone: "error",
        title: result.unsupported ? "Importador no disponible" : "Plano no cargado",
        description: message,
      });
      return false;
    }

    const message = result.message ?? "Plano cargado correctamente.";
    if (result.queued) {
      importAbortRef.current = null;
      importStatusNotFoundCountRef.current = 0;
      setImportProgress((current) =>
        current
          ? {
              ...current,
              status: "pending",
              summary: message,
            }
          : current,
      );
      setStatusMessage(message);
      pushToast({
        tone: "success",
        title: "Importacion en cola",
        description: message,
      });
      return true;
    }

    importAbortRef.current = null;
    setImportProgress(null);
    setStatusMessage(message);
    pushToast({
      tone: "success",
      title: "Plano cargado",
      description: message,
    });
    if (result.traceId && result.importedTables?.length) {
      setImportReview({
        traceId: result.traceId,
        eventoId: selectedEventId,
        eventoNombre: result.eventoNombre ?? panelData?.evento.nombre ?? "Evento",
        mesaIds: result.mesaIds ?? [],
        importedTables: result.importedTables,
      });
      setShowImportRejectActions(false);
    } else {
      setPlanFile(null);
      setPlanExpectedTableCount("");
      setPlanExpectedRowCount("");
      setPlanExpectedColumnCount("");
      setPlanExpectedChairTotal("");
    }
    scheduleImportRefreshes();
    return true;
  }

  async function handleImportPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedEventId || !planFile) {
      return;
    }

    await runPlanImport(planFile, {
      expectedTableCount: planExpectedTableCount,
      expectedRowCount: planExpectedRowCount,
      expectedColumnCount: planExpectedColumnCount,
      expectedChairTotal: planExpectedChairTotal,
    });
  }

  async function handleCancelImport() {
    if (!importProgress) {
      return;
    }

    const traceId = importProgress.traceId;
    setImportProgress((current) =>
      current
        ? {
            ...current,
            status: "cancel_requested",
            cancelling: true,
            summary:
              "Cancelando importacion. Espera a que el servidor llegue a un punto seguro para detenerla sin dejar cambios a medias.",
          }
        : current,
    );

    void fetch("/api/admin/mesas/import-plan/cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        keepalive: true,
        body: JSON.stringify({
          traceId,
        }),
      })
      .then(async (response) => {
        const result = await parseJsonResponse(response);

        if (!response.ok) {
          const message =
            result.error ??
            "No se pudo cancelar la importacion desde el servidor.";
          setError(message);
          pushToast({
            tone: "error",
            title: "Cancelacion no completada",
            description: message,
          });
          setImportProgress(null);
          scheduleImportRefreshes();
          return;
        }

        setStatusMessage(result.message ?? "Importacion cancelada correctamente.");
        pushToast({
          tone: "success",
          title: "Importacion cancelada",
          description:
            result.message ??
            "La importacion se ha cancelado y se han eliminado sus cambios.",
        });
        setImportProgress(null);
        scheduleImportRefreshes();
      })
      .catch(() => {
        setError(
          "No se pudo contactar con el servidor para cancelar. Si el proceso termina, revisa el plano y borralo desde la ventana de revision.",
        );
        pushToast({
          tone: "error",
          title: "Cancelacion no confirmada",
          description:
            "No se pudo contactar con el servidor para confirmar la cancelacion.",
        });
      });

    importAbortRef.current?.abort();
    importAbortRef.current = null;
    setImportProgress(null);
    setStatusMessage("Cancelacion enviada. Se limpiaran los cambios de esta importacion.");
    pushToast({
      tone: "success",
      title: "Cancelacion enviada",
      description:
        "La importacion se ha detenido en pantalla y el servidor limpiara cualquier cambio de esa carga.",
    });
    scheduleImportRefreshes();
  }

  async function handleImportReviewAction(
    action: "confirm" | "dismiss" | "delete_imported",
    options?: { retry?: boolean },
  ) {
    if (!importReview) {
      return;
    }

    await completeImportReviewAction(importReview, action, options);
  }

  async function completeImportReviewAction(
    review: ImportReviewState,
    action: "confirm" | "dismiss" | "delete_imported",
    options?: { retry?: boolean },
  ) {
    const response = await fetch("/api/admin/mesas/import-plan/review", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action,
        traceId: review.traceId,
        eventoId: review.eventoId,
        mesaIds: review.mesaIds,
      }),
    });

    const result = await parseJsonResponse(response);

    if (!response.ok) {
      const message = result.error ?? "No se pudo completar la revision del plano.";
      setError(message);
      pushToast({
        tone: "error",
        title: "Revision no completada",
        description: message,
      });
      return false;
    }

    const message = result.message ?? "Revision completada.";
    setStatusMessage(message);
    pushToast({
      tone: "success",
      title: "Revision completada",
      description: message,
    });

    if (action === "confirm" || action === "dismiss") {
      setPlanFile(null);
      setPlanExpectedTableCount("");
      setPlanExpectedRowCount("");
      setPlanExpectedColumnCount("");
      setPlanExpectedChairTotal("");
    }

    if (action === "delete_imported" && !options?.retry) {
      setPlanFile(null);
      setPlanExpectedTableCount("");
      setPlanExpectedRowCount("");
      setPlanExpectedColumnCount("");
      setPlanExpectedChairTotal("");
    }

    setImportReview(null);
    setShowImportRejectActions(false);
    setReimportDialogMode(null);
    scheduleImportRefreshes();
    return true;
  }

  function openReimportChoice() {
    setShowImportRejectActions(false);
    setReimportDialogMode("choice");
    setReimportFile(planFile);
    setReimportExpectedTableCount(planExpectedTableCount);
    setReimportExpectedRowCount(planExpectedRowCount);
    setReimportExpectedColumnCount(planExpectedColumnCount);
    setReimportExpectedChairTotal(planExpectedChairTotal);
  }

  async function handleReimportWithCurrentInputs() {
    if (!importReview || !planFile) {
      return;
    }

    const previousReview = importReview;
    const deleted = await completeImportReviewAction(previousReview, "delete_imported", {
      retry: true,
    });
    if (!deleted) {
      return;
    }
    await runPlanImport(planFile, {
      expectedTableCount: planExpectedTableCount,
      expectedRowCount: planExpectedRowCount,
      expectedColumnCount: planExpectedColumnCount,
      expectedChairTotal: planExpectedChairTotal,
    });
  }

  async function handleReimportWithChangedInputs(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!importReview || !reimportFile) {
      return;
    }

    const previousReview = importReview;
    setPlanFile(reimportFile);
    setPlanExpectedTableCount(reimportExpectedTableCount);
    setPlanExpectedRowCount(reimportExpectedRowCount);
    setPlanExpectedColumnCount(reimportExpectedColumnCount);
    setPlanExpectedChairTotal(reimportExpectedChairTotal);

    const deleted = await completeImportReviewAction(previousReview, "delete_imported", {
      retry: true,
    });
    if (!deleted) {
      return;
    }
    await runPlanImport(reimportFile, {
      expectedTableCount: reimportExpectedTableCount,
      expectedRowCount: reimportExpectedRowCount,
      expectedColumnCount: reimportExpectedColumnCount,
      expectedChairTotal: reimportExpectedChairTotal,
    });
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

  async function handleDeleteAllMesas() {
    if (!selectedEventId) {
      return;
    }

    await runAdminAction(
      "/api/admin/mesas/delete",
      {
        eventoId: selectedEventId,
        deleteAll: true,
      },
      "Todas las mesas eliminadas",
      () => {
        setMesaEditId("");
        setMesaSeleccionadaId("");
        setSillaEditId("");
        setSillaEditMesaId("");
        setSillaSeleccionadaId("");
      },
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
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-stone-200 bg-white px-4 py-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
                  Reservas especiales
                </p>
                <p className="mt-1 text-sm leading-6 text-stone-600">
                  Este numero indica cuantas personas han marcado alergias, celiaquia, movilidad reducida o han dejado observaciones.
                </p>
              </div>
              <div className="inline-flex items-center gap-3 rounded-full border border-rose-200 bg-rose-50 px-4 py-2">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-700">
                  Especiales
                </span>
                <span className="text-2xl font-semibold text-rose-700">
                  {reservasConAvisosCount}
                </span>
              </div>
            </div>
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
                eventName={panelData?.evento.nombre ?? "EVENTO"}
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
                    <button
                      type="button"
                      onClick={handleDeleteAllMesas}
                      disabled={!selectedEventId || isPending || (panelData?.evento.mesas.length ?? 0) === 0}
                      className="inline-flex items-center justify-center rounded-full border border-rose-400 bg-rose-50 px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-rose-800 transition hover:border-rose-600 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Borrar todas
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
                      label="Cuantas mesas crear"
                      hint="Puedes generar varias mesas seguidas de una sola vez."
                    >
                      <input
                        type="number"
                        min="1"
                        max="50"
                        value={mesaBatchQuantity}
                        onChange={(event) => setMesaBatchQuantity(event.target.value)}
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
                    {Number(mesaBatchQuantity) > 1 ? "Crear mesas" : "Crear mesa"}
                  </button>
                </form>
              </div>
            </AdminCard>
          </div>

          <div className="mt-6">
            <AdminCard
              eyebrow="Plano"
              title="Cargar plano de sala"
              description="Sube una imagen del plano para generar automaticamente la estructura del evento. Puedes añadir cifras esperadas para bloquear resultados incompletos o inconsistentes."
            >
              <form className="grid gap-4" onSubmit={handleImportPlan}>
                <AdminField
                  label="Archivo del plano"
                  hint="Usa una imagen clara donde se lean bien las etiquetas M:x y S:x de cada mesa."
                >
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp"
                    disabled={!selectedEventId || isPending}
                    onChange={(event) => {
                      setPlanFile(event.target.files?.[0] ?? null);
                    }}
                    className="block w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-700 file:mr-4 file:rounded-full file:border-0 file:bg-stone-950 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
                  />
                </AdminField>
                {planFile ? (
                  <p className="text-sm leading-6 text-stone-600">
                    Archivo preparado: <span className="font-semibold text-stone-900">{planFile.name}</span>
                  </p>
                ) : null}
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <AdminField
                    label="Mesas esperadas"
                    hint="Si no coincide, el sistema no importara el plano."
                  >
                    <input
                      type="number"
                      min="1"
                      inputMode="numeric"
                      value={planExpectedTableCount}
                      onChange={(event) => setPlanExpectedTableCount(event.target.value)}
                      disabled={!selectedEventId || isPending}
                      className={FieldInputClass(!selectedEventId || isPending)}
                      placeholder="Ej: 42"
                    />
                  </AdminField>
                  <AdminField
                    label="Filas esperadas"
                    hint="Sirve para validar la estructura general."
                  >
                    <input
                      type="number"
                      min="1"
                      inputMode="numeric"
                      value={planExpectedRowCount}
                      onChange={(event) => setPlanExpectedRowCount(event.target.value)}
                      disabled={!selectedEventId || isPending}
                      className={FieldInputClass(!selectedEventId || isPending)}
                      placeholder="Ej: 7"
                    />
                  </AdminField>
                  <AdminField
                    label="Columnas esperadas"
                    hint="Ayuda a detectar una malla colocada mal."
                  >
                    <input
                      type="number"
                      min="1"
                      inputMode="numeric"
                      value={planExpectedColumnCount}
                      onChange={(event) => setPlanExpectedColumnCount(event.target.value)}
                      disabled={!selectedEventId || isPending}
                      className={FieldInputClass(!selectedEventId || isPending)}
                      placeholder="Ej: 6"
                    />
                  </AdminField>
                  <AdminField
                    label="Sillas totales"
                    hint="Valida la suma final de sillas del plano."
                  >
                    <input
                      type="number"
                      min="1"
                      inputMode="numeric"
                      value={planExpectedChairTotal}
                      onChange={(event) => setPlanExpectedChairTotal(event.target.value)}
                      disabled={!selectedEventId || isPending}
                      className={FieldInputClass(!selectedEventId || isPending)}
                      placeholder="Ej: 302"
                    />
                  </AdminField>
                </div>
                <div className="rounded-3xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-900">
                  Sugerencia: para minimizar errores usa una imagen nitida y procura que cada mesa muestre claramente bloques tipo M:4 y justo debajo S:10.
                </div>
                <button
                  type="submit"
                  disabled={!selectedEventId || !planFile || isPending}
                  className="inline-flex items-center justify-center rounded-full bg-stone-950 px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-stone-400"
                >
                  Cargar plano
                </button>
              </form>
            </AdminCard>
          </div>
        </AdminSection>
      </div>

      {importProgress ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-stone-950/55 p-4 backdrop-blur-sm">
          <div className="w-full max-w-3xl rounded-[32px] border border-stone-200 bg-white px-6 py-6 shadow-[0_30px_120px_rgba(28,25,23,0.28)]">
            <div className="flex flex-col items-center text-center">
              <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-700">
                Importando plano
              </p>
              <div className="mt-6 h-14 w-14 animate-spin rounded-full border-4 border-stone-200 border-t-amber-700" />
              <p className="mt-5 max-w-2xl text-sm leading-7 text-stone-600">
                {importProgress.summary ??
                  "El importador esta procesando la imagen, leyendo mesas y sillas y validando el resultado antes de guardarlo."}
              </p>
              <button
                type="button"
                onClick={handleCancelImport}
                disabled={importProgress.cancelling}
                className="mt-6 inline-flex items-center justify-center rounded-full border border-rose-300 bg-white px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-rose-700 transition hover:border-rose-500 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {importProgress.cancelling ? "Cancelando importacion..." : "Cancelar importacion"}
              </button>
            </div>

            <div className="mt-8 rounded-[28px] border border-stone-200 bg-stone-50">
              <button
                type="button"
                onClick={() =>
                  setImportProgress((current) =>
                    current ? { ...current, expanded: !current.expanded } : current,
                  )
                }
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
              >
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-700">
                    Log del importador
                  </p>
                  <p className="mt-1 text-sm leading-6 text-stone-500">
                    Sigue en tiempo real lo que esta haciendo el importador para ver si avanza o si se ha quedado bloqueado.
                  </p>
                </div>
                <span className="rounded-full border border-stone-300 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-600">
                  {importProgress.expanded ? "Ocultar" : "Mostrar"}
                </span>
              </button>

              {importProgress.expanded ? (
                <div className="border-t border-stone-200 px-5 py-4">
                  <div className="max-h-[320px] overflow-y-auto rounded-3xl bg-stone-950 px-4 py-4 font-mono text-xs leading-6 text-emerald-300">
                    {importProgress.logs.length > 0 ? (
                      importProgress.logs.map((entry) => (
                        <p key={entry.id} className="whitespace-pre-wrap break-words">
                          {formatImportLogEntry(entry)}
                        </p>
                      ))
                    ) : (
                      <p className="text-stone-300">
                        Esperando los primeros mensajes del importador...
                      </p>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {importReview && importReviewPreviewEvent ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/55 p-4 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-[32px] border border-stone-200 bg-white shadow-[0_30px_120px_rgba(28,25,23,0.28)]">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-stone-200 px-6 py-5">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-700">
                  Revision del plano
                </p>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight text-stone-950">
                  Comprueba si la importacion ha quedado correcta
                </h2>
                <p className="mt-2 text-sm leading-7 text-stone-600">
                  Revisa el plano en 2D o 3D, confirma si ha quedado bien y, si no, decide si quieres dejarlo, borrarlo o borrar y reintentar.
                </p>
              </div>
              <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
                <p className="font-semibold text-stone-900">{importReview.eventoNombre}</p>
                <p className="mt-1">
                  {importReview.importedTables.length} mesas y{" "}
                  {importReview.importedTables.reduce(
                    (sum, table) => sum + table.chairCount,
                    0,
                  )}{" "}
                  sillas
                </p>
              </div>
            </div>

            <div className="grid flex-1 gap-0 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="flex min-h-[520px] flex-col border-b border-stone-200 xl:border-b-0 xl:border-r">
                <DinnerRoomScene
                  evento={importReviewPreviewEvent}
                  selectedSillaId={null}
                  currentAsistenteId=""
                  selectionLocked
                  onSelectSilla={() => {}}
                />

                <div className="border-t border-stone-200 bg-stone-50 px-5 py-5">
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-600">
                    Confirmacion
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => handleImportReviewAction("confirm")}
                      className="inline-flex items-center justify-center rounded-full bg-stone-950 px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-amber-700"
                    >
                      Si, esta correcto
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowImportRejectActions((current) => !current)}
                      className="inline-flex items-center justify-center rounded-full border border-rose-300 bg-white px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-rose-700 transition hover:border-rose-500 hover:bg-rose-50"
                    >
                      No
                    </button>
                  </div>
                </div>
              </div>

              <div className="min-h-0 px-6 py-5">
                <details className="flex h-full min-h-0 flex-col overflow-hidden rounded-3xl border border-stone-200 bg-stone-50" open>
                  <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold uppercase tracking-[0.18em] text-stone-700">
                    Mesas y sillas importadas
                  </summary>
                  <div className="grid max-h-[calc(92vh-280px)] gap-3 overflow-y-auto border-t border-stone-200 px-5 py-4 pb-8">
                    {importReview.importedTables
                      .slice()
                      .sort((a, b) => a.numero - b.numero)
                      .map((table) => (
                        <div
                          key={`review-${table.numero}`}
                          className="rounded-2xl border border-stone-200 bg-white px-4 py-3"
                        >
                          <p className="text-sm font-semibold text-stone-900">
                            Mesa {table.numero}
                          </p>
                          <p className="mt-1 text-sm leading-6 text-stone-600">
                            Sillas: {table.chairCount}
                          </p>
                        </div>
                      ))}
                  </div>
                </details>
              </div>
            </div>
          </div>

          {showImportRejectActions ? (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-stone-950/35 px-4 py-6 backdrop-blur-[2px]">
              <div className="w-full max-w-xl rounded-[28px] border border-stone-200 bg-white px-6 py-6 shadow-[0_24px_90px_rgba(28,25,23,0.25)]">
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-rose-700">
                  El plano no ha quedado bien
                </p>
                <h3 className="mt-3 text-2xl font-semibold tracking-tight text-stone-950">
                  Que quieres hacer con esta importacion
                </h3>
                <p className="mt-3 text-sm leading-7 text-stone-600">
                  Puedes mantener el plano tal cual, borrarlo por completo o borrarlo y volver a intentarlo con otra importacion.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => handleImportReviewAction("dismiss")}
                    className="inline-flex items-center justify-center rounded-full border border-stone-300 bg-white px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
                  >
                    Dejar el plano asi
                  </button>
                  <button
                    type="button"
                    onClick={() => handleImportReviewAction("delete_imported")}
                    className="inline-flex items-center justify-center rounded-full border border-rose-300 bg-white px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-rose-700 transition hover:border-rose-500 hover:bg-rose-50"
                  >
                    Borrar
                  </button>
                  <button
                    type="button"
                    onClick={openReimportChoice}
                    className="inline-flex items-center justify-center rounded-full bg-amber-700 px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-amber-800"
                  >
                    Borrar y reintentar
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowImportRejectActions(false)}
                    className="inline-flex items-center justify-center rounded-full border border-stone-200 bg-stone-50 px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-stone-600 transition hover:border-stone-300 hover:bg-stone-100 hover:text-stone-900"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {reimportDialogMode === "choice" ? (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-stone-950/35 px-4 py-6 backdrop-blur-[2px]">
              <div className="w-full max-w-lg rounded-[28px] border border-stone-200 bg-white px-6 py-6 shadow-[0_24px_90px_rgba(28,25,23,0.25)]">
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-amber-700">
                  Reintentar importacion
                </p>
                <h3 className="mt-3 text-2xl font-semibold tracking-tight text-stone-950">
                  Como quieres reimportar el plano
                </h3>
                <p className="mt-3 text-sm leading-7 text-stone-600">
                  Primero se borrara esta importacion y despues volvera a lanzarse el importador. Al terminar, volvera a salir la revision.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleReimportWithCurrentInputs}
                    disabled={!planFile}
                    className="inline-flex items-center justify-center rounded-full bg-stone-950 px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-stone-400"
                  >
                    Continuar
                  </button>
                  <button
                    type="button"
                    onClick={() => setReimportDialogMode("params")}
                    className="inline-flex items-center justify-center rounded-full border border-stone-300 bg-white px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
                  >
                    Cambiar parametros
                  </button>
                  <button
                    type="button"
                    onClick={() => setReimportDialogMode(null)}
                    className="inline-flex items-center justify-center rounded-full border border-stone-200 bg-stone-50 px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-stone-600 transition hover:border-stone-300 hover:bg-stone-100 hover:text-stone-900"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {reimportDialogMode === "params" ? (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-stone-950/35 px-4 py-6 backdrop-blur-[2px]">
              <form
                className="w-full max-w-2xl rounded-[28px] border border-stone-200 bg-white px-6 py-6 shadow-[0_24px_90px_rgba(28,25,23,0.25)]"
                onSubmit={handleReimportWithChangedInputs}
              >
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-amber-700">
                  Nuevos parametros
                </p>
                <h3 className="mt-3 text-2xl font-semibold tracking-tight text-stone-950">
                  Ajusta la reimportacion
                </h3>
                <div className="mt-6 grid gap-4">
                  <AdminField label="Archivo del plano">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp"
                      onChange={(event) => {
                        setReimportFile(event.target.files?.[0] ?? reimportFile);
                      }}
                      className="block w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-700 file:mr-4 file:rounded-full file:border-0 file:bg-stone-950 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
                    />
                  </AdminField>
                  {reimportFile ? (
                    <p className="text-sm leading-6 text-stone-600">
                      Archivo preparado:{" "}
                      <span className="font-semibold text-stone-900">
                        {reimportFile.name}
                      </span>
                    </p>
                  ) : null}
                  <div className="grid gap-4 md:grid-cols-2">
                    <AdminField label="Mesas esperadas">
                      <input
                        type="number"
                        min="1"
                        inputMode="numeric"
                        value={reimportExpectedTableCount}
                        onChange={(event) => setReimportExpectedTableCount(event.target.value)}
                        className={FieldInputClass()}
                      />
                    </AdminField>
                    <AdminField label="Filas esperadas">
                      <input
                        type="number"
                        min="1"
                        inputMode="numeric"
                        value={reimportExpectedRowCount}
                        onChange={(event) => setReimportExpectedRowCount(event.target.value)}
                        className={FieldInputClass()}
                      />
                    </AdminField>
                    <AdminField label="Columnas esperadas">
                      <input
                        type="number"
                        min="1"
                        inputMode="numeric"
                        value={reimportExpectedColumnCount}
                        onChange={(event) => setReimportExpectedColumnCount(event.target.value)}
                        className={FieldInputClass()}
                      />
                    </AdminField>
                    <AdminField label="Sillas totales">
                      <input
                        type="number"
                        min="1"
                        inputMode="numeric"
                        value={reimportExpectedChairTotal}
                        onChange={(event) => setReimportExpectedChairTotal(event.target.value)}
                        className={FieldInputClass()}
                      />
                    </AdminField>
                  </div>
                </div>
                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    type="submit"
                    disabled={!reimportFile}
                    className="inline-flex items-center justify-center rounded-full bg-stone-950 px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-stone-400"
                  >
                    Reimportar
                  </button>
                  <button
                    type="button"
                    onClick={() => setReimportDialogMode("choice")}
                    className="inline-flex items-center justify-center rounded-full border border-stone-300 bg-white px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
                  >
                    Volver
                  </button>
                </div>
              </form>
            </div>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
