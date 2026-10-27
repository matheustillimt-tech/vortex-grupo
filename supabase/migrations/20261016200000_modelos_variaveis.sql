-- Etapa 2H: pastas e arquivo nos modelos; variáveis globais (nome + tipo; o valor fica em campanha_variaveis).
alter table modelos
  add column pasta text check (pasta is null or char_length(pasta) between 1 and 40),
  add column arquivado boolean not null default false,
  add column updated_at timestamptz not null default now();
create index modelos_pasta on modelos (pasta) where pasta is not null;

create table variaveis_globais (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  chave text not null unique check (chave ~ '^[a-z_]{2,30}$'),
  tipo text not null default 'texto' check (tipo in ('texto', 'link', 'data', 'numero')),
  categoria text check (categoria is null or char_length(categoria) between 1 and 40)
);
alter table variaveis_globais enable row level security;
create policy equipe_tudo on variaveis_globais for all to authenticated using (true) with check (true);
grant select, insert, update, delete on variaveis_globais to authenticated, service_role;
