-- Vórtex Grupo — Fase 2A: sequências, ações em massa, gatilhos de grupo novo, enquetes, recibos, alertas e calendário.
-- Sem perda de dados: mensagens → execucoes e envios → tarefas são RENOMEADAS (linhas, ids, políticas e grants ficam).

-- 1. Sequências e modelos

create table sequencias (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nome text not null check (char_length(nome) between 1 and 60)
);

create table sequencia_passos (
  id uuid primary key default gen_random_uuid(),
  sequencia_id uuid not null references sequencias (id) on delete cascade,
  ordem int not null default 0,
  dia_relativo int not null check (dia_relativo between -30 and 7),
  hora time not null,
  tipo text not null check (tipo in ('mensagem', 'enquete', 'nome', 'descricao', 'abrir', 'fechar')),
  conteudo jsonb not null default '{}',
  importante boolean not null default false
);
create index sequencia_passos_sequencia on sequencia_passos (sequencia_id, ordem);

create table modelos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nome text not null check (char_length(nome) between 1 and 60),
  tipo text not null check (tipo in ('mensagem', 'enquete', 'nome', 'descricao')),
  conteudo jsonb not null default '{}'
);

-- 2. Campanha: aula, sequência, variáveis, mensagem fixa e webhook de alertas

alter table campanhas
  add column data_aula timestamptz,
  add column sequencia_id uuid references sequencias (id) on delete set null,
  add column link_aula text,
  add column mensagem_fixa text,
  add column alertas_webhook_url text;

create table campanha_variaveis (
  campanha_id uuid not null references campanhas (id) on delete cascade,
  chave text not null check (chave ~ '^[a-z_]{2,30}$'),
  valor text not null default '',
  primary key (campanha_id, chave)
);

-- 3. mensagens → execucoes (o conteúdo de mídia vai pro jsonb `conteudo`)

alter table mensagens rename to execucoes;
alter index mensagens_vencidas rename to execucoes_vencidas;
alter table execucoes
  add column origem text not null default 'avulsa' check (origem in ('avulsa', 'sequencia', 'massa', 'grupo_novo')),
  add column passo_id uuid references sequencia_passos (id) on delete set null,
  add column conteudo jsonb not null default '{}',
  add column conteudo_final jsonb,
  add column importante boolean not null default false,
  add column alvo_grupos uuid[],
  add column motivo text,
  -- Quando o tick pegou a execução (agendada → enviando). Execução em 'enviando' sem tarefa há mais de 5 min volta
  -- pra 'agendada' (o `iniciar` morreu antes de inserir as tarefas).
  add column iniciada_em timestamptz;

update execucoes set conteudo = jsonb_build_object(
  'formato', tipo, 'texto', texto, 'midia_url', midia_url, 'nome_arquivo', nome_arquivo, 'mencionar_todos', mencionar_todos
);
-- Já começou ou terminou: o conteúdo enviado é o próprio conteúdo (não havia variáveis na Fase 1).
update execucoes set conteudo_final = conteudo where status <> 'agendada';

alter table execucoes drop constraint mensagens_tipo_check;
update execucoes set tipo = 'mensagem';
alter table execucoes alter column tipo set default 'mensagem';
alter table execucoes add constraint execucoes_tipo_check check (tipo in (
  'mensagem', 'enquete', 'nome', 'descricao', 'abrir', 'fechar', 'admin_add', 'admin_remover', 'redefinir_link'
));
alter table execucoes drop column texto, drop column midia_url, drop column nome_arquivo, drop column mencionar_todos;
alter table execucoes drop constraint mensagens_status_check;
alter table execucoes add constraint execucoes_status_check check (status in (
  'agendada', 'enviando', 'concluida', 'cancelada', 'pulada', 'bloqueada'
));
-- Um passo vira no máximo uma execução por campanha. passo_id só existe em origem 'sequencia'; null não colide,
-- então avulsas, massa e grupo novo ficam fora do único. (Único comum, não parcial: o PostgREST precisa dele no
-- on_conflict do upsert.)
alter table execucoes add constraint execucoes_passo_unico unique (campanha_id, passo_id);
alter table execucoes add constraint execucoes_passo_so_sequencia check (passo_id is null or origem = 'sequencia');
create index execucoes_campanha_data on execucoes (campanha_id, agendada_para);

-- 4. envios → tarefas (uma execução aplicada a um grupo)

alter table envios rename to tarefas;
alter table tarefas rename column mensagem_id to execucao_id;
alter index envios_fila rename to tarefas_fila;
alter table tarefas rename constraint envios_mensagem_id_grupo_id_key to tarefas_execucao_id_grupo_id_key;
alter table tarefas rename constraint envios_mensagem_id_fkey to tarefas_execucao_id_fkey;
alter table tarefas
  add column tipo text not null default 'mensagem' check (tipo in (
    'mensagem', 'enquete', 'nome', 'descricao', 'abrir', 'fechar', 'admin_add', 'admin_remover', 'redefinir_link'
  )),
  add column prioridade smallint not null default 1 check (prioridade in (0, 1)),
  add column entregues int not null default 0,
  add column lidos int not null default 0,
  add column apurada_em timestamptz;
create index tarefas_message_id on tarefas (message_id) where message_id is not null;
create index tarefas_enquetes on tarefas (enviado_em) where tipo = 'enquete' and status = 'enviado';

-- 5. Enquetes e alertas

create table enquete_votos (
  execucao_id uuid not null references execucoes (id) on delete cascade,
  grupo_id uuid not null references grupos (id) on delete cascade,
  telefone text not null,
  opcoes text[] not null default '{}',
  votado_em timestamptz not null default now(),
  primary key (execucao_id, grupo_id, telefone)
);

create table alertas (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tipo text not null check (tipo in ('grupo_cheio', 'numero_caiu', 'execucao_bloqueada', 'tarefa_erro', 'grupo_sumiu', 'criacao_erro')),
  campanha_id uuid references campanhas (id) on delete cascade,
  texto text not null,
  visto boolean not null default false
);
create index alertas_nao_vistos on alertas (created_at desc) where visto = false;

-- 6. Funções

drop function pegar_envios(int);

-- Mesma trava da Fase 1; ordem por horário e, no mesmo horário, ações (0) antes de mensagens (1).
create or replace function pegar_tarefas(limite int) returns setof tarefas language plpgsql as $$
begin
  update tarefas set status = 'erro', erro = 'Tarefa interrompida: pode ter sido feita. Confira no grupo antes de repetir.'
  where status = 'processando' and pego_em < now() - interval '5 minutes';
  return query
  update tarefas set status = 'processando', pego_em = now(), tentativas = tentativas + 1
  where id in (
    select t.id from tarefas t join conexoes c on c.id = t.conexao_id
    where t.status = 'fila' and t.enviar_apos <= now() and (c.pausado_ate is null or c.pausado_ate <= now())
    order by t.enviar_apos, t.prioridade
    limit limite
    for update of t skip locked
  )
  returning *;
end $$;

-- Recibo do WhatsApp (MessageStatusCallback): uma escrita por aviso, sem linha por pessoa.
create or replace function somar_recibos(p_ids text[], p_lido boolean) returns void language sql as $$
  update tarefas set
    entregues = entregues + case when p_lido then 0 else 1 end,
    lidos = lidos + case when p_lido then 1 else 0 end
  where message_id = any(p_ids)
$$;

revoke execute on function pegar_tarefas(int), somar_recibos(text[], boolean) from public, anon, authenticated;
grant execute on function pegar_tarefas(int), somar_recibos(text[], boolean) to service_role;

-- Situação das execuções agregada no banco (embed de tarefas cortaria em max_rows = 1000).
create or replace function resumo_execucoes(p_ids uuid[])
returns table (execucao_id uuid, total bigint, feitas bigint, erros bigint, pendentes bigint, entregues bigint, lidos bigint)
language sql stable security invoker set search_path = public as $$
  select t.execucao_id,
         count(*),
         count(*) filter (where t.status = 'enviado'),
         count(*) filter (where t.status = 'erro'),
         count(*) filter (where t.status in ('fila', 'processando')),
         coalesce(sum(t.entregues), 0),
         coalesce(sum(t.lidos), 0)
  from tarefas t
  where t.execucao_id = any(p_ids)
  group by t.execucao_id
$$;
-- Votos somados por opção (uma pessoa pode marcar mais de uma quando o máximo de respostas é > 1).
create or replace function resultado_enquete(p_execucao uuid)
returns table (opcao text, votos bigint)
language sql stable security invoker set search_path = public as $$
  select o, count(*)
  from enquete_votos v, unnest(v.opcoes) as o
  where v.execucao_id = p_execucao
  group by o
$$;

revoke execute on function resumo_execucoes(uuid[]), resultado_enquete(uuid) from public, anon;
grant execute on function resumo_execucoes(uuid[]), resultado_enquete(uuid) to authenticated, service_role;

-- 7. RLS e grants (mesmo padrão da Fase 1: equipe logada lê e escreve; anônimo nada)

do $$
declare t text;
begin
  foreach t in array array['sequencias', 'sequencia_passos', 'modelos', 'campanha_variaveis', 'enquete_votos', 'alertas'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy equipe_tudo on %I for all to authenticated using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on %I to authenticated, service_role', t);
  end loop;
end $$;
