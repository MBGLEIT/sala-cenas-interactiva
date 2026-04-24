grant usage on schema public to service_role;

grant all privileges on public.eventos to service_role;
grant all privileges on public.asistentes to service_role;
grant all privileges on public.mesas to service_role;
grant all privileges on public.sillas to service_role;
grant all privileges on public.reservas to service_role;

alter default privileges for role postgres in schema public
grant all on tables to service_role;
