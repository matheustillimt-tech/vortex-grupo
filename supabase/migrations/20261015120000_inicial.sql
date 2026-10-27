-- Vórtex Grupo — banco inicial

-- No Supabase o pgcrypto já vem instalado no schema extensions (aqui é no-op).
create extension if not exists pgcrypto with schema extensions;

create table conexoes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nome text not null check (char_length(nome) between 1 and 40),
  telefone text,
  zapbot_id text unique,
  zapbot_token_enc text,
  client_token_enc text,
  webhook_secret text not null,
  status text not null default 'pendente' check (status in ('pendente', 'conectado', 'desconectado')),
  ultimo_erro text,
  pausado_ate timestamptz,
  proximo_status_em timestamptz not null default now(),
  proxima_conferencia_em timestamptz not null default now()
);

create table campanhas (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nome text not null,
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  padrao_nome text not null default 'GRUPO #{n}',
  descricao text not null default '',
  fechado boolean not null default true,
  limite_por_grupo int not null default 1000 check (limite_por_grupo between 10 and 1024),
  folga int not null default 1 check (folga between 1 and 10),
  conexao_criadora_id uuid references conexoes (id),
  usar_comunidade boolean not null default false,
  comunidade_id text,
  crm_webhook_url text,
  arquivada boolean not null default false
);

create table campanha_conexoes (
  campanha_id uuid not null references campanhas (id) on delete cascade,
  conexao_id uuid not null references conexoes (id) on delete cascade,
  primary key (campanha_id, conexao_id)
);

create table grupos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  campanha_id uuid not null references campanhas (id) on delete cascade,
  conexao_id uuid not null references conexoes (id),
  group_id text not null unique,
  nome text not null,
  numero int not null,
  link_convite text,
  participantes int not null default 0,
  cheio boolean not null default false,
  ativo boolean not null default true,
  conferido_em timestamptz,
  unique (campanha_id, numero)
);

create table participantes (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references grupos (id) on delete cascade,
  telefone text not null,
  admin boolean not null default false,
  importado boolean not null default false,
  entrou_em timestamptz not null default now(),
  saiu_em timestamptz
);
create unique index participantes_aberto on participantes (grupo_id, telefone) where saiu_em is null;
create index participantes_telefone on participantes (telefone) where saiu_em is null;
create index participantes_entrou on participantes (entrou_em);

create table cliques (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  campanha_id uuid not null references campanhas (id) on delete cascade,
  grupo_id uuid references grupos (id) on delete set null,
  visitante text not null,
  utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
  referer text,
  user_agent text,
  ip_hash text
);
create index cliques_grupo_data on cliques (grupo_id, created_at);
create index cliques_campanha_data on cliques (campanha_id, created_at);

create table mensagens (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  campanha_id uuid not null references campanhas (id) on delete cascade,
  tipo text not null check (tipo in ('texto', 'imagem', 'video', 'audio', 'documento')),
  texto text not null default '',
  midia_url text,
  nome_arquivo text,
  mencionar_todos boolean not null default false,
  agendada_para timestamptz not null default now(),
  status text not null default 'agendada' check (status in ('agendada', 'enviando', 'concluida', 'cancelada')),
  criada_por uuid references auth.users (id) on delete set null
);
create index mensagens_vencidas on mensagens (agendada_para) where status = 'agendada';

create table envios (
  id uuid primary key default gen_random_uuid(),
  mensagem_id uuid not null references mensagens (id) on delete cascade,
  grupo_id uuid not null references grupos (id) on delete cascade,
  conexao_id uuid not null references conexoes (id) on delete cascade,
  status text not null default 'fila' check (status in ('fila', 'processando', 'enviado', 'erro')),
  message_id text,
  erro text,
  tentativas int not null default 0,
  enviar_apos timestamptz not null default now(),
  pego_em timestamptz,
  enviado_em timestamptz,
  unique (mensagem_id, grupo_id)
);
create index envios_fila on envios (enviar_apos) where status = 'fila';

create table regras_compra (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references campanhas (id) on delete cascade,
  provedor text not null check (provedor in ('vortex', 'pagarme', 'hotmart', 'kiwify')),
  produto text not null
);

create table vendas (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  provedor text not null,
  evento_id text not null,
  aprovada boolean not null,
  telefone text,
  produtos text[] not null default '{}',
  payload jsonb not null,
  processada_em timestamptz,
  resultado text,
  unique (provedor, evento_id)
);

create table acoes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tipo text not null check (tipo in ('criar_grupo', 'remover')),
  campanha_id uuid references campanhas (id) on delete cascade,
  grupo_id uuid references grupos (id) on delete cascade,
  telefone text,
  dados jsonb not null default '{}',
  status text not null default 'fila' check (status in ('fila', 'processando', 'ok', 'erro')),
  erro text,
  tentativas int not null default 0,
  pego_em timestamptz,
  origem text
);
create unique index acoes_um_criar_por_campanha on acoes (campanha_id) where tipo = 'criar_grupo' and status in ('fila', 'processando', 'erro');
create unique index acoes_um_remover_por_participante on acoes (grupo_id, telefone) where tipo = 'remover' and status in ('fila', 'processando');
create index acoes_fila on acoes (created_at) where status = 'fila';

create table eventos_saida (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  campanha_id uuid not null references campanhas (id) on delete cascade,
  url text not null,
  payload jsonb not null,
  status text not null default 'fila' check (status in ('fila', 'processando', 'ok', 'erro')),
  tentativas int not null default 0,
  erro text,
  proxima_tentativa timestamptz not null default now(),
  pego_em timestamptz
);
create index eventos_fila on eventos_saida (proxima_tentativa) where status = 'fila';

create table provedores_checkout (
  provedor text primary key check (provedor in ('vortex', 'pagarme', 'hotmart', 'kiwify')),
  segredo text not null
);
insert into provedores_checkout (provedor, segredo)
select p, encode(extensions.gen_random_bytes(24), 'hex') from unnest(array['vortex', 'pagarme', 'hotmart', 'kiwify']) p;

-- Filas: pega itens vencidos travando a linha (dois ticks não pegam o mesmo item).
-- Itens presos em 'processando' há mais de 5 minutos voltam para a fila.

create or replace function pegar_envios(limite int) returns setof envios language plpgsql as $$
begin
  update envios set status = 'erro', erro = 'Envio interrompido: pode ter chegado. Confira no grupo antes de reenviar.'
  where status = 'processando' and pego_em < now() - interval '5 minutes';
  return query
  update envios set status = 'processando', pego_em = now(), tentativas = tentativas + 1
  where id in (
    select e.id from envios e join conexoes c on c.id = e.conexao_id
    where e.status = 'fila' and e.enviar_apos <= now() and (c.pausado_ate is null or c.pausado_ate <= now())
    order by e.enviar_apos
    limit limite
    for update of e skip locked
  )
  returning *;
end $$;

create or replace function pegar_acoes(limite int) returns setof acoes language plpgsql as $$
begin
  update acoes set status = 'fila' where status = 'processando' and pego_em < now() - interval '5 minutes';
  return query
  update acoes set status = 'processando', pego_em = now(), tentativas = tentativas + 1
  where id in (
    select id from acoes where status = 'fila' order by created_at limit limite for update skip locked
  )
  returning *;
end $$;

create or replace function pegar_eventos(limite int) returns setof eventos_saida language plpgsql as $$
begin
  update eventos_saida set status = 'fila' where status = 'processando' and pego_em < now() - interval '5 minutes';
  return query
  update eventos_saida set status = 'processando', pego_em = now(), tentativas = tentativas + 1
  where id in (
    select id from eventos_saida where status = 'fila' and proxima_tentativa <= now()
    order by proxima_tentativa limit limite for update skip locked
  )
  returning *;
end $$;

revoke execute on function pegar_envios(int), pegar_acoes(int), pegar_eventos(int) from public, anon, authenticated;
grant execute on function pegar_envios(int), pegar_acoes(int), pegar_eventos(int) to service_role;

-- Métricas da visão geral agregadas no banco (contar linhas no JS corta em max_rows = 1000).
-- Dia no fuso de Brasília. security invoker: respeita o RLS de quem chama.
create or replace function metricas_campanha(p_campanha uuid, p_desde timestamptz)
returns table (dia date, cliques bigint, entradas bigint, saidas bigint)
language sql stable security invoker set search_path = public as $$
  with c as (
    select (k.created_at at time zone 'America/Sao_Paulo')::date as d, count(*) as n
    from cliques k
    where k.campanha_id = p_campanha and k.created_at >= p_desde
    group by 1
  ), e as (
    select (p.entrou_em at time zone 'America/Sao_Paulo')::date as d, count(*) as n
    from participantes p join grupos g on g.id = p.grupo_id
    where g.campanha_id = p_campanha and p.importado = false and p.admin = false and p.entrou_em >= p_desde
    group by 1
  ), s as (
    select (p.saiu_em at time zone 'America/Sao_Paulo')::date as d, count(*) as n
    from participantes p join grupos g on g.id = p.grupo_id
    where g.campanha_id = p_campanha and p.admin = false and p.saiu_em >= p_desde
    group by 1
  )
  select d, coalesce(c.n, 0), coalesce(e.n, 0), coalesce(s.n, 0)
  from c full join e using (d) full join s using (d)
  order by d
$$;
revoke execute on function metricas_campanha(uuid, timestamptz) from public, anon;
grant execute on function metricas_campanha(uuid, timestamptz) to authenticated, service_role;

-- RLS: equipe logada lê e escreve tudo; anônimo nada. Cron e webhooks usam a service role.
do $$
declare t text;
begin
  foreach t in array array['conexoes','campanhas','campanha_conexoes','grupos','participantes','cliques','mensagens',
                           'envios','regras_compra','vendas','acoes','eventos_saida','provedores_checkout'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy equipe_tudo on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- Grants explícitos (não depender do "expor tabelas novas automaticamente" do projeto). Vêm antes dos revokes
-- abaixo, que tiram de authenticated as colunas secretas de conexoes e a tabela provedores_checkout.
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Colunas cifradas e segredos nunca vão pro navegador. Revogar coluna não basta quando a tabela inteira tem
-- GRANT (padrão do Supabase): revoga tudo e devolve só as colunas seguras. Escrita em conexoes e leitura de
-- provedores_checkout só pelo servidor (service role).
revoke all on conexoes from authenticated, anon;
grant select (id, created_at, nome, telefone, zapbot_id, status, ultimo_erro, pausado_ate, proximo_status_em, proxima_conferencia_em)
  on conexoes to authenticated;
revoke all on provedores_checkout from authenticated, anon;

-- Mídias das mensagens (o Zapbot baixa pela URL pública).
insert into storage.buckets (id, name, public) values ('midias', 'midias', true) on conflict (id) do nothing;
create policy midias_upload on storage.objects for insert to authenticated with check (bucket_id = 'midias');
