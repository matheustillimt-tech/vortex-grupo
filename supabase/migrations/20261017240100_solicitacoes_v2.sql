-- Etapa 3N, Task 2: Solicitações de entrada (reservar vaga, aprovação por tag e Histórico de solicitações com status).
-- Só aditiva:
--   * as colunas novas de `campanhas` nascem false/vazias = a conferência e o link `/l/[slug]` fazem a conta e as
--     chamadas de hoje;
--   * `aprovar_tags` é uuid[] SEM FK (como `campanhas_anteriores`): uma chave nova de `campanhas` pra `tags` deixaria
--     ambíguos os embeds `campanhas(...)` (ver tests/embeds-ambiguos.test.ts). A validade é conferida na action;
--   * as colunas novas de `grupos` nascem 0/nulas;
--   * tabela nova `solicitacoes_vistas` (pedidos pendentes já vistos numa leitura). A chave primária é
--     (grupo_id, telefone): `campanha_id` fica fora dela, então o PostgREST não a trata como tabela de junção entre
--     grupos e campanhas (nenhum embed `campanhas(...)` a partir de `grupos` fica ambíguo);
--   * os checks inline de `solicitacoes_entrada` (de 20261017220200_solicitacoes_entrada.sql) ganham valores e mantêm
--     todos os de antes. Em vez de confiar no nome gerado, apaga os checks da tabela cuja definição usa a coluna
--     (lido em pg_constraint) e cria o novo com o nome de sempre.

-- 1. Campanhas: reserva de vaga e aprovação automática por tag (desligadas por padrão).
alter table campanhas add column reservar_vaga_pendentes boolean not null default false;
alter table campanhas add column aprovar_por_tag boolean not null default false;
alter table campanhas add column aprovar_tags uuid[] not null default '{}'
  constraint campanhas_aprovar_tags_check check (cardinality(aprovar_tags) <= 20);

-- 2. Grupos: quantos pedidos pendentes (das últimas 48 h) seguram vaga, e quando foram lidos.
alter table grupos add column pendentes_reservados int not null default 0
  constraint grupos_pendentes_reservados_check check (pendentes_reservados >= 0);
alter table grupos add column pendentes_lidos_em timestamptz;

-- 3. Pedidos vistos numa leitura de pendentes (conferência e aba Pendentes). Some da leitura completa → vira linha
--    `whatsapp` em `solicitacoes_entrada` (aprovada pelo celular ou cancelada); sem leitura há 48 h → `expirada`.
create table solicitacoes_vistas (
  grupo_id uuid not null references grupos (id) on delete cascade,
  campanha_id uuid not null references campanhas (id) on delete cascade,
  telefone text not null,
  pedido_em timestamptz,
  visto_em timestamptz not null default now(),
  ultimo_visto_em timestamptz not null default now(),
  primary key (grupo_id, telefone)
);
create index solicitacoes_vistas_ultimo_visto on solicitacoes_vistas (ultimo_visto_em);

alter table solicitacoes_vistas enable row level security;
create policy equipe_le on solicitacoes_vistas for select to authenticated using (true);
revoke all on solicitacoes_vistas from anon, authenticated;
grant select on solicitacoes_vistas to authenticated;
grant select, insert, update, delete on solicitacoes_vistas to service_role;

-- 4. Histórico de solicitações: decisões `cancelada`/`expirada` e a origem `whatsapp`.
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.solicitacoes_entrada'::regclass
      and contype = 'c'
      and (pg_get_constraintdef(oid) ilike '%decisao%' or pg_get_constraintdef(oid) ilike '%origem%')
  loop
    execute format('alter table public.solicitacoes_entrada drop constraint %I', c.conname);
  end loop;
end $$;

alter table solicitacoes_entrada add constraint solicitacoes_entrada_decisao_check
  check (decisao in ('aprovada', 'recusada', 'cancelada', 'expirada'));
alter table solicitacoes_entrada add constraint solicitacoes_entrada_origem_check
  check (origem in ('manual', 'automatica', 'whatsapp'));

-- Filtros do Histórico (status) por campanha.
create index solicitacoes_entrada_campanha_decisao on solicitacoes_entrada (campanha_id, decisao, created_at desc);
