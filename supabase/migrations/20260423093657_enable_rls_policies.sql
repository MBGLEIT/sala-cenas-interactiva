alter table public.eventos enable row level security;
alter table public.asistentes enable row level security;
alter table public.mesas enable row level security;
alter table public.sillas enable row level security;
alter table public.reservas enable row level security;

create policy "eventos_select_public"
on public.eventos
for select
to anon
using (true);

create policy "asistentes_select_public"
on public.asistentes
for select
to anon
using (true);

create policy "mesas_select_public"
on public.mesas
for select
to anon
using (true);

create policy "sillas_select_public"
on public.sillas
for select
to anon
using (true);

create policy "reservas_select_public"
on public.reservas
for select
to anon
using (true);

create policy "reservas_insert_public"
on public.reservas
for insert
to anon
with check (true);
