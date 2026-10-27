-- Etapa 3K, Tarefa 4: aba "Grupos" do detalhe da conta — "Atualizar" lê
-- TODOS os grupos que a conta participa no Zapbot (`GET groups`), não só os de campanha, e guarda aqui pra não
-- reconsultar a cada abertura da aba. Tabela vazia = comportamento de hoje (mostra só os grupos de campanha, com
-- a dica pra clicar em Atualizar).

create table conta_grupos (
  conexao_id uuid not null references conexoes (id) on delete cascade,
  group_id text not null,
  nome text,
  participantes int not null default 0,
  admin boolean not null default false,
  atualizado_em timestamptz not null default now(),
  primary key (conexao_id, group_id)
);

alter table conta_grupos enable row level security;
create policy equipe_tudo on conta_grupos for all to authenticated using (true) with check (true);
grant select, insert, update, delete on conta_grupos to authenticated, service_role;
revoke all on conta_grupos from anon;

-- Travas de 2 minutos dos botões "Atualizar" e "Escanear" da aba Grupos (mesmo padrão de
-- `campanhas.leads_atualizados_em`/`atualizarLeads`). Nulas = nunca pedido = comportamento de hoje.
alter table conexoes add column grupos_atualizados_em timestamptz;
alter table conexoes add column grupos_escaneados_em timestamptz;
