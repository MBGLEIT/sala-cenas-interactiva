"use client";

type ToastTone = "success" | "error" | "info";

export type ToastItem = {
  id: string;
  title: string;
  description: string;
  tone: ToastTone;
};

type ToastStackProps = {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
};

const toastStyles: Record<
  ToastTone,
  {
    container: string;
    badge: string;
  }
> = {
  success: {
    container:
      "border-emerald-200 bg-emerald-50 text-emerald-900 shadow-[0_18px_40px_rgba(5,150,105,0.18)]",
    badge: "bg-emerald-600 text-white",
  },
  error: {
    container:
      "border-rose-200 bg-rose-50 text-rose-900 shadow-[0_18px_40px_rgba(225,29,72,0.18)]",
    badge: "bg-rose-600 text-white",
  },
  info: {
    container:
      "border-sky-200 bg-sky-50 text-sky-950 shadow-[0_18px_40px_rgba(14,165,233,0.18)]",
    badge: "bg-sky-600 text-white",
  },
};

export default function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-full max-w-sm flex-col gap-3 sm:right-6 sm:top-6">
      {toasts.map((toast) => {
        const style = toastStyles[toast.tone];

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-3xl border px-4 py-4 transition ${style.container}`}
          >
            <div className="flex items-start gap-3">
              <span
                className={`mt-0.5 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${style.badge}`}
              >
                {toast.tone}
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold tracking-[0.01em]">
                  {toast.title}
                </p>
                <p className="mt-1 text-sm leading-6 opacity-90">
                  {toast.description}
                </p>
              </div>

              <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                className="rounded-full px-2 py-1 text-sm font-semibold opacity-65 transition hover:opacity-100"
                aria-label="Cerrar notificacion"
              >
                Cerrar
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
