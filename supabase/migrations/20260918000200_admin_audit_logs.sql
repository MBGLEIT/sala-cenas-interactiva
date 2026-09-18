create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid references public.admin_users(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_admin_user_id_created_at_idx
  on public.admin_audit_logs(admin_user_id, created_at desc);

create index if not exists admin_audit_logs_created_at_idx
  on public.admin_audit_logs(created_at desc);

alter table public.admin_audit_logs enable row level security;

drop policy if exists "admin_audit_logs_no_public_access" on public.admin_audit_logs;
create policy "admin_audit_logs_no_public_access"
  on public.admin_audit_logs
  for all
  using (false)
  with check (false);
