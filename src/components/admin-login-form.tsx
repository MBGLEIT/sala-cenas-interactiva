"use client";

import Link from "next/link";
import Image from "next/image";
import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import ToastStack, { ToastItem } from "@/components/toast-stack";

type AuthMode = "login" | "register" | "totp-setup" | "totp-verify" | "pending";

type LoginResponse = {
  error?: string;
  message?: string;
  status?: string;
  requiresTotp?: boolean;
  challengeToken?: string;
  requiresTotpSetup?: boolean;
  setupToken?: string;
  totpSecret?: string;
  totpUri?: string;
  totpQrDataUrl?: string;
};

export default function AdminLoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [challengeToken, setChallengeToken] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [totpUri, setTotpUri] = useState("");
  const [totpQrDataUrl, setTotpQrDataUrl] = useState("");
  const [error, setError] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [isPending, startTransition] = useTransition();

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

    window.setTimeout(() => {
      dismissToast(id);
    }, 4200);
  }

  function resetFeedback() {
    setError("");
    setInfoMessage("");
  }

  function openLogin() {
    resetFeedback();
    setMode("login");
    setTotpCode("");
  }

  function openRegister() {
    resetFeedback();
    setMode("register");
    setTotpCode("");
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetFeedback();

    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });

    const result = (await response.json()) as LoginResponse;

    if (!response.ok) {
      const message = result.error ?? "No se pudo abrir el panel admin.";
      setError(message);
      setMode(result.status === "pending" ? "pending" : "login");
      pushToast({
        tone: "error",
        title: "Acceso denegado",
        description: message,
      });
      return;
    }

    if (result.requiresTotpSetup && result.setupToken && result.totpSecret) {
      setSetupToken(result.setupToken);
      setTotpSecret(result.totpSecret);
      setTotpUri(result.totpUri ?? "");
      setTotpQrDataUrl(result.totpQrDataUrl ?? "");
      setTotpCode("");
      setMode("totp-setup");
      setInfoMessage(result.message ?? "Configura el 2FA para activar tu cuenta.");
      return;
    }

    if (result.requiresTotp && result.challengeToken) {
      setChallengeToken(result.challengeToken);
      setTotpCode("");
      setMode("totp-verify");
      setInfoMessage(result.message ?? "Introduce el codigo de tu app authenticator.");
      return;
    }
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetFeedback();

    const response = await fetch("/api/admin/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, email, password }),
    });

    const result = (await response.json()) as LoginResponse;

    if (!response.ok) {
      const message = result.error ?? "No se pudo crear la solicitud admin.";
      setError(message);
      pushToast({
        tone: "error",
        title: "Solicitud no enviada",
        description: message,
      });
      return;
    }

    setMode("pending");
    setInfoMessage(
      result.message ?? "Solicitud enviada. Un administrador debe aprobarla.",
    );
    pushToast({
      tone: "success",
      title: "Solicitud enviada",
      description: "Cuando un admin la apruebe podras configurar el 2FA.",
    });
  }

  async function handleTotpSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetFeedback();

    const endpoint = mode === "totp-setup" ? "/api/admin/2fa/setup" : "/api/admin/2fa/verify";
    const body =
      mode === "totp-setup"
        ? { setupToken, code: totpCode }
        : { challengeToken, code: totpCode };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const result = (await response.json()) as LoginResponse;

    if (!response.ok) {
      const message = result.error ?? "El codigo 2FA no es correcto.";
      setError(message);
      pushToast({
        tone: "error",
        title: "2FA incorrecto",
        description: message,
      });
      return;
    }

    pushToast({
      tone: "success",
      title: "Acceso concedido",
      description: result.message ?? "Ya puedes entrar al panel admin.",
    });

    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#fff7ed,_#f5f5f4_55%,_#e7e5e4)] px-6 py-12 text-stone-900">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <div className="mx-auto max-w-2xl rounded-[36px] border border-stone-200 bg-white px-8 py-10 shadow-[0_20px_70px_rgba(28,25,23,0.12)] sm:px-10">
        <p className="text-sm font-semibold uppercase tracking-[0.35em] text-amber-700">
          Panel Admin
        </p>
        <h1 className="mt-5 text-4xl font-semibold tracking-tight text-stone-950">
          Acceso privado de administracion
        </h1>
        <p className="mt-5 text-lg leading-8 text-stone-600">
          Entra con tu cuenta admin. Si aun no tienes acceso, envia una solicitud
          para que otro administrador la apruebe desde el panel.
        </p>

        <div className="mt-8 flex rounded-full border border-stone-200 bg-stone-50 p-1">
          <button
            type="button"
            onClick={openLogin}
            className={`flex-1 rounded-full px-4 py-3 text-sm font-semibold uppercase tracking-[0.18em] transition ${
              mode !== "register"
                ? "bg-stone-950 text-white shadow-sm"
                : "text-stone-600 hover:text-stone-950"
            }`}
          >
            Entrar
          </button>
          <button
            type="button"
            onClick={openRegister}
            className={`flex-1 rounded-full px-4 py-3 text-sm font-semibold uppercase tracking-[0.18em] transition ${
              mode === "register"
                ? "bg-stone-950 text-white shadow-sm"
                : "text-stone-600 hover:text-stone-950"
            }`}
          >
            Solicitar acceso
          </button>
        </div>

        {mode === "login" ? (
          <form className="mt-10 space-y-4" onSubmit={handleLogin}>
            <label
              htmlFor="admin-email"
              className="block text-sm font-semibold uppercase tracking-[0.2em] text-stone-500"
            >
              Correo admin
            </label>
            <input
              id="admin-email"
              name="admin-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-5 py-4 text-lg font-medium text-stone-900 outline-none transition focus:border-amber-500 focus:bg-white"
            />

            <label
              htmlFor="admin-password"
              className="block text-sm font-semibold uppercase tracking-[0.2em] text-stone-500"
            >
              Contraseña
            </label>
            <input
              id="admin-password"
              name="admin-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-5 py-4 text-lg font-medium text-stone-900 outline-none transition focus:border-amber-500 focus:bg-white"
            />

            <PrimaryActions pending={isPending} label="Continuar" />
          </form>
        ) : null}

        {mode === "register" ? (
          <form className="mt-10 space-y-4" onSubmit={handleRegister}>
            <label
              htmlFor="admin-name"
              className="block text-sm font-semibold uppercase tracking-[0.2em] text-stone-500"
            >
              Nombre
            </label>
            <input
              id="admin-name"
              name="admin-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-5 py-4 text-lg font-medium text-stone-900 outline-none transition focus:border-amber-500 focus:bg-white"
            />

            <label
              htmlFor="register-email"
              className="block text-sm font-semibold uppercase tracking-[0.2em] text-stone-500"
            >
              Correo
            </label>
            <input
              id="register-email"
              name="register-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-5 py-4 text-lg font-medium text-stone-900 outline-none transition focus:border-amber-500 focus:bg-white"
            />

            <label
              htmlFor="register-password"
              className="block text-sm font-semibold uppercase tracking-[0.2em] text-stone-500"
            >
              Contraseña
            </label>
            <input
              id="register-password"
              name="register-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-5 py-4 text-lg font-medium text-stone-900 outline-none transition focus:border-amber-500 focus:bg-white"
            />

            <PrimaryActions pending={isPending} label="Enviar solicitud" />
          </form>
        ) : null}

        {mode === "totp-setup" ? (
          <form className="mt-10 space-y-5" onSubmit={handleTotpSubmit}>
            <div className="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-stone-800">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-800">
                Configura 2FA
              </p>
              <p className="mt-3 text-sm leading-7">
                Escanea este QR con Google Authenticator, Microsoft Authenticator o
                una app similar. Si el QR no funciona, usa la clave manual.
              </p>
              {totpQrDataUrl ? (
                <Image
                  src={totpQrDataUrl}
                  alt="QR para configurar el 2FA"
                  width={176}
                  height={176}
                  unoptimized
                  className="mt-4 h-44 w-44 rounded-3xl border border-stone-200 bg-white p-3"
                />
              ) : null}
              <p className="mt-3 break-all rounded-2xl bg-white px-4 py-3 font-mono text-sm font-semibold text-stone-950">
                {totpSecret}
              </p>
              {totpUri ? (
                <p className="mt-3 break-all text-xs leading-5 text-stone-500">
                  URI avanzada: {totpUri}
                </p>
              ) : null}
            </div>
            <TotpCodeInput value={totpCode} onChange={setTotpCode} />
            <PrimaryActions pending={isPending} label="Activar 2FA" />
          </form>
        ) : null}

        {mode === "totp-verify" ? (
          <form className="mt-10 space-y-5" onSubmit={handleTotpSubmit}>
            <TotpCodeInput value={totpCode} onChange={setTotpCode} />
            <PrimaryActions pending={isPending} label="Entrar al panel" />
          </form>
        ) : null}

        {mode === "pending" ? (
          <div className="mt-10 rounded-3xl border border-amber-200 bg-amber-50 px-5 py-5 text-amber-900">
            <p className="text-sm font-semibold uppercase tracking-[0.2em]">
              Solicitud pendiente
            </p>
            <p className="mt-3 text-base leading-7">
              {infoMessage ||
                "Tu cuenta queda pendiente hasta que un administrador la apruebe."}
            </p>
            <button
              type="button"
              onClick={openLogin}
              className="mt-5 inline-flex items-center justify-center rounded-full bg-stone-950 px-5 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-amber-700"
            >
              Volver al acceso
            </button>
          </div>
        ) : null}

        {infoMessage && mode !== "pending" ? (
          <div className="mt-6 rounded-3xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-emerald-800">
            <p className="text-sm font-semibold uppercase tracking-[0.2em]">
              Siguiente paso
            </p>
            <p className="mt-2 text-base leading-7">{infoMessage}</p>
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
      </div>
    </main>
  );
}

function TotpCodeInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-semibold uppercase tracking-[0.2em] text-stone-500">
        Codigo 2FA
      </span>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        value={value}
        onChange={(event) =>
          onChange(event.target.value.replace(/\D/g, "").slice(0, 6))
        }
        className="mt-3 w-full rounded-2xl border border-stone-300 bg-stone-50 px-5 py-4 text-center text-3xl font-semibold tracking-[0.35em] text-stone-900 outline-none transition focus:border-amber-500 focus:bg-white"
      />
    </label>
  );
}

function PrimaryActions({
  pending,
  label,
}: {
  pending: boolean;
  label: string;
}) {
  return (
    <div className="flex flex-wrap gap-3 pt-2">
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-w-[220px] items-center justify-center rounded-full bg-stone-950 px-6 py-4 text-sm font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-stone-400"
      >
        {pending ? "Procesando..." : label}
      </button>
      <Link
        href="/"
        className="inline-flex min-w-[220px] items-center justify-center rounded-full border border-stone-300 bg-white px-6 py-4 text-sm font-semibold uppercase tracking-[0.2em] text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
      >
        Volver al menu principal
      </Link>
    </div>
  );
}
