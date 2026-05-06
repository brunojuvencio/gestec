create table if not exists public.inscricoes_vendas (
  id bigint generated always as identity primary key,
  formacao_superior text not null,
  nome text not null,
  email text not null,
  cidade text,
  telefone text not null,
  area_formacao text not null,
  empresa text not null,
  cargo text not null,
  pretende_pos text not null,
  origem text not null default 'pre-mba-salestech',
  url_origem text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  criado_em timestamptz not null default now()
);

create index if not exists idx_inscricoes_vendas_email
on public.inscricoes_vendas (email);

create index if not exists idx_inscricoes_vendas_criado_em
on public.inscricoes_vendas (criado_em);

alter table public.inscricoes_vendas enable row level security;

drop policy if exists inscricoes_vendas_insert_public on public.inscricoes_vendas;

create policy inscricoes_vendas_insert_public
on public.inscricoes_vendas
for insert
to public
with check (true);

grant usage on schema public to anon;
grant insert on public.inscricoes_vendas to anon;
grant insert on public.inscricoes_vendas to authenticated;
grant usage, select on sequence public.inscricoes_vendas_id_seq to anon;
