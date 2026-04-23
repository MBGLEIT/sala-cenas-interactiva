import { supabase } from "@/lib/supabase";

export default function Home() {
  const setupChecks = [
    {
      label: "Next.js 14 con App Router",
      ready: true,
    },
    {
      label: "Proyecto remoto de Supabase creado",
      ready: true,
    },
    {
      label: "Variables de entorno cargadas",
      ready: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    },
    {
      label: "Cliente singleton de Supabase preparado",
      ready: Boolean(supabase),
    },
  ];

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-100 px-6 py-16 text-stone-900">
      <section className="w-full max-w-3xl rounded-[32px] border border-stone-200 bg-white p-8 shadow-[0_18px_60px_rgba(28,25,23,0.08)] sm:p-12">
        <p className="text-sm font-medium uppercase tracking-[0.3em] text-amber-700">
          Sala de Cenas Interactiva
        </p>
        <h1 className="mt-4 max-w-2xl text-4xl font-semibold tracking-tight text-stone-950">
          Fase 1 completada: la base del proyecto ya esta preparada.
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-stone-600">
          Ahora ya tenemos el proyecto en Next.js 14, la conexion inicial con
          Supabase y la estructura minima para seguir con base de datos, API y
          la parte visual sin empezar desde cero cada vez.
        </p>

        <div className="mt-10 grid gap-4">
          {setupChecks.map((check) => (
            <div
              key={check.label}
              className="flex items-center justify-between rounded-2xl border border-stone-200 bg-stone-50 px-5 py-4"
            >
              <span className="text-base font-medium text-stone-800">
                {check.label}
              </span>
              <span
                className={`rounded-full px-3 py-1 text-sm font-semibold ${
                  check.ready
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-amber-100 text-amber-700"
                }`}
              >
                {check.ready ? "Listo" : "Pendiente"}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-10 rounded-2xl bg-stone-950 px-6 py-5 text-stone-100">
          <p className="text-sm uppercase tracking-[0.25em] text-amber-300">
            Siguiente paso
          </p>
          <p className="mt-2 text-base leading-7 text-stone-300">
            En la Fase 2 diseñaremos las tablas de eventos, asistentes, mesas,
            sillas y reservas. Ahi es donde de verdad empieza a tomar forma la
            logica del negocio.
          </p>
        </div>
      </section>
    </main>
  );
}
