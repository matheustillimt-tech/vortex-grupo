-- Etapa 3M, Tarefa 4: aba "Solicitações de entrada" da campanha (Pendentes, Processadas, Configurações) e as duas
-- regras automáticas que rodam dentro da conferência de grupos. Só aditiva:
--   * as duas colunas novas nascem false = o cron não lê nem responde pedido de entrada nenhum (comportamento de hoje);
--   * tabela nova `solicitacoes_entrada` (log de cada decisão, manual ou automática, com o resultado do Zapbot);
--   * o check inline de `exportacoes.tipo` (nome gerado pelo Postgres: `exportacoes_tipo_check`, de
--     20261017200100_acoes_novas_exportacoes.sql) ganha 'solicitacoes', mantendo os 3 valores de hoje.

-- 1. Regras automáticas (desligadas por padrão). "Exigir aprovação" continua sendo `campanhas.aprovacao_entrada`.
alter table campanhas add column recusar_bloqueados boolean not null default false;
alter table campanhas add column aprovar_automaticamente boolean not null default false;

-- 2. Processadas: uma linha por telefone decidido (aprovado ou recusado), com o resultado devolvido pelo Zapbot.
--    `grupo_nome` fica gravado (o grupo pode sair da campanha ou ser apagado: grupo_id vira null).
create table solicitacoes_entrada (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  campanha_id uuid not null references campanhas (id) on delete cascade,
  grupo_id uuid references grupos (id) on delete set null,
  grupo_nome text,
  telefone text not null,
  pedido_em timestamptz,
  decisao text not null check (decisao in ('aprovada', 'recusada')),
  origem text not null check (origem in ('manual', 'automatica')),
  motivo text,
  decidida_por uuid,
  resultado text not null check (resultado in ('ok', 'erro')),
  erro text
);
create index solicitacoes_entrada_campanha on solicitacoes_entrada (campanha_id, created_at desc);

alter table solicitacoes_entrada enable row level security;
-- A equipe só lê (aba Processadas e CSV); quem grava é o servidor, com a service role (decisão manual e regra automática).
create policy equipe_le on solicitacoes_entrada for select to authenticated using (true);
revoke all on solicitacoes_entrada from anon, authenticated;
grant select on solicitacoes_entrada to authenticated;
grant select, insert on solicitacoes_entrada to service_role;

-- 3. "Ver exportações": CSV das Processadas (tem telefone; a rota exige Leads/ver).
alter table exportacoes drop constraint exportacoes_tipo_check;
alter table exportacoes add constraint exportacoes_tipo_check check (tipo in (
  'leads', 'status_mensagens', 'historico_mensagens',
  'solicitacoes'
));
