alter table public.reservas
add column if not exists es_celiaco boolean not null default false,
add column if not exists tiene_alergias boolean not null default false,
add column if not exists movilidad_reducida boolean not null default false,
add column if not exists observaciones text;
