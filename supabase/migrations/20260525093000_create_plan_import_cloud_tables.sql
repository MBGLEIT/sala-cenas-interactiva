create table public.plan_import_jobs (
  id uuid primary key default gen_random_uuid(),
  trace_id text not null unique,
  evento_id uuid not null references public.eventos(id) on delete cascade,
  status text not null default 'pending'
    check (
      status in (
        'pending',
        'running',
        'completed',
        'failed',
        'cancel_requested',
        'cancelled',
        'review_pending'
      )
    ),
  runtime_mode text not null default 'local'
    check (runtime_mode in ('local', 'vercel', 'worker')),
  file_name text not null,
  file_path text,
  file_mime_type text,
  file_size bigint,
  event_name text,
  hints jsonb not null default '{}'::jsonb,
  imported_tables jsonb,
  summary text,
  error_message text,
  created_mesa_ids uuid[] not null default '{}'::uuid[],
  processor_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index plan_import_jobs_evento_status_idx
on public.plan_import_jobs (evento_id, status, created_at desc);

create table public.plan_import_logs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.plan_import_jobs(id) on delete cascade,
  trace_id text not null,
  level text not null check (level in ('info', 'warn', 'error')),
  stage text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

create index plan_import_logs_job_created_idx
on public.plan_import_logs (job_id, created_at asc);

create table public.plan_import_samples (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.plan_import_jobs(id) on delete set null,
  trace_id text not null unique,
  evento_id uuid not null references public.eventos(id) on delete cascade,
  status text not null default 'staged'
    check (status in ('staged', 'validated', 'dismissed', 'deleted')),
  event_name text,
  file_name text not null,
  image_path text,
  image_sha256 text,
  sample_signature text,
  hints jsonb not null default '{}'::jsonb,
  imported_tables jsonb not null default '[]'::jsonb,
  staged_at timestamptz not null default now(),
  validated_at timestamptz,
  updated_at timestamptz not null default now()
);

create index plan_import_samples_status_idx
on public.plan_import_samples (status, validated_at desc nulls last, staged_at desc);

create index plan_import_samples_signature_idx
on public.plan_import_samples (sample_signature);

create or replace function public.touch_plan_import_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

create trigger plan_import_jobs_touch_updated_at
before update on public.plan_import_jobs
for each row
execute function public.touch_plan_import_updated_at();

create trigger plan_import_samples_touch_updated_at
before update on public.plan_import_samples
for each row
execute function public.touch_plan_import_updated_at();

alter table public.plan_import_jobs enable row level security;
alter table public.plan_import_logs enable row level security;
alter table public.plan_import_samples enable row level security;

create policy "plan_import_jobs_no_public_access"
on public.plan_import_jobs
for all
to anon
using (false)
with check (false);

create policy "plan_import_logs_no_public_access"
on public.plan_import_logs
for all
to anon
using (false)
with check (false);

create policy "plan_import_samples_no_public_access"
on public.plan_import_samples
for all
to anon
using (false)
with check (false);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'plan_import_jobs'
  ) then
    alter publication supabase_realtime add table public.plan_import_jobs;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'plan_import_logs'
  ) then
    alter publication supabase_realtime add table public.plan_import_logs;
  end if;
end
$$;

create or replace function public.claim_next_plan_import_job(worker_mode text default 'worker')
returns public.plan_import_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_job public.plan_import_jobs;
begin
  with next_job as (
    select id
    from public.plan_import_jobs
    where status = 'pending'
    order by created_at asc
    limit 1
    for update skip locked
  )
  update public.plan_import_jobs jobs
  set
    status = 'running',
    runtime_mode = worker_mode,
    started_at = coalesce(jobs.started_at, now()),
    updated_at = now()
  from next_job
  where jobs.id = next_job.id
  returning jobs.* into claimed_job;

  return claimed_job;
end
$$;

insert into storage.buckets (id, name, public)
values ('plan-imports', 'plan-imports', false)
on conflict (id) do nothing;
