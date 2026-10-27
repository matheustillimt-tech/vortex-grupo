-- Etapa 2E (parte 1): motor de automações (gatilho + ações). Cada ação vira uma execução comum (origem 'automacao').

create table automacoes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nome text not null check (char_length(nome) between 1 and 80),
  campanha_id uuid not null references campanhas (id) on delete cascade,
  gatilho text not null check (gatilho in ('cronograma', 'grupo_criado', 'grupo_cheio')),
  quando timestamptz,
  alvo_grupos uuid[],
  ativo boolean not null default false,
  pasta text check (pasta is null or char_length(pasta) between 1 and 40),
  check ((gatilho = 'cronograma') = (quando is not null))
);
create index automacoes_campanha_gatilho on automacoes (campanha_id, gatilho) where ativo;

create table automacao_acoes (
  id uuid primary key default gen_random_uuid(),
  automacao_id uuid not null references automacoes (id) on delete cascade,
  ordem int not null default 0,
  tipo text not null check (tipo in ('mensagem', 'enquete', 'nome', 'descricao', 'abrir', 'fechar')),
  conteudo jsonb not null default '{}',
  atraso_min int not null default 0 check (atraso_min between 0 and 1440)
);
create index automacao_acoes_automacao on automacao_acoes (automacao_id, ordem);

alter table execucoes
  add column automacao_id uuid references automacoes (id) on delete set null,
  add column automacao_acao_id uuid references automacao_acoes (id) on delete set null,
  add column gatilho_chave text;
alter table execucoes drop constraint execucoes_origem_check;
alter table execucoes add constraint execucoes_origem_check check (origem in ('avulsa', 'sequencia', 'massa', 'grupo_novo', 'automacao'));
-- Uma execução por ação e por disparo (cronograma: 'cronograma'; grupo: id do grupo). Impede repetir no mesmo grupo.
-- Não parcial: o upsert do PostgREST (onConflict) não consegue expressar o predicado WHERE de um índice parcial.
-- NULL nunca colide com NULL (semântica de unicidade do Postgres), então as execuções sem automação (ambas colunas
-- NULL) nunca são bloqueadas por esse índice.
create unique index execucoes_automacao_unica on execucoes (automacao_acao_id, gatilho_chave);
create index execucoes_automacao on execucoes (automacao_id) where automacao_id is not null;

-- Placar por automação (sem cancelada).
create or replace function resumo_automacoes(p_ids uuid[])
returns table (automacao_id uuid, total bigint, agendadas bigint, enviando bigint, concluidas bigint, falhas bigint)
language sql stable security invoker set search_path = public as $$
  select e.automacao_id,
    count(*),
    count(*) filter (where e.status = 'agendada'),
    count(*) filter (where e.status = 'enviando'),
    count(*) filter (where e.status = 'concluida'
      and not exists (select 1 from tarefas t where t.execucao_id = e.id and t.status = 'erro')),
    count(*) filter (where e.status = 'bloqueada'
      or (e.status = 'concluida' and exists (select 1 from tarefas t where t.execucao_id = e.id and t.status = 'erro')))
  from execucoes e
  where e.automacao_id = any (p_ids) and e.status <> 'cancelada'
  group by e.automacao_id
$$;
revoke execute on function resumo_automacoes(uuid[]) from public, anon;
grant execute on function resumo_automacoes(uuid[]) to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['automacoes', 'automacao_acoes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy equipe_tudo on %I for all to authenticated using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on %I to authenticated, service_role', t);
  end loop;
end $$;
