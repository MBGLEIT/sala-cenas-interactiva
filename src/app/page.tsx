"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import {
  ChangeEvent,
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import ToastStack, { ToastItem } from "@/components/toast-stack";
import {
  AsistenteEncontrado,
  EVENTO_SALA_SELECT,
  EventoQueryResult,
  EventoSala,
  ReservaActual,
  RealtimeReservaPayload,
  applyOptimisticReservation,
  findReservaActual,
  findSelectedChairDetails,
  normalizeEventoSala,
} from "@/lib/dinner-room";
import { supabase } from "@/lib/supabase";

const DinnerRoomScene = dynamic(
  () => import("@/components/dinner-room-scene"),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-[28px] border border-stone-200 bg-stone-50 px-6 py-10 text-stone-500">
        Preparando la sala...
      </div>
    ),
  },
);

const DinnerRoomSceneLegacy = dynamic(
  () => import("@/components/dinner-room-scene-legacy"),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-[28px] border border-stone-200 bg-stone-50 px-6 py-10 text-stone-500">
        Preparando la sala...
      </div>
    ),
  },
);

type AccessMode = "presencial" | "movil" | null;
type PublicScreen =
  | "home"
  | "movil-identify"
  | "movil-ready"
  | "presencial-wait"
  | "presencial-manual"
  | "room";

type IdentityCandidate = {
  asistente: AsistenteEncontrado;
  evento: EventoSala;
};

type ExistingReservationPrompt = {
  asistente: AsistenteEncontrado;
  evento: EventoSala;
  reserva: ReservaActual;
};

function isMobileOrTabletDevice() {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return false;
  }

  const userAgent = navigator.userAgent.toLowerCase();
  const matchesMobileAgent =
    /android|iphone|ipad|ipod|mobile|tablet|silk|kindle|playbook/.test(userAgent);
  const isIPadDesktopMode =
    navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  const hasCoarsePointer =
    window.matchMedia?.("(pointer: coarse)")?.matches ||
    window.matchMedia?.("(any-pointer: coarse)")?.matches ||
    false;
  const shortestSide = Math.min(window.innerWidth, window.innerHeight);
  const looksLikeTabletOrPhoneViewport = shortestSide <= 1024;

  return (
    matchesMobileAgent ||
    isIPadDesktopMode ||
    (hasCoarsePointer && navigator.maxTouchPoints > 1 && looksLikeTabletOrPhoneViewport)
  );
}

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

  return normalizeEventoSala(data as unknown as EventoQueryResult);
}

function StatBadge({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "warning";
}) {
  const toneClassName =
    tone === "success"
      ? "bg-emerald-100 text-emerald-700"
      : tone === "warning"
        ? "bg-amber-100 text-amber-700"
        : "bg-stone-200 text-stone-700";

  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${toneClassName}`}
    >
      {label}: {value}
    </span>
  );
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

function ScreenCard({
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
    <div className="mx-auto max-w-3xl rounded-[36px] border border-stone-200 bg-white px-8 py-10 shadow-[0_20px_70px_rgba(28,25,23,0.12)] sm:px-10">
      <p className="text-sm font-semibold uppercase tracking-[0.35em] text-amber-700">
        {eyebrow}
      </p>
      <h1 className="mt-5 text-4xl font-semibold tracking-tight text-stone-950">
        {title}
      </h1>
      <p className="mt-5 text-lg leading-8 text-stone-600">{description}</p>
      <div className="mt-10">{children}</div>
    </div>
  );
}

function ModeButton({
  title,
  description,
  onClick,
}: {
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group rounded-[32px] border border-stone-200 bg-white px-8 py-8 text-left shadow-[0_20px_50px_rgba(28,25,23,0.08)] transition hover:-translate-y-0.5 hover:border-stone-950 hover:shadow-[0_26px_60px_rgba(28,25,23,0.14)]"
    >
      <p className="text-2xl font-semibold tracking-tight text-stone-950 transition group-hover:text-amber-700">
        {title}
      </p>
      <p className="mt-3 text-base leading-7 text-stone-600">{description}</p>
    </button>
  );
}

function IdentityCodeForm({
  identificador,
  onChange,
  onSubmit,
  submitLabel,
  busy,
}: {
  identificador: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitLabel: string;
  busy: boolean;
}) {
  return (
    <form className="space-y-4" onSubmit={onSubmit}>
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
        onChange={(event) => onChange(event.target.value.toUpperCase())}
        placeholder="Pon aqui tu codigo de asistente"
        className="w-full rounded-3xl border border-stone-300 bg-stone-50 px-5 py-5 text-xl font-medium uppercase tracking-[0.15em] text-stone-900 outline-none transition focus:border-amber-500 focus:bg-white"
      />
      <button
        type="submit"
        disabled={busy}
        className="inline-flex min-h-14 min-w-[220px] items-center justify-center rounded-full bg-stone-950 px-6 py-4 text-sm font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-stone-400"
      >
        {busy ? "Identificando..." : submitLabel}
      </button>
    </form>
  );
}

const VIRTUAL_KEYBOARD_ROWS = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Z", "X", "C", "V", "B", "N", "M"],
] as const;

function VirtualKeyboard({
  onKeyPress,
  onBackspace,
  onClear,
}: {
  onKeyPress: (value: string) => void;
  onBackspace: () => void;
  onClear: () => void;
}) {
  return (
    <div className="mt-8 rounded-[32px] border border-stone-200 bg-stone-50 p-4 shadow-sm">
      <p className="px-2 text-sm font-semibold uppercase tracking-[0.2em] text-stone-500">
        Teclado virtual
      </p>
      <div className="mt-4 space-y-3">
        {VIRTUAL_KEYBOARD_ROWS.map((row, rowIndex) => (
          <div key={rowIndex} className="flex flex-wrap justify-center gap-2">
            {row.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => onKeyPress(key)}
                className="inline-flex min-h-14 min-w-[3.4rem] items-center justify-center rounded-2xl border border-stone-300 bg-white px-4 py-3 text-lg font-semibold uppercase text-stone-900 transition hover:border-amber-500 hover:text-amber-700"
              >
                {key}
              </button>
            ))}
          </div>
        ))}
        <div className="flex flex-wrap justify-center gap-3 pt-1">
          <button
            type="button"
            onClick={onBackspace}
            className="inline-flex min-h-14 min-w-[8.5rem] items-center justify-center rounded-2xl border border-stone-300 bg-white px-5 py-3 text-sm font-semibold uppercase tracking-[0.12em] text-stone-800 transition hover:border-amber-500 hover:text-amber-700"
          >
            Borrar
          </button>
          <button
            type="button"
            onClick={onClear}
            className="inline-flex min-h-14 min-w-[8.5rem] items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 px-5 py-3 text-sm font-semibold uppercase tracking-[0.12em] text-rose-700 transition hover:border-rose-400 hover:bg-rose-100"
          >
            Limpiar
          </button>
        </div>
      </div>
    </div>
  );
}

function InlineMessage({
  tone,
  title,
  message,
}: {
  tone: "error" | "success" | "info";
  title: string;
  message: string;
}) {
  const className =
    tone === "error"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : tone === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : "border-amber-200 bg-amber-50 text-amber-800";

  return (
    <div className={`rounded-3xl border px-5 py-4 ${className}`}>
      <p className="text-sm font-semibold uppercase tracking-[0.2em]">{title}</p>
      <p className="mt-2 text-base leading-7">{message}</p>
    </div>
  );
}

function OverlayModal({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="pointer-events-auto absolute inset-0 overflow-y-auto bg-stone-950/45 px-3 py-4 backdrop-blur-sm sm:flex sm:items-center sm:justify-center sm:px-4 sm:py-6">
      <div className="mx-auto max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto rounded-[32px] border border-stone-200 bg-white p-5 shadow-[0_24px_80px_rgba(28,25,23,0.22)] sm:max-h-[calc(100dvh-3rem)] sm:p-8">
        <h3 className="text-3xl font-semibold tracking-tight text-stone-950">{title}</h3>
        {description ? (
          <p className="mt-3 text-base leading-7 text-stone-600">{description}</p>
        ) : null}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

function ReservationChecklist({
  esCeliaco,
  setEsCeliaco,
  tieneAlergias,
  setTieneAlergias,
  movilidadReducida,
  setMovilidadReducida,
  observacionesReserva,
  setObservacionesReserva,
}: {
  esCeliaco: boolean;
  setEsCeliaco: (value: boolean) => void;
  tieneAlergias: boolean;
  setTieneAlergias: (value: boolean) => void;
  movilidadReducida: boolean;
  setMovilidadReducida: (value: boolean) => void;
  observacionesReserva: string;
  setObservacionesReserva: (value: string) => void;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-3">
        <label className="flex min-h-16 items-center gap-3 rounded-2xl border border-amber-300 bg-white px-4 py-3 text-base font-medium text-stone-800">
          <input
            type="checkbox"
            checked={esCeliaco}
            onChange={(event) => setEsCeliaco(event.target.checked)}
            className="h-5 w-5 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
          />
          Es celiaco
        </label>
        <label className="flex min-h-16 items-center gap-3 rounded-2xl border border-amber-300 bg-white px-4 py-3 text-base font-medium text-stone-800">
          <input
            type="checkbox"
            checked={tieneAlergias}
            onChange={(event) => setTieneAlergias(event.target.checked)}
            className="h-5 w-5 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
          />
          Tiene alergias
        </label>
        <label className="flex min-h-16 items-center gap-3 rounded-2xl border border-amber-300 bg-white px-4 py-3 text-base font-medium text-stone-800">
          <input
            type="checkbox"
            checked={movilidadReducida}
            onChange={(event) => setMovilidadReducida(event.target.checked)}
            className="h-5 w-5 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
          />
          Movilidad reducida
        </label>
      </div>

      <label className="block">
        <span className="text-sm font-semibold uppercase tracking-[0.16em] text-stone-500">
          Observaciones relevantes
        </span>
        <textarea
          value={observacionesReserva}
          onChange={(event) => setObservacionesReserva(event.target.value)}
          placeholder="Ejemplo: alergia a frutos secos, sin lactosa o necesita acceso facil."
          rows={4}
          className="mt-2 w-full rounded-2xl border border-stone-300 bg-stone-50 px-4 py-4 text-base text-stone-900 outline-none transition focus:border-amber-500 focus:bg-white"
        />
      </label>
    </div>
  );
}

export default function Home() {
  const [screen, setScreen] = useState<PublicScreen>("home");
  const [accessMode, setAccessMode] = useState<AccessMode>(null);
  const [identificador, setIdentificador] = useState("");
  const [scannerValue, setScannerValue] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [roomLoading, setRoomLoading] = useState(false);
  const [reservationLoading, setReservationLoading] = useState(false);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [error, setError] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [showManualFallback, setShowManualFallback] = useState(false);
  const [asistente, setAsistente] = useState<AsistenteEncontrado | null>(null);
  const [evento, setEvento] = useState<EventoSala | null>(null);
  const [identityCandidate, setIdentityCandidate] = useState<IdentityCandidate | null>(null);
  const [existingReservationPrompt, setExistingReservationPrompt] =
    useState<ExistingReservationPrompt | null>(null);
  const [selectedSillaId, setSelectedSillaId] = useState<string | null>(null);
  const [showReservationSummary, setShowReservationSummary] = useState(false);
  const [showReservationQuestionnaire, setShowReservationQuestionnaire] = useState(false);
  const [esCeliaco, setEsCeliaco] = useState(false);
  const [tieneAlergias, setTieneAlergias] = useState(false);
  const [movilidadReducida, setMovilidadReducida] = useState(false);
  const [observacionesReserva, setObservacionesReserva] = useState("");
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [isMobileTablet, setIsMobileTablet] = useState(false);
  const [isLandscapeViewport, setIsLandscapeViewport] = useState(true);
  const [mobileOverlayExpanded, setMobileOverlayExpanded] = useState(false);
  const scannerInputRef = useRef<HTMLInputElement>(null);
  const scannerProcessingRef = useRef(false);
  const scannerStartedAtRef = useRef(0);
  const scannerLastInputAtRef = useRef(0);
  const scannerPreviousValueRef = useRef("");
  const selectedSillaIdRef = useRef<string | null>(null);
  const asistenteIdRef = useRef<string | null>(null);
  const desktopReservationPanelRef = useRef<HTMLDivElement>(null);

  const requestPresencialFullscreen = useCallback(() => {
    if (typeof document === "undefined" || document.fullscreenElement) {
      return;
    }

    void document.documentElement.requestFullscreen().catch(() => undefined);
  }, []);

  const exitFullscreenIfActive = useCallback(() => {
    if (typeof document === "undefined" || !document.fullscreenElement) {
      return;
    }

    void document.exitFullscreen().catch(() => undefined);
  }, []);

  const requestLandscapeOrientation = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    const orientationApi = window.screen?.orientation as
      | (ScreenOrientation & {
          lock?: (orientation: "landscape" | "portrait") => Promise<void>;
        })
      | undefined;

    if (!orientationApi?.lock) {
      return;
    }

    void orientationApi.lock("landscape").catch(() => undefined);
  }, []);

  const focusScannerInput = useCallback(() => {
    try {
      scannerInputRef.current?.focus();
    } catch {
      // Ignore focus failures on kiosk browsers.
    }
  }, []);

  const resetScannerCapture = useCallback(() => {
    scannerStartedAtRef.current = 0;
    scannerLastInputAtRef.current = 0;
    scannerPreviousValueRef.current = "";
    setScannerValue("");
  }, []);

  const handleScannerInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextValue = event.target.value.toUpperCase().replace(/\s+/g, "");
      const previousValue = scannerPreviousValueRef.current;
      const now = Date.now();

      if (!nextValue) {
        resetScannerCapture();
        return;
      }

      if (
        !previousValue ||
        !nextValue.startsWith(previousValue) ||
        nextValue.length <= previousValue.length
      ) {
        scannerStartedAtRef.current = now;
      }

      scannerLastInputAtRef.current = now;
      scannerPreviousValueRef.current = nextValue;
      setScannerValue(nextValue);
    },
    [resetScannerCapture],
  );

  const reservaActual = useMemo(
    () => findReservaActual(evento, asistente?.id ?? null),
    [evento, asistente?.id],
  );
  const seleccionActual = useMemo(
    () => findSelectedChairDetails(evento, selectedSillaId),
    [evento, selectedSillaId],
  );
  const useTouchMobileFlow = accessMode === "movil" && isMobileTablet;
  const canConfirmSelection =
    Boolean(selectedSillaId && asistente && !reservationLoading && !reservaActual);

  useEffect(() => {
    setIsMobileTablet(isMobileOrTabletDevice());
  }, []);

  useEffect(() => {
    const updateOrientation = () => {
      if (typeof window === "undefined") {
        return;
      }

      setIsLandscapeViewport(window.innerWidth >= window.innerHeight);
    };

    updateOrientation();
    window.addEventListener("resize", updateOrientation);
    window.addEventListener("orientationchange", updateOrientation);

    return () => {
      window.removeEventListener("resize", updateOrientation);
      window.removeEventListener("orientationchange", updateOrientation);
    };
  }, []);

  useEffect(() => {
    if (!useTouchMobileFlow) {
      setMobileOverlayExpanded(false);
    }
  }, [useTouchMobileFlow, screen, evento?.id, asistente?.id]);

  useEffect(() => {
    if (
      accessMode !== "movil" ||
      useTouchMobileFlow ||
      !selectedSillaId ||
      !desktopReservationPanelRef.current
    ) {
      return;
    }

    desktopReservationPanelRef.current.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [accessMode, selectedSillaId, useTouchMobileFlow]);

  function dismissToast(id: string) {
    setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== id));
  }

  const pushToast = useCallback((toast: Omit<ToastItem, "id">) => {
    const id = `${toast.tone}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((currentToasts) => [...currentToasts.slice(-2), { id, ...toast }]);
  }, []);

  function resetReservationForm() {
    setSelectedSillaId(null);
    setShowReservationSummary(false);
    setShowReservationQuestionnaire(false);
    setEsCeliaco(false);
    setTieneAlergias(false);
    setMovilidadReducida(false);
    setObservacionesReserva("");
  }

  function clearSessionState() {
    setAsistente(null);
    setEvento(null);
    setIdentityCandidate(null);
    setExistingReservationPrompt(null);
    setRealtimeConnected(false);
    resetReservationForm();
  }

  function goHome() {
    exitFullscreenIfActive();
    setAccessMode(null);
    setScreen("home");
    setError("");
    setInfoMessage("");
    setIdentificador("");
    resetScannerCapture();
    setShowManualFallback(false);
    clearSessionState();
  }

  function goToPresencialWait(message?: unknown) {
    requestPresencialFullscreen();
    setAccessMode("presencial");
    setScreen("presencial-wait");
    setError("");
    setInfoMessage(typeof message === "string" ? message : "");
    setIdentificador("");
    resetScannerCapture();
    setShowManualFallback(false);
    clearSessionState();
  }

  function goToMovilIdentify() {
    setAccessMode("movil");
    setScreen("movil-identify");
    setError("");
    setInfoMessage("");
    setIdentificador("");
    resetScannerCapture();
    setShowManualFallback(false);
    clearSessionState();
  }

  function resetMobileFlow() {
    exitFullscreenIfActive();
    setScreen("movil-identify");
    setError("");
    setInfoMessage("");
    setIdentificador("");
    clearSessionState();
  }

  function enterMobileTouchPreparation() {
    setScreen("movil-ready");
    setInfoMessage("Activa la pantalla completa para continuar con la reserva.");
  }

  function enterMobileTouchRoom() {
    requestPresencialFullscreen();
    requestLandscapeOrientation();

    if (isLandscapeViewport) {
      setScreen("room");
      setInfoMessage("Asistente identificado correctamente.");
    }
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
      window.setTimeout(() => dismissToast(toast.id), 5200),
    );

    return () => {
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [toasts]);

  useEffect(() => {
    if (screen !== "room" || !useTouchMobileFlow) {
      return;
    }

    requestPresencialFullscreen();
    requestLandscapeOrientation();
  }, [requestLandscapeOrientation, requestPresencialFullscreen, screen, useTouchMobileFlow]);

  useEffect(() => {
    if (
      screen !== "movil-ready" ||
      !useTouchMobileFlow ||
      !isLandscapeViewport ||
      typeof document === "undefined" ||
      !document.fullscreenElement
    ) {
      return;
    }

    setScreen("room");
    setInfoMessage("Asistente identificado correctamente.");
  }, [isLandscapeViewport, screen, useTouchMobileFlow]);

  useEffect(() => {
    if (screen !== "presencial-wait") {
      return;
    }

    const keepScannerReady = () => {
      focusScannerInput();
      requestPresencialFullscreen();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        keepScannerReady();
      }
    };

    const frameId = window.requestAnimationFrame(keepScannerReady);
    const timeoutId = window.setTimeout(keepScannerReady, 180);
    const intervalId = window.setInterval(keepScannerReady, 1200);
    window.addEventListener("focus", keepScannerReady);
    window.addEventListener("pointerdown", keepScannerReady);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("fullscreenchange", keepScannerReady);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
      window.removeEventListener("focus", keepScannerReady);
      window.removeEventListener("pointerdown", keepScannerReady);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("fullscreenchange", keepScannerReady);
    };
  }, [focusScannerInput, requestPresencialFullscreen, screen]);

  useEffect(() => {
    if (!selectedSillaId) {
      setShowReservationSummary(false);
      setShowReservationQuestionnaire(false);
    }
  }, [selectedSillaId]);

  async function cargarEvento(eventoId: string, options?: { silent?: boolean }) {
    if (!options?.silent) {
      setRoomLoading(true);
    }

    try {
      const eventoActualizado = await fetchEventoSala(eventoId);
      setEvento(eventoActualizado);
      return eventoActualizado;
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
        { event: "*", schema: "public", table: "reservas" },
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
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "mesas", filter: `evento_id=eq.${evento.id}` },
        async () => {
          try {
            const eventoActualizado = await fetchEventoSala(evento.id);
            setEvento(eventoActualizado);
          } catch {
            setError("No se pudo actualizar la sala en este momento.");
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sillas" },
        async () => {
          try {
            const eventoActualizado = await fetchEventoSala(evento.id);
            setEvento(eventoActualizado);
          } catch {
            setError("No se pudo actualizar la sala en este momento.");
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "eventos", filter: `id=eq.${evento.id}` },
        async () => {
          try {
            const eventoActualizado = await fetchEventoSala(evento.id);
            setEvento(eventoActualizado);
          } catch {
            setError("Este evento ya no esta disponible.");
            setEvento(null);
            setSelectedSillaId(null);
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
  }, [evento?.id, asistente?.id, pushToast]);

  const identifyAssistantByIdentifier = useCallback(async (
    rawIdentifier: string,
    mode: "presencial" | "movil",
    lookupSource: "identificador" | "codigo" = "identificador",
  ) => {
    const cleanIdentifier = rawIdentifier.trim().toUpperCase();

    if (!cleanIdentifier) {
      setError("Escribe un identificador valido para continuar.");
      pushToast({
        tone: "error",
        title: "Falta el identificador",
        description: "Necesitamos el codigo del asistente para continuar.",
      });
      return;
    }

    setLookupLoading(true);
    setRoomLoading(false);
    setError("");
    setInfoMessage("");
    setIdentityCandidate(null);
    setExistingReservationPrompt(null);

    try {
      const searchQuery =
        lookupSource === "codigo"
          ? `codigo=${encodeURIComponent(cleanIdentifier)}`
          : `identificador=${encodeURIComponent(cleanIdentifier)}`;
      const response = await fetch(
        `/api/asistentes?${searchQuery}&ts=${Date.now()}`,
        { cache: "no-store" },
      );

      const result = (await response.json()) as {
        error?: string;
        asistente?: AsistenteEncontrado;
      };

      if (!response.ok || !result.asistente) {
        const message = result.error ?? "No se ha podido comprobar el identificador.";
        setError(message);
        setShowManualFallback(mode === "presencial");
        pushToast({
          tone: "error",
          title: "Asistente no encontrado",
          description: message,
        });
        return;
      }

      const eventoCargado = await cargarEvento(result.asistente.evento_id);
      const reservaActualDetectada = findReservaActual(eventoCargado, result.asistente.id);

      if (mode === "presencial") {
        if (reservaActualDetectada) {
          setExistingReservationPrompt({
            asistente: result.asistente,
            evento: eventoCargado,
            reserva: reservaActualDetectada,
          });
          setShowManualFallback(false);
          setInfoMessage("Este asistente ya tiene una reserva activa.");
        } else {
          setIdentityCandidate({
            asistente: result.asistente,
            evento: eventoCargado,
          });
          setShowManualFallback(false);
          setInfoMessage("Asistente encontrado. Confirma la identidad antes de continuar.");
        }
      } else {
        setAsistente(result.asistente);
        setEvento(eventoCargado);
        setScreen("room");
        setInfoMessage("Asistente identificado correctamente.");
      }

      pushToast({
        tone: "success",
        title: "Acceso correcto",
        description: `${result.asistente.nombre} puede continuar.`,
      });
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : "Ha ocurrido un problema de conexion.";

      setError(message);
      setShowManualFallback(mode === "presencial");
      pushToast({
        tone: "error",
        title: "No se pudo continuar",
        description: message,
      });
    } finally {
      setLookupLoading(false);
      if (mode === "presencial" && lookupSource === "codigo") {
        resetScannerCapture();
        window.setTimeout(() => {
          try {
            scannerInputRef.current?.focus();
          } catch {
            // Ignore focus failures on kiosk browsers.
          }
        }, 60);
      }
    }
  }, [pushToast, resetScannerCapture]);

  async function handleMobileIdentifySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const identificadorLimpio = identificador.trim().toUpperCase();
    const shouldUseTouchRoomFlow = isMobileTablet || isMobileOrTabletDevice();

    if (!identificadorLimpio) {
      resetMobileFlow();
      setError("Escribe tu identificador para continuar.");
      pushToast({
        tone: "error",
        title: "Falta el identificador",
        description: "Escribe el codigo del asistente para continuar.",
      });
      return;
    }

    if (shouldUseTouchRoomFlow) {
      setIsMobileTablet(true);
      requestPresencialFullscreen();
      requestLandscapeOrientation();
    }

    setLookupLoading(true);
    setError("");
    setInfoMessage("");
    setAsistente(null);
    setEvento(null);
    setSelectedSillaId(null);
    setEsCeliaco(false);
    setTieneAlergias(false);
    setMovilidadReducida(false);
    setObservacionesReserva("");

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
      if (shouldUseTouchRoomFlow) {
        enterMobileTouchPreparation();
      } else {
        setScreen("room");
        setInfoMessage("Asistente identificado correctamente.");
      }
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
      if (shouldUseTouchRoomFlow) {
        exitFullscreenIfActive();
      }
    } finally {
      setLookupLoading(false);
    }
  }

  async function handlePresencialManualSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await identifyAssistantByIdentifier(identificador, "presencial");
  }

  const handleScannerSubmit = useCallback(async () => {
    const pendingCode = scannerValue.trim().toUpperCase();
    const startedAt = scannerStartedAtRef.current;
    const lastInputAt = scannerLastInputAtRef.current;
    const burstDuration = startedAt && lastInputAt ? lastInputAt - startedAt : 0;
    const scannerLikeDurationLimit = 80 + pendingCode.length * 90;

    if (
      lookupLoading ||
      roomLoading ||
      scannerProcessingRef.current ||
      pendingCode.length < 3
    ) {
      return;
    }

    if (burstDuration > scannerLikeDurationLimit) {
      resetScannerCapture();
      setShowManualFallback(false);
      setError("");
      setInfoMessage("Esperando lectura automatica desde el lector QR.");
      window.setTimeout(() => {
        focusScannerInput();
      }, 60);
      return;
    }

    scannerProcessingRef.current = true;

    try {
      await identifyAssistantByIdentifier(pendingCode, "presencial", "codigo");
    } finally {
      resetScannerCapture();
      scannerProcessingRef.current = false;
    }
  }, [
    focusScannerInput,
    identifyAssistantByIdentifier,
    lookupLoading,
    resetScannerCapture,
    roomLoading,
    scannerValue,
  ]);

  useEffect(() => {
    if (
      screen !== "presencial-wait" ||
      lookupLoading ||
      roomLoading ||
      identityCandidate ||
      existingReservationPrompt ||
      scannerProcessingRef.current
    ) {
      return;
    }

    const pendingCode = scannerValue.trim();

    if (pendingCode.length < 3) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void handleScannerSubmit();
    }, 280);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    existingReservationPrompt,
    handleScannerSubmit,
    identityCandidate,
    lookupLoading,
    roomLoading,
    scannerValue,
    screen,
  ]);

  async function handleConfirmReservation() {
    if (!asistente || !selectedSillaId || !evento) {
      return;
    }

    const previousEvento = evento;
    const previousSelectedSillaId = selectedSillaId;

    setReservationLoading(true);
    setError("");
    setInfoMessage("Guardando reserva...");
    setEvento(applyOptimisticReservation(previousEvento, selectedSillaId, asistente.id));
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
          esCeliaco,
          tieneAlergias,
          movilidadReducida,
          observaciones: observacionesReserva,
        }),
      });

      const result = (await response.json()) as {
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        setEvento(previousEvento);
        setSelectedSillaId(previousSelectedSillaId);
        if (accessMode === "presencial") {
          setShowReservationQuestionnaire(true);
        }
        const message = result.error ?? "No se ha podido confirmar la reserva.";
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

      pushToast({
        tone: "success",
        title: "Reserva confirmada",
        description: message,
      });

      if (accessMode === "presencial") {
        goToPresencialWait("Reserva completada. Esperando el siguiente QR.");
      } else {
        resetReservationForm();
        setInfoMessage(message);
      }
    } catch {
      setEvento(previousEvento);
      setSelectedSillaId(previousSelectedSillaId);
      if (accessMode === "presencial") {
        setShowReservationQuestionnaire(true);
      }
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

  function enterPresencialRoom() {
    if (!identityCandidate) {
      return;
    }

    requestPresencialFullscreen();
    requestLandscapeOrientation();
    setAsistente(identityCandidate.asistente);
    setEvento(identityCandidate.evento);
    setIdentityCandidate(null);
    setSelectedSillaId(null);
    setScreen("room");
    setInfoMessage("Asistente confirmado. Elige una silla para reservar.");
    setScannerValue("");
    setShowManualFallback(false);
  }

  function rejectIdentityCandidate() {
    setIdentityCandidate(null);
    setIdentificador("");
    setError("");
    setInfoMessage("Introduce el codigo correcto del asistente.");
    setShowManualFallback(true);
    setScreen("presencial-manual");
  }

  function rejectExistingReservationPrompt() {
    setExistingReservationPrompt(null);
    setIdentificador("");
    setError("");
    setInfoMessage("Introduce el codigo correcto del asistente.");
    setShowManualFallback(true);
    setScreen("presencial-manual");
  }

  async function handleEditExistingReservation() {
    if (!existingReservationPrompt) {
      return;
    }

    setReservationLoading(true);
    setError("");
    setInfoMessage("Eliminando la reserva anterior...");

    try {
      const response = await fetch("/api/reservas", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          asistenteId: existingReservationPrompt.asistente.id,
        }),
      });

      const result = (await response.json()) as {
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        const message =
          result.error ?? "No se pudo eliminar la reserva anterior de este asistente.";
        setError(message);
        pushToast({
          tone: "error",
          title: "No se pudo editar la reserva",
          description: message,
        });
        return;
      }

      const eventoActualizado = await cargarEvento(existingReservationPrompt.asistente.evento_id, {
        silent: true,
      });
      setAsistente(existingReservationPrompt.asistente);
      setEvento(eventoActualizado);
      setExistingReservationPrompt(null);
      setScreen("room");
      setScannerValue("");
      setShowManualFallback(false);
      setInfoMessage("Reserva anterior eliminada. Elige una silla nueva.");
      pushToast({
        tone: "success",
        title: "Reserva desbloqueada",
        description: result.message ?? "Ya puedes escoger una nueva silla.",
      });
    } catch {
      setError("No se pudo eliminar la reserva anterior en este momento.");
      pushToast({
        tone: "error",
        title: "No se pudo editar la reserva",
        description: "Intentalo de nuevo en unos segundos.",
      });
    } finally {
      setReservationLoading(false);
    }
  }

  function cancelExistingReservationPrompt() {
    setExistingReservationPrompt(null);
    setScannerValue("");
    goToPresencialWait();
  }

  function openReservationSummary() {
    if (!canConfirmSelection) {
      return;
    }
    setShowReservationSummary(true);
    setShowReservationQuestionnaire(false);
  }

  function cancelReservationSummary() {
    setShowReservationSummary(false);
    setSelectedSillaId(null);
  }

  function continueReservationFlow() {
    setShowReservationSummary(false);
    setShowReservationQuestionnaire(true);
  }

  function cancelReservationQuestionnaire() {
    setShowReservationQuestionnaire(false);
  }

  const guidedRoomOverlay = evento && asistente ? (
    <>
      {useTouchMobileFlow ? (
        <div className="pointer-events-auto absolute left-3 right-3 top-3 max-w-[18rem] sm:left-4 sm:right-auto sm:top-4">
          <button
            type="button"
            onClick={() => setMobileOverlayExpanded((current) => !current)}
            className="flex w-full items-center justify-between rounded-[20px] border border-stone-200 bg-white/94 px-3 py-3 text-left shadow-sm backdrop-blur"
          >
            <p className="truncate text-base font-semibold tracking-tight text-stone-950">
              {asistente.nombre}
            </p>
            <span className="ml-3 text-base font-semibold text-stone-500">
              {mobileOverlayExpanded ? "−" : "+"}
            </span>
          </button>

          {mobileOverlayExpanded ? (
            <div className="mt-2 rounded-[24px] border border-stone-200 bg-white/94 px-3 py-3 shadow-sm backdrop-blur sm:px-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
                Reserva movil
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-stone-950">
                {evento.nombre}
              </h2>
              <p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                {asistente.nombre}
              </p>
              <p className="mt-1 text-xs text-stone-600">{asistente.identificador}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <StatBadge
                  label="Tiempo real"
                  value={realtimeConnected ? "Activo" : "En espera"}
                  tone={realtimeConnected ? "success" : "neutral"}
                />
                {reservaActual ? (
                  <StatBadge
                    label="Reserva"
                    value={`Mesa ${reservaActual.mesaNumero} · Silla ${reservaActual.sillaNumero}`}
                    tone="warning"
                  />
                ) : null}
              </div>
              {reservaActual ? (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={resetMobileFlow}
                    className="inline-flex min-h-10 items-center justify-center rounded-full border border-stone-300 bg-white px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
                  >
                    Salir
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="pointer-events-auto absolute left-3 right-3 top-3 max-w-sm rounded-[28px] border border-stone-200 bg-white/94 px-4 py-4 shadow-sm backdrop-blur sm:left-4 sm:right-auto sm:top-4 sm:px-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
            {accessMode === "presencial" ? "Reserva presencial" : "Reserva movil"}
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-stone-950">
            {evento.nombre}
          </h2>
          <p className="mt-2 text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
            {asistente.nombre}
          </p>
          <p className="mt-1 text-sm text-stone-600">{asistente.identificador}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <StatBadge
              label="Tiempo real"
              value={realtimeConnected ? "Activo" : "En espera"}
              tone={realtimeConnected ? "success" : "neutral"}
            />
            {reservaActual ? (
              <StatBadge
                label="Reserva"
                value={`Mesa ${reservaActual.mesaNumero} · Silla ${reservaActual.sillaNumero}`}
                tone="warning"
              />
            ) : null}
          </div>
        </div>
      )}

      {selectedSillaId &&
      seleccionActual &&
      !reservaActual &&
      !showReservationSummary &&
      !showReservationQuestionnaire ? (
        <div className="pointer-events-auto absolute bottom-4 left-1/2 flex w-[min(88vw,22rem)] -translate-x-1/2 flex-col items-stretch gap-2.5 sm:bottom-6 sm:left-auto sm:right-6 sm:w-auto sm:translate-x-0 sm:items-end">
          <div
            className={`rounded-3xl border border-amber-300 bg-[linear-gradient(180deg,_#fff8db,_#fff1b8)] text-left shadow-sm ${
              useTouchMobileFlow
                ? "w-full px-3 py-2.5"
                : "px-5 py-4 sm:max-w-sm sm:text-right"
            }`}
          >
            <p
              className={`font-semibold uppercase tracking-[0.18em] text-amber-800 ${
                useTouchMobileFlow ? "text-[11px]" : "text-sm"
              }`}
            >
              Seleccion actual
            </p>
            <p
              className={`mt-2 text-stone-800 ${
                useTouchMobileFlow ? "text-xs leading-5" : "text-base leading-7"
              }`}
            >
              Mesa {seleccionActual.mesaNumero}, Silla {seleccionActual.sillaNumero}
            </p>
          </div>
          <button
            type="button"
            onClick={openReservationSummary}
            className={`inline-flex items-center justify-center rounded-full bg-emerald-600 font-semibold uppercase tracking-[0.18em] text-white shadow-[0_18px_40px_rgba(22,163,74,0.28)] transition hover:bg-emerald-700 ${
              useTouchMobileFlow
                ? "min-h-12 min-w-[180px] px-5 py-2.5 text-xs"
                : "min-h-16 min-w-[240px] px-8 py-4 text-base"
            }`}
          >
            Confirmar reserva
          </button>
        </div>
      ) : null}

      {reservaActual && !useTouchMobileFlow ? (
        <div className="pointer-events-auto absolute bottom-4 left-1/2 w-[min(92vw,24rem)] -translate-x-1/2 rounded-[28px] border border-sky-200 bg-white/94 px-5 py-4 shadow-sm backdrop-blur sm:bottom-6 sm:left-auto sm:right-6 sm:w-auto sm:translate-x-0 sm:max-w-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
            Reserva existente
          </p>
          <p className="mt-2 text-base leading-7 text-stone-700">
            Este asistente ya tiene asignada la Mesa {reservaActual.mesaNumero}, Silla{" "}
            {reservaActual.sillaNumero}.
          </p>
        </div>
      ) : null}
      {showReservationSummary && seleccionActual ? (
        <OverlayModal
          title="Confirma la reserva"
          description="Comprueba la mesa y la silla antes de continuar con los datos adicionales."
        >
          <div className="rounded-[28px] border border-amber-300 bg-[linear-gradient(180deg,_#fff7cc,_#ffe082)] px-5 py-5 text-stone-900 shadow-[0_18px_40px_rgba(245,158,11,0.22)] ring-1 ring-amber-200/80">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-800">
              Seleccionada
            </p>
            <p className="mt-3 text-2xl font-semibold tracking-tight text-stone-950">
              Mesa {seleccionActual.mesaNumero}, Silla {seleccionActual.sillaNumero}
            </p>
          </div>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={cancelReservationSummary}
              className="inline-flex min-h-14 w-full items-center justify-center rounded-full border border-stone-300 bg-white px-6 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-stone-700 transition hover:border-stone-950 hover:text-stone-950 sm:w-auto"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={continueReservationFlow}
              className="inline-flex min-h-14 w-full items-center justify-center rounded-full bg-emerald-600 px-6 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-emerald-700 sm:w-auto"
            >
              Continuar
            </button>
          </div>
        </OverlayModal>
      ) : null}

      {showReservationQuestionnaire && seleccionActual ? (
        <OverlayModal
          title="Ultimos datos de la reserva"
          description={`Completa el cuestionario para la Mesa ${seleccionActual.mesaNumero}, Silla ${seleccionActual.sillaNumero}.`}
        >
          <ReservationChecklist
            esCeliaco={esCeliaco}
            setEsCeliaco={setEsCeliaco}
            tieneAlergias={tieneAlergias}
            setTieneAlergias={setTieneAlergias}
            movilidadReducida={movilidadReducida}
            setMovilidadReducida={setMovilidadReducida}
            observacionesReserva={observacionesReserva}
            setObservacionesReserva={setObservacionesReserva}
          />
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={cancelReservationQuestionnaire}
              className="inline-flex min-h-14 w-full items-center justify-center rounded-full border border-stone-300 bg-white px-6 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-stone-700 transition hover:border-stone-950 hover:text-stone-950 sm:w-auto"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirmReservation}
              disabled={reservationLoading}
              className="inline-flex min-h-14 w-full items-center justify-center rounded-full bg-emerald-600 px-6 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-stone-300 sm:w-auto"
            >
              {reservationLoading ? "Guardando..." : "Confirmar reserva"}
            </button>
          </div>
        </OverlayModal>
      ) : null}
    </>
  ) : null;

  return (
    <main
      className={`bg-[radial-gradient(circle_at_top,_#fff7ed,_#f5f5f4_55%,_#e7e5e4)] text-stone-900 ${
        screen === "presencial-wait"
          ? "h-screen overflow-hidden px-0 py-0"
          : screen === "home"
            ? "h-[100dvh] overflow-hidden px-4 py-4 sm:px-6 sm:py-6"
          : accessMode === "movil"
            ? "min-h-screen px-6 py-12"
            : "min-h-screen px-4 py-6 sm:px-6 sm:py-12"
      }`}
    >
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {screen === "home" ? (
        <div className="mx-auto flex h-full max-w-5xl flex-col overflow-hidden">
          <div className="flex flex-1 items-center justify-center">
            <div className="w-full max-w-5xl">
              <div className="mb-8 text-center">
                <h1 className="text-4xl font-semibold tracking-[0.18em] text-stone-950 sm:text-5xl">
                  SALA DE CENAS
                </h1>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <ModeButton
                  title="Reserva Presencial"
                  description="Pensada para mostradores y pantallas tactiles. Lee el QR del asistente, confirma la identidad y entra directamente en la sala para reservar."
                  onClick={() => goToPresencialWait()}
                />
                <ModeButton
                  title="Reserva Movil"
                  description="Acceso tradicional con codigo de asistente, manteniendo la sala interactiva y mejorando la experiencia tactil para movil y tablet."
                  onClick={goToMovilIdentify}
                />
              </div>
            </div>
          </div>

          <div className="flex justify-center pt-4">
            <Link
              href="/admin"
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-stone-300 bg-white px-6 py-4 text-sm font-semibold uppercase tracking-[0.2em] text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
            >
              ACCESO ADMINISTRADORES
            </Link>
          </div>
        </div>
      ) : null}

      {screen === "movil-identify" ? (
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

          <form className="mt-10 space-y-4" onSubmit={handleMobileIdentifySubmit}>
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
              <button
                type="button"
                onClick={goHome}
                className="inline-flex min-w-[220px] items-center justify-center rounded-full border border-stone-300 bg-white px-6 py-4 text-sm font-semibold uppercase tracking-[0.2em] text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
              >
                Volver al menu principal
              </button>
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
      ) : null}

      {screen === "movil-ready" ? (
        <section className="mx-auto flex min-h-[100dvh] max-w-3xl items-center justify-center px-4 py-6">
          <div className="w-full rounded-[36px] border border-stone-200 bg-white px-6 py-8 text-center shadow-[0_20px_70px_rgba(28,25,23,0.12)] sm:px-8 sm:py-10">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-4xl text-emerald-700 shadow-[0_12px_30px_rgba(16,185,129,0.18)]">
              □
            </div>
            <p className="mt-6 text-sm font-semibold uppercase tracking-[0.3em] text-emerald-700">
              Reserva movil
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-stone-950">
              Activa la pantalla completa
            </h2>
            <p className="mt-4 text-base leading-7 text-stone-600">
              Para una experiencia mas comoda en movil o tablet, activa primero la pantalla
              completa. Despues te llevaremos a la sala para reservar.
            </p>
            {!isLandscapeViewport ? (
              <div className="mt-6 rounded-[28px] border border-amber-200 bg-amber-50 px-5 py-4 text-left">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-800">
                  Gira el dispositivo
                </p>
                <p className="mt-2 text-base leading-7 text-amber-900/80">
                  La sala esta optimizada para mostrarse en horizontal.
                </p>
              </div>
            ) : null}
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={enterMobileTouchRoom}
                className="inline-flex min-h-14 items-center justify-center rounded-full bg-emerald-600 px-6 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-emerald-700"
              >
                Activar pantalla completa
              </button>
              <button
                type="button"
                onClick={resetMobileFlow}
                className="inline-flex min-h-14 items-center justify-center rounded-full border border-stone-300 bg-white px-6 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
              >
                Volver
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {screen === "presencial-wait" ? (
        <section className="mx-auto flex h-full min-h-screen w-full max-w-none flex-col overflow-hidden rounded-none border-0 border-stone-800 bg-[linear-gradient(180deg,_#1c1917_0%,_#292524_48%,_#44403c_100%)] shadow-none">
          <input
            ref={scannerInputRef}
            id="scanner-identificador"
            type="text"
            value={scannerValue}
            autoFocus
            onChange={handleScannerInputChange}
            onPaste={(event) => event.preventDefault()}
            onBlur={() => {
              window.setTimeout(() => {
                focusScannerInput();
              }, 60);
            }}
            className="absolute left-[-9999px] top-0 h-px w-px opacity-0"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />

          <div className="relative flex flex-1 flex-col px-6 py-6 sm:px-10 sm:py-8">
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="absolute left-[12%] top-[12%] h-52 w-52 rounded-full bg-amber-600/12 blur-3xl" />
              <div className="absolute bottom-[10%] right-[10%] h-64 w-64 rounded-full bg-orange-300/10 blur-3xl" />
            </div>

            <div className="relative flex items-start justify-between gap-4">
              <div className="rounded-full border border-white/15 bg-white/8 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-amber-100">
                Reserva presencial
              </div>

              <div className="rounded-full border border-white/10 bg-black/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-200">
                {lookupLoading || roomLoading
                  ? "Procesando QR"
                  : scannerProcessingRef.current
                    ? "Lectura recibida"
                    : "Lector QR activo"}
              </div>
            </div>

            <div className="relative flex flex-1 items-center justify-center">
              <div className="mx-auto max-w-3xl text-center">
                <p className="text-sm font-semibold uppercase tracking-[0.35em] text-amber-200/85">
                  SALA DE CENAS
                </p>
                <h1 className="mt-5 text-5xl font-semibold tracking-[0.16em] text-white sm:text-6xl">
                  RESERVAS CENA
                </h1>
                <p className="mx-auto mt-8 max-w-2xl text-xl leading-9 text-stone-200 sm:text-2xl">
                  Acerque su codigo QR al lector para comenzar con la reserva
                </p>

                <div className="mx-auto mt-10 flex h-28 w-28 items-center justify-center rounded-[28px] border border-white/15 bg-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] backdrop-blur-sm">
                  <div className="grid grid-cols-3 gap-1.5">
                    {Array.from({ length: 9 }).map((_, index) => (
                      <span
                        key={index}
                        className={`h-3.5 w-3.5 rounded-sm ${
                          index % 2 === 0 ? "bg-amber-200" : "bg-white/45"
                        }`}
                      />
                    ))}
                  </div>
                </div>

                <p className="mt-8 text-sm font-medium uppercase tracking-[0.2em] text-stone-300">
                  {lookupLoading || roomLoading || scannerProcessingRef.current
                    ? "Procesando lectura automatica del asistente"
                    : "Esperando lectura automatica del asistente"}
                </p>

                {lookupLoading || roomLoading ? (
                  <div className="mx-auto mt-8 max-w-2xl rounded-[28px] border border-amber-300/20 bg-amber-100/10 px-5 py-4 text-left text-amber-50 backdrop-blur-sm">
                    <p className="text-sm font-semibold uppercase tracking-[0.18em]">
                      Comprobando QR
                    </p>
                    <p className="mt-2 text-base leading-7 text-stone-100">
                      Estamos verificando el asistente y preparando el evento asociado.
                    </p>
                  </div>
                ) : null}

                {infoMessage ? (
                  <div className="mx-auto mt-8 max-w-2xl rounded-[28px] border border-emerald-300/20 bg-emerald-100/10 px-5 py-4 text-left text-emerald-50 backdrop-blur-sm">
                    <p className="text-sm font-semibold uppercase tracking-[0.18em]">
                      Estado
                    </p>
                    <p className="mt-2 text-base leading-7 text-stone-100">{infoMessage}</p>
                  </div>
                ) : null}

                {error ? (
                  <div className="mx-auto mt-8 max-w-2xl rounded-[28px] border border-rose-300/20 bg-rose-100/10 px-5 py-4 text-left text-rose-50 backdrop-blur-sm">
                    <p className="text-sm font-semibold uppercase tracking-[0.18em]">
                      Error
                    </p>
                    <p className="mt-2 text-base leading-7 text-stone-100">{error}</p>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="relative mt-4 flex flex-wrap items-end justify-between gap-3">
              <button
                type="button"
                onClick={goHome}
                className="inline-flex min-h-14 items-center justify-center rounded-full border border-white/20 bg-white/10 px-6 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-white/16"
              >
                Volver al inicio
              </button>

              {showManualFallback || error ? (
                <button
                  type="button"
                  onClick={() => {
                    setScannerValue("");
                    setIdentificador("");
                    setError("");
                    setInfoMessage("");
                    setScreen("presencial-manual");
                  }}
                  className="inline-flex min-h-14 items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-stone-900 transition hover:bg-amber-100"
                >
                  Identificar con codigo de asistente
                </button>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {screen === "presencial-manual" ? (
        <ScreenCard
          eyebrow="Reserva presencial"
          title="Identificacion manual"
          description="Introduce el codigo del asistente si el QR no coincide o si quieres corregir la lectura."
        >
          <IdentityCodeForm
            identificador={identificador}
            onChange={setIdentificador}
            onSubmit={handlePresencialManualSubmit}
            submitLabel="Identificar asistente"
            busy={lookupLoading || roomLoading}
          />

          <VirtualKeyboard
            onKeyPress={(value) =>
              setIdentificador((current) => `${current}${value}`.toUpperCase())
            }
            onBackspace={() => setIdentificador((current) => current.slice(0, -1))}
            onClear={() => setIdentificador("")}
          />

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                setIdentificador("");
                setError("");
                setInfoMessage("");
                setScreen("presencial-wait");
              }}
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-stone-300 bg-white px-6 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
            >
              Volver a esperar QR
            </button>
          </div>

          {lookupLoading || roomLoading ? (
            <div className="mt-8">
              <InlineMessage
                tone="info"
                title="Comprobando codigo"
                message="Estamos validando el asistente y cargando el evento asociado."
              />
            </div>
          ) : null}

          {error ? (
            <div className="mt-8">
              <InlineMessage tone="error" title="Error" message={error} />
            </div>
          ) : null}
        </ScreenCard>
      ) : null}

      {identityCandidate ? (
        <OverlayModal
          title={identityCandidate.asistente.nombre}
          description={`Este QR corresponde al evento ${identityCandidate.evento.nombre}.`}
        >
          <div className="rounded-[28px] border border-amber-200 bg-amber-50 px-5 py-5 text-stone-900">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-800">
              Asistente identificado
            </p>
            <p className="mt-3 text-xl font-semibold tracking-tight">
              {identityCandidate.asistente.identificador}
            </p>
            <p className="mt-2 text-base leading-7 text-stone-700">
              Evento asociado: {identityCandidate.evento.nombre}
            </p>
          </div>

          <div className="mt-6 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={rejectIdentityCandidate}
              className="inline-flex min-h-14 items-center justify-center rounded-full border border-stone-300 bg-white px-6 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
            >
              No eres tu?
            </button>
            <button
              type="button"
              onClick={enterPresencialRoom}
              className="inline-flex min-h-14 items-center justify-center rounded-full bg-emerald-600 px-6 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-emerald-700"
            >
              Continuar
            </button>
          </div>
        </OverlayModal>
      ) : null}

      {existingReservationPrompt ? (
        <OverlayModal
          title="Quiere editar su reserva?"
          description={`Este QR corresponde a ${existingReservationPrompt.asistente.nombre} en el evento ${existingReservationPrompt.evento.nombre}.`}
        >
          <div className="rounded-[28px] border border-sky-200 bg-sky-50 px-5 py-5 text-stone-900">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
              Reserva actual
            </p>
            <p className="mt-3 text-2xl font-semibold tracking-tight">
              Mesa {existingReservationPrompt.reserva.mesaNumero}, Silla{" "}
              {existingReservationPrompt.reserva.sillaNumero}
            </p>
            <p className="mt-2 text-base leading-7 text-stone-700">
              Si continuas, la reserva actual se eliminara antes de elegir una nueva silla.
            </p>
          </div>

          <div className="mt-6 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={rejectExistingReservationPrompt}
              className="inline-flex min-h-14 items-center justify-center rounded-full border border-amber-300 bg-amber-50 px-6 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-amber-800 transition hover:border-amber-500 hover:bg-amber-100"
            >
              No soy yo
            </button>
            <button
              type="button"
              onClick={cancelExistingReservationPrompt}
              className="inline-flex min-h-14 items-center justify-center rounded-full border border-stone-300 bg-white px-6 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleEditExistingReservation}
              disabled={reservationLoading}
              className="inline-flex min-h-14 items-center justify-center rounded-full bg-emerald-600 px-6 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-stone-300"
            >
              {reservationLoading ? "Editando..." : "Editar Reserva"}
            </button>
          </div>
        </OverlayModal>
      ) : null}

      {screen === "room" && asistente && evento ? (
        accessMode === "presencial" || useTouchMobileFlow ? (
          <div
            className={
              useTouchMobileFlow
                ? "fixed inset-0 z-30 h-[100dvh] w-screen overflow-hidden bg-[radial-gradient(circle_at_top,_#fff7ed,_#f5f5f4_55%,_#e7e5e4)]"
                : "mx-auto max-w-[1800px] space-y-6"
            }
          >
            {useTouchMobileFlow && !isLandscapeViewport ? (
              <section className="flex min-h-[100dvh] items-center justify-center px-4 py-6">
                <div className="w-full max-w-lg rounded-[36px] border border-stone-200 bg-white px-6 py-8 text-center shadow-[0_20px_70px_rgba(28,25,23,0.12)] sm:px-8">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-amber-100 text-4xl text-amber-700 shadow-[0_12px_30px_rgba(245,158,11,0.18)]">
                    ↻
                  </div>
                  <p className="mt-6 text-sm font-semibold uppercase tracking-[0.3em] text-amber-700">
                    Sala optimizada para horizontal
                  </p>
                  <h2 className="mt-3 text-3xl font-semibold tracking-tight text-stone-950">
                    Gira el dispositivo
                  </h2>
                  <p className="mt-4 text-base leading-7 text-stone-600">
                    Para reservar desde movil o tablet necesitamos mostrar la sala en horizontal.
                    En cuanto gires el dispositivo, entraremos automaticamente en la vista de sala.
                  </p>
                </div>
              </section>
            ) : (
              <section className={useTouchMobileFlow ? "h-full w-full" : ""}>
                <DinnerRoomScene
                  evento={evento}
                  selectedSillaId={selectedSillaId}
                  currentAsistenteId={asistente.id}
                  selectionLocked={Boolean(reservaActual) || reservationLoading}
                  onSelectSilla={setSelectedSillaId}
                  overlay={guidedRoomOverlay}
                  touchMode
                  defaultViewMode="2d"
                  fullscreenBehavior="locked"
                  requestFullscreenOnMount
                  hide2DHeader
                  touchGestureProfile="presencial"
                  hideControlsLegend={useTouchMobileFlow}
                  compactUi={useTouchMobileFlow}
                />
              </section>
            )}
          </div>
        ) : (
          <div className="mx-auto max-w-7xl space-y-6">
            <section className="rounded-[36px] border border-stone-200 bg-white px-8 py-8 shadow-[0_20px_70px_rgba(28,25,23,0.12)] sm:px-10">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.35em] text-amber-700">
                  Asistente identificado
                </p>
                <h1 className="mt-4 text-4xl font-semibold tracking-tight text-stone-950">
                  {asistente.nombre}
                </h1>
                <p className="mt-3 text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
                  {asistente.identificador}
                </p>
              </div>
            </section>

            <section className="rounded-[36px] border border-stone-200 bg-white px-8 py-8 shadow-[0_20px_70px_rgba(28,25,23,0.12)] sm:px-10">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.3em] text-amber-700">
                  Sala visual
                </p>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight text-stone-950">
                  {evento.nombre ?? "Evento"}
                </h2>
              </div>
            </section>

            <section className="rounded-[36px] border border-stone-200 bg-white px-8 py-8 shadow-[0_20px_70px_rgba(28,25,23,0.12)] sm:px-10">
              <div className="mt-2">
                <DinnerRoomSceneLegacy
                  evento={evento}
                  selectedSillaId={selectedSillaId}
                  currentAsistenteId={asistente.id}
                  selectionLocked={Boolean(reservaActual) || reservationLoading}
                  onSelectSilla={setSelectedSillaId}
                  fullscreenEnabled={false}
                />
              </div>

              <div ref={desktopReservationPanelRef} className="mt-6 rounded-3xl bg-stone-100 px-6 py-5">
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={resetMobileFlow}
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

                {selectedSillaId && !reservaActual ? (
                  <div className="mt-5 rounded-3xl border border-amber-300 bg-[linear-gradient(180deg,_#fff8db,_#fff1b8)] px-5 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]">
                    <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-800">
                      Datos importantes para la cena
                    </p>
                    <p className="mt-2 text-sm leading-6 text-amber-900/80">
                      Marca aqui cualquier aviso relevante para que el equipo lo tenga presente antes del servicio.
                    </p>
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <label className="flex items-center gap-3 rounded-2xl border border-amber-300 bg-white/80 px-4 py-3 text-sm font-medium text-stone-800">
                        <input
                          type="checkbox"
                          checked={esCeliaco}
                          onChange={(event) => setEsCeliaco(event.target.checked)}
                          className="h-4 w-4 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                        />
                        Es celiaco
                      </label>
                      <label className="flex items-center gap-3 rounded-2xl border border-amber-300 bg-white/80 px-4 py-3 text-sm font-medium text-stone-800">
                        <input
                          type="checkbox"
                          checked={tieneAlergias}
                          onChange={(event) => setTieneAlergias(event.target.checked)}
                          className="h-4 w-4 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                        />
                        Tiene alergias
                      </label>
                      <label className="flex items-center gap-3 rounded-2xl border border-amber-300 bg-white/80 px-4 py-3 text-sm font-medium text-stone-800">
                        <input
                          type="checkbox"
                          checked={movilidadReducida}
                          onChange={(event) => setMovilidadReducida(event.target.checked)}
                          className="h-4 w-4 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                        />
                        Movilidad reducida
                      </label>
                    </div>
                    <label className="mt-4 block">
                      <span className="text-sm font-semibold text-amber-900/80">
                        Observaciones relevantes
                      </span>
                      <textarea
                        value={observacionesReserva}
                        onChange={(event) => setObservacionesReserva(event.target.value)}
                        placeholder="Ejemplo: alergia a frutos secos, sin lactosa o necesita acceso facil."
                        rows={3}
                        className="mt-2 w-full rounded-2xl border border-amber-300 bg-white/90 px-4 py-3 text-sm text-stone-900 outline-none transition focus:border-amber-500"
                      />
                    </label>
                  </div>
                ) : null}

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

                {!selectedSillaId && !reservaActual ? (
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
                      Este asistente ya tiene asignada la Mesa {reservaActual.mesaNumero}, Silla {reservaActual.sillaNumero}.
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
        )
      ) : null}
    </main>
  );
}
