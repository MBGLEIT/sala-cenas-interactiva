create extension if not exists "pgcrypto";

create table public.eventos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  fecha date not null,
  created_at timestamptz not null default now()
);

create table public.asistentes (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.eventos(id) on delete cascade,
  identificador text not null unique,
  nombre text not null,
  created_at timestamptz not null default now()
);

create table public.mesas (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.eventos(id) on delete cascade,
  numero integer not null,
  pos_x double precision not null,
  pos_y double precision not null,
  created_at timestamptz not null default now(),
  unique (evento_id, numero)
);

create table public.sillas (
  id uuid primary key default gen_random_uuid(),
  mesa_id uuid not null references public.mesas(id) on delete cascade,
  numero integer not null,
  created_at timestamptz not null default now(),
  unique (mesa_id, numero)
);

create table public.reservas (
  id uuid primary key default gen_random_uuid(),
  silla_id uuid not null references public.sillas(id) on delete cascade,
  asistente_id uuid not null references public.asistentes(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (silla_id),
  unique (asistente_id)
);
