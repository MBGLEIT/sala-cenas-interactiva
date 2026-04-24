"use client";

import Link from "next/link";
import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import ToastStack, { ToastItem } from "@/components/toast-stack";

export default function AdminLoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password }),
    });

    const result = (await response.json()) as {
      error?: string;
      message?: string;
    };

    if (!response.ok) {
      const message = result.error ?? "No se pudo abrir el panel admin.";
      setError(message);
      pushToast({
        tone: "error",
        title: "Acceso denegado",
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
          Esta zona sirve para crear eventos, gestionar asistentes y mover o
          deshacer reservas sin tocar la parte publica del proyecto.
        </p>

        <form className="mt-10 space-y-4" onSubmit={handleSubmit}>
          <label
            htmlFor="admin-password"
            className="block text-sm font-semibold uppercase tracking-[0.2em] text-stone-500"
          >
            Contrasena admin
          </label>
          <input
            id="admin-password"
            name="admin-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-2xl border border-stone-300 bg-stone-50 px-5 py-4 text-lg font-medium text-stone-900 outline-none transition focus:border-amber-500 focus:bg-white"
          />

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={isPending}
              className="inline-flex min-w-[220px] items-center justify-center rounded-full bg-stone-950 px-6 py-4 text-sm font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-stone-400"
            >
              {isPending ? "Entrando..." : "Entrar al panel"}
            </button>
            <Link
              href="/"
              className="inline-flex min-w-[220px] items-center justify-center rounded-full border border-stone-300 bg-white px-6 py-4 text-sm font-semibold uppercase tracking-[0.2em] text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
            >
              Volver al menu principal
            </Link>
          </div>
        </form>

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
